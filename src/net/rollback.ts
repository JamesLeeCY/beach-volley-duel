// 輸入延遲 + rollback。與傳輸層無關，方便單元測試。
import { cloneState, hashState, step } from '../engine/physics';
import type { GameEvent, GameState, InputFrame, MatchConfig } from '../engine/types';

export const MAX_PREDICT = 8;
export const SNAPSHOTS = 12;
export const PACKET_FRAMES = 8;

export interface InputPacket {
  /** 第一個輸入對應的幀號 */
  start: number;
  inputs: number[];
  /** 已收到對方的最新連續幀號 */
  ack: number;
  /** 傳送端目前模擬到的幀 */
  frame: number;
}

export function encodePacket(p: InputPacket): ArrayBuffer {
  const buf = new ArrayBuffer(14 + p.inputs.length);
  const v = new DataView(buf);
  v.setUint8(0, 1);
  v.setUint32(1, p.start);
  v.setUint8(5, p.inputs.length);
  v.setInt32(6, p.ack);
  v.setUint32(10, p.frame);
  p.inputs.forEach((x, i) => v.setUint8(14 + i, x));
  return buf;
}

export function decodePacket(buf: ArrayBuffer): InputPacket | null {
  if (buf.byteLength < 14) return null;
  const v = new DataView(buf);
  if (v.getUint8(0) !== 1) return null;
  const n = v.getUint8(5);
  if (buf.byteLength < 14 + n) return null;
  const inputs: number[] = [];
  for (let i = 0; i < n; i++) inputs.push(v.getUint8(14 + i));
  return { start: v.getUint32(1), inputs, ack: v.getInt32(6), frame: v.getUint32(10) };
}

/**
 * 管理一場線上比賽的模擬。state 的幀號 = 已模擬的幀數。
 * 輸入以「要套用的幀號」為 key：本地在第 f 幀取樣的輸入會套用在 f + delay。
 */
export class RollbackSession {
  state: GameState;
  /** 最新「雙方輸入都確定」的狀態 */
  confirmed: GameState;
  readonly localInputs = new Map<number, number>();
  readonly remoteInputs = new Map<number, number>();
  /** 每一幀實際使用的對方輸入（含預測），用來判斷是否需要 rollback */
  private usedRemote = new Map<number, number>();
  private snapshots = new Map<number, GameState>();
  /** 已連續收到的對方最新幀號 */
  remoteContiguous = -1;
  /** 對方回報模擬到的幀 */
  remoteFrame = 0;
  rollbacks = 0;
  private playedEvents = new Set<string>();
  onEvents: (events: GameEvent[], frame: number) => void = () => {};
  /** 每 30 個確定幀回報一次 hash，供去同步偵測 */
  onConfirmedHash: (frame: number, hash: number) => void = () => {};
  private confirmedHashes = new Map<number, number>();

  constructor(
    initial: GameState,
    readonly cfg: MatchConfig,
    readonly localSide: 0 | 1,
    public delay: number,
  ) {
    this.state = cloneState(initial);
    this.confirmed = cloneState(initial);
    this.snapshots.set(initial.frame, cloneState(initial));
    // 開局（或重連後重新開始）的前 delay 幀沒有輸入，雙方都視為 0
    const base = initial.frame;
    for (let f = base + 1; f <= base + delay; f++) {
      this.localInputs.set(f, 0);
      this.remoteInputs.set(f, 0);
    }
    this.remoteContiguous = base + delay;
    this.remoteFrame = base;
  }

  get frame() {
    return this.state.frame;
  }

  /** 第 f 幀（套用輸入後得到 state.frame === f）要用的本地輸入 */
  private localFor(f: number) {
    return this.localInputs.get(f) ?? 0;
  }

  private remoteFor(f: number) {
    const known = this.remoteInputs.get(f);
    if (known !== undefined) return known;
    // 預測：重複最後一個已知輸入
    for (let k = f - 1; k >= 0 && k >= f - 64; k--) {
      const v = this.remoteInputs.get(k);
      if (v !== undefined) return v;
    }
    return 0;
  }

  /** 是否可以再往前推進一幀（預測不超過 MAX_PREDICT 幀） */
  canAdvance(): boolean {
    return this.state.frame + 1 - this.remoteContiguous <= MAX_PREDICT;
  }

