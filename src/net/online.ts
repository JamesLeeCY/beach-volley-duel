// 線上對戰的協定與狀態：房間事件、角色同步、開局、輸入同步、對帳、斷線處理。
import { FPS_BY_SPEED, type Speed } from '../engine/constants';
import { createState, defaultConfig, deserializeState, serializeState } from '../engine/physics';
import type { GameEvent, GameState, InputFrame, MatchConfig, Stats } from '../engine/types';
import { RollbackSession, decodePacket, encodePacket } from './rollback';
import { Transport, type NetMessage } from './transport';

declare const __BUILD_VERSION__: string;
export const BUILD_VERSION = typeof __BUILD_VERSION__ === 'string' ? __BUILD_VERSION__ : 'dev';

export interface OnlineRules {
  speed: Speed;
  targetScore: number;
  balance: boolean;
}

export interface StartInfo {
  seed: number;
  rules: OnlineRules;
  chars: [string, string];
  stats: [Stats, Stats];
  delay: number;
}

export interface OnlineCallbacks {
  onCode(code: string): void;
  onConnected(): void;
  onRemoteChar(id: string, ready: boolean): void;
  onCountdown(info: StartInfo): void;
  onEvents(events: GameEvent[]): void;
  onEmote(id: number): void;
  onRematchAsk(): void;
  onDisconnect(secondsLeft: number | null): void;
  onForfeit(): void;
  onLeft(): void;
  onError(msg: string): void;
}

const DISCONNECT_PAUSE_MS = 5000;
const DISCONNECT_FORFEIT_MS = 30000;

export class OnlineMatch {
  readonly transport: Transport;
  session: RollbackSession | null = null;
  info: StartInfo | null = null;
  rtt = 0;
  private rttSamples: number[] = [];
  private pingTimer: number | null = null;
  private lastRecv = performance.now();
  private pendingHashes = new Map<number, number>();
  private advantageTicks = 0;
  stalled = 0;
  localChar = 'momo';
  localReady = false;
  remoteChar = 'momo';
  remoteReady = false;
  wantRematch = false;
  remoteRematch = false;
  private disconnected = false;
  desyncs = 0;
  ended = false;

  constructor(
    private cb: OnlineCallbacks,
    private rules: () => OnlineRules,
    private statsOf: (id: string) => Stats,
  ) {
    this.transport = new Transport({
      onOpen: () => this.handleOpen(),
      onMessage: (m) => this.handleMessage(m),
      onInput: (buf) => this.handleInput(buf),
      onClose: () => {
        if (!this.ended) this.cb.onLeft();
      },
      onError: (msg) => this.cb.onError(msg),
    });
  }

  get isHost() {
    return this.transport.isHost;
  }

  get localSide(): 0 | 1 {
    return this.isHost ? 0 : 1;
  }

  host() {
    this.transport.host((code) => this.cb.onCode(code));
  }

  join(code: string) {
    this.transport.join(code);
  }

  private handleOpen() {
    this.lastRecv = performance.now();
    this.transport.send({ t: 'hello', v: BUILD_VERSION });
    // 先密集 ping 10 次估算 RTT，之後每 2 秒一次
    let n = 0;
    const burst = window.setInterval(() => {
      this.ping();
      if (++n >= 10) clearInterval(burst);
    }, 100);
    this.pingTimer = window.setInterval(() => this.ping(), 2000);
    this.sendChar();
    this.cb.onConnected();
  }

  private ping() {
    this.transport.send({ t: 'ping', ts: performance.now() });
  }

  sendChar() {
    this.transport.send({ t: 'char', id: this.localChar, ready: this.localReady });
  }

  setChar(id: string, ready: boolean) {
    this.localChar = id;
    this.localReady = ready;
    this.sendChar();
    this.maybeStart();
  }

  private maybeStart() {
    if (!this.isHost || !this.localReady || !this.remoteReady || this.session) return;
    const rules = this.rules();
    const frameMs = 1000 / FPS_BY_SPEED[rules.speed];
    const rtt = this.rtt || 80;
    const delay = Math.min(3, Math.max(1, Math.ceil(rtt / 2 / frameMs)));
    const seedBuf = new Uint32Array(1);
    crypto.getRandomValues(seedBuf);
    const info: StartInfo = {
      seed: seedBuf[0] | 0,
      rules,
      chars: [this.localChar, this.remoteChar],
      stats: [this.statsOf(this.localChar), this.statsOf(this.remoteChar)],
      delay,
    };
    this.transport.send({ t: 'start', info, v: BUILD_VERSION });
    this.begin(info);
  }

  private begin(info: StartInfo) {
    this.info = info;
    this.wantRematch = false;
    this.remoteRematch = false;
    const cfg: MatchConfig = defaultConfig({
      targetScore: info.rules.targetScore,
      balance: info.rules.balance,
      stats: info.stats,
    });
    this.session = new RollbackSession(createState(info.seed), cfg, this.localSide, info.delay);
    this.session.onEvents = (ev) => this.cb.onEvents(ev);
    this.session.onConfirmedHash = (f, h) => {
      this.transport.send({ t: 'hash', f, h });
      const theirs = this.pendingHashes.get(f);
      if (theirs !== undefined) {
        this.pendingHashes.delete(f);
        if (theirs !== h) this.onDesync(f);
      }
    };
    this.cb.onCountdown(info);
  }

  private onDesync(frame: number) {
    this.desyncs++;
    console.warn('[net] desync at frame', frame, {
      local: [...(this.session?.localInputs ?? [])].slice(-60),
      remote: [...(this.session?.remoteInputs ?? [])].slice(-60),
    });
    if (this.isHost && this.session) {
      this.transport.send({ t: 'state', s: serializeState(this.session.confirmed) });
    } else {
      this.transport.send({ t: 'resync' });
    }
  }

  private handleMessage(m: NetMessage) {
    this.lastRecv = performance.now();
    switch (m.t) {
      case 'hello':
        if (m.v !== BUILD_VERSION) {
          this.cb.onError('version');
          this.close();
        }
        break;
      case 'full':
        this.cb.onError('full');
        break;
      case 'ping':
        this.transport.send({ t: 'pong', ts: m.ts });
        break;
      case 'pong': {
        const sample = performance.now() - Number(m.ts);
        this.rttSamples.push(sample);
        if (this.rttSamples.length > 10) this.rttSamples.shift();
        const sorted = [...this.rttSamples].sort((a, b) => a - b);
        this.rtt = Math.round(sorted[Math.floor(sorted.length / 2)]);
        break;
      }
      case 'char':
        this.remoteChar = String(m.id);
        this.remoteReady = !!m.ready;
        this.cb.onRemoteChar(this.remoteChar, this.remoteReady);
        this.maybeStart();
        break;
      case 'start':
        if (m.v !== BUILD_VERSION) {
          this.cb.onError('version');
          return;
        }
        if (!this.isHost) this.begin(m.info as StartInfo);
        break;
      case 'hash': {
        const f = Number(m.f);
        const h = Number(m.h);
        const mine = this.session?.hashAt(f) ?? null;
        if (mine === null) this.pendingHashes.set(f, h);
        else if (mine !== h) this.onDesync(f);
        break;
      }
      case 'resync':
        if (this.isHost && this.session) this.transport.send({ t: 'state', s: serializeState(this.session.confirmed) });
        break;
      case 'state':
        if (!this.isHost && this.session) this.session.resync(deserializeState(String(m.s)));
        break;
      case 'emote':
        this.cb.onEmote(Number(m.id));
        break;
      case 'rematch':
        this.remoteRematch = true;
        if (!this.wantRematch) this.cb.onRematchAsk();
        this.maybeRematch();
        break;
      case 'bye':
        this.ended = true;
        this.cb.onLeft();
        break;
    }
  }

  private handleInput(buf: ArrayBuffer) {
    this.lastRecv = performance.now();
    const p = decodePacket(buf);
    if (p && this.session) this.session.receive(p);
  }

  /** 每個邏輯幀呼叫一次；回傳是否推進了模擬 */
  tick(local: InputFrame): boolean {
    const s = this.session;
    if (!s) return false;
    const now = performance.now();
    const silent = now - this.lastRecv;
    if (silent > DISCONNECT_PAUSE_MS && !this.ended) {
      this.disconnected = true;
      const left = Math.ceil((DISCONNECT_FORFEIT_MS - silent) / 1000);
      if (left <= 0) {
        this.ended = true;
        this.cb.onForfeit();
        return false;
      }
      this.cb.onDisconnect(left);
    } else if (this.disconnected) {
      this.disconnected = false;
      this.cb.onDisconnect(null);
    }

    let advanced = false;
    // 時鐘校正：長期領先對方 2 幀以上時，每秒讓出一幀
    const rttFrames = this.rtt / 2 / (1000 / FPS_BY_SPEED[this.info!.rules.speed]);
    const adv = s.frameAdvantage() - rttFrames;
    this.advantageTicks = adv >= 2 ? this.advantageTicks + 1 : 0;
    const yieldFrame = this.advantageTicks >= FPS_BY_SPEED[this.info!.rules.speed];
    if (yieldFrame) this.advantageTicks = 0;

    if (!yieldFrame && s.canAdvance()) {
      s.addLocalInput(local);
      s.advance();
      advanced = true;
      this.stalled = 0;
    } else if (!yieldFrame) {
      this.stalled++;
    }
    this.transport.sendInput(encodePacket(s.packet()));
    return advanced;
  }

  get state(): GameState | null {
    return this.session?.state ?? null;
  }

  sendEmote(id: number) {
    this.transport.send({ t: 'emote', id });
  }

  requestRematch() {
    this.wantRematch = true;
    this.transport.send({ t: 'rematch' });
    this.maybeRematch();
  }

  private maybeRematch() {
    if (!this.wantRematch || !this.remoteRematch || !this.isHost || !this.info) return;
    this.session = null;
    this.localReady = true;
    this.remoteReady = true;
    this.maybeStart();
  }

  /** 回到選角（不中斷連線） */
  resetForCharSelect() {
    this.session = null;
    this.localReady = false;
    this.remoteReady = false;
  }

  close() {
    this.ended = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.transport.close();
  }
}