  /** 記錄本地在這一幀取樣的輸入，會在 delay 幀後生效 */
  addLocalInput(input: InputFrame) {
    this.localInputs.set(this.state.frame + 1 + this.delay, input & 31);
  }

  /** 收到對方輸入；回傳是否有新資料 */
  receive(p: InputPacket): boolean {
    this.remoteFrame = Math.max(this.remoteFrame, p.frame);
    let rollbackTo = Infinity;
    let fresh = false;
    p.inputs.forEach((input, i) => {
      const f = p.start + i;
      if (this.remoteInputs.has(f)) return;
      fresh = true;
      this.remoteInputs.set(f, input);
      const used = this.usedRemote.get(f);
      if (used !== undefined && used !== input) rollbackTo = Math.min(rollbackTo, f);
    });
    while (this.remoteInputs.has(this.remoteContiguous + 1)) this.remoteContiguous++;
    if (rollbackTo !== Infinity) this.rollback(rollbackTo);
    this.advanceConfirmed();
    return fresh;
  }

  private stepOnce() {
    const f = this.state.frame + 1;
    const local = this.localFor(f);
    const remote = this.remoteFor(f);
    this.usedRemote.set(f, remote);
    const [a, b] = this.localSide === 0 ? [local, remote] : [remote, local];
    this.state = step(this.state, a, b, this.cfg);
    this.snapshots.set(f, this.state);
    this.snapshots.delete(f - SNAPSHOTS - MAX_PREDICT);
    this.usedRemote.delete(f - SNAPSHOTS - MAX_PREDICT - 64);
    if (this.state.events.length) {
      const fresh = this.state.events.filter((e) => {
        const key = `${f}:${e.type}:${e.who}`;
        if (this.playedEvents.has(key)) return false;
        this.playedEvents.add(key);
        return true;
      });
      if (fresh.length) this.onEvents(fresh, f);
    }
    if (this.playedEvents.size > 512) this.playedEvents = new Set([...this.playedEvents].slice(-256));
  }

  /** 回溯到第 f 幀之前的快照並重算到目前幀 */
  private rollback(f: number) {
    const target = this.state.frame;
    if (f > target) return;
    const snap = this.snapshots.get(f - 1);
    if (!snap) return; // 超出保存範圍（理論上不會發生，因為預測上限較小）
    this.rollbacks++;
    this.state = snap;
    while (this.state.frame < target) this.stepOnce();
  }

  advance() {
    this.stepOnce();
    this.advanceConfirmed();
  }

  private advanceConfirmed() {
    const limit = Math.min(this.remoteContiguous, this.state.frame);
    while (this.confirmed.frame < limit) {
      const s = this.snapshots.get(this.confirmed.frame + 1);
      if (!s) break;
      this.confirmed = s;
      if (s.frame % 30 === 0) {
        const h = hashState(s);
        this.confirmedHashes.set(s.frame, h);
        this.confirmedHashes.delete(s.frame - 30 * 20);
        this.onConfirmedHash(s.frame, h);
      }
    }
  }

  confirmedHash(): { frame: number; hash: number } {
    return { frame: this.confirmed.frame, hash: hashState(this.confirmed) };
  }

  hashAt(frame: number): number | null {
    return this.confirmedHashes.get(frame) ?? null;
  }

  /** 對帳失敗：以房主送來的確定狀態覆蓋並重算 */
  resync(remoteState: GameState) {
    const target = this.state.frame;
    this.state = cloneState(remoteState);
    this.snapshots.set(remoteState.frame, this.state);
    this.confirmed = this.state;
    while (this.state.frame < target) this.stepOnce();
  }

  /** 要送給對方的封包：最近 PACKET_FRAMES 幀的本地輸入 */
  packet(): InputPacket {
    const last = this.state.frame + this.delay;
    const start = Math.max(1, last - PACKET_FRAMES + 1);
    const inputs: number[] = [];
    for (let f = start; f <= last; f++) inputs.push(this.localFor(f));
    return { start, inputs, ack: this.remoteContiguous, frame: this.state.frame };
  }

  /** 本地領先對方的幀數（用於時鐘校正） */
  frameAdvantage(): number {
    return this.state.frame - this.remoteFrame;
  }
}
