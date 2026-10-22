// WebRTC 連線：用 PeerJS 公用信令伺服器配對（免自架後端，GitHub Pages 即可運作），
// 連通後另開一條不可靠、無序的 DataChannel 傳輸入；可靠通道傳房間事件。
import Peer, { type DataConnection, type PeerOptions } from 'peerjs';

/**
 * 測試用掛鉤（E2E 以 addInitScript 設定 window.__BVD_NET__）：改用本機信令伺服器，
 * 並在送出端模擬單向延遲與丟包。丟包只作用在輸入（不可靠通道）；可靠通道只加延遲、保持順序。
 */
interface NetTestHooks {
  peer?: PeerOptions;
  delayMs?: number;
  jitterMs?: number;
  loss?: number;
}
const hooks: NetTestHooks = (globalThis as { __BVD_NET__?: NetTestHooks }).__BVD_NET__ ?? {};

import { randomCode } from './code';
import { recordError } from '../ui/errorlog';
import { iceServers } from './ice';

export { normalizeCode, randomCode } from './code';

const PREFIX = 'bvd-duel-v1-';
/** 加入房間的等待時間（經過中繼伺服器時比較慢，給多一點時間） */
const CONNECT_TIMEOUT = 20000;

export type NetMessage = { t: string; [k: string]: unknown };

export interface TransportEvents {
  onOpen(): void;
  onMessage(m: NetMessage): void;
  onInput(buf: ArrayBuffer): void;
  onClose(): void;
  onError(msg: string): void;
}

export class Transport {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private fast: RTCDataChannel | null = null;
  code = '';
  isHost = false;
  private closed = false;
  private timeout: number | null = null;
  /** 曾經連上過：之後的錯誤視為斷線，交給重連處理而不是直接失敗 */
  private everConnected = false;

  constructor(private ev: TransportEvents) {}

  /** 建立房間：等待對方加入 */
  host(onCode: (code: string) => void, attempt = 0) {
    this.isHost = true;
    void iceServers().then((servers) => {
      if (!this.closed) this.startHost(onCode, attempt, servers);
    });
  }

  private startHost(onCode: (code: string) => void, attempt: number, servers: RTCIceServer[]) {
    this.code = randomCode();
    const peer = new Peer(PREFIX + this.code, { debug: 1, config: { iceServers: servers }, ...hooks.peer });
    this.peer = peer;
    peer.on('open', () => onCode(this.code));
    peer.on('connection', (conn) => {
      // 舊連線已斷（對方重連）時接受新連線；仍在線上時才算滿房
      if (this.conn?.open) {
        // 一房最多 2 人
        conn.on('open', () => {
          conn.send({ t: 'full' });
          setTimeout(() => conn.close(), 300);
        });
        return;
      }
      this.conn?.close();
      this.bind(conn);
    });
    peer.on('error', (err: Error & { type?: string }) => {
      if (err.type === 'unavailable-id' && attempt < 3) {
        peer.destroy();
        this.startHost(onCode, attempt + 1, servers);
        return;
      }
      if (err.type === 'peer-unavailable') return;
      this.ev.onError(err.type ?? err.message);
    });
    peer.on('disconnected', () => {
      // 與信令伺服器斷線不影響已建立的 P2P 連線，但要保持在線，對方斷線後才能重新連進來
      if (!this.closed) peer.reconnect();
    });
  }

  /** 加入房間 */
  join(code: string) {
    this.isHost = false;
    this.code = code;
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = window.setTimeout(() => {
      if (!this.conn?.open) this.ev.onError(this.timeoutReason());
    }, CONNECT_TIMEOUT);
    void iceServers().then((servers) => {
      if (!this.closed) this.startJoin(servers);
    });
  }

  /**
   * 逾時的原因：連不上配對伺服器（timeout-signal），
   * 或配對成功但找不到雙方之間的連線路徑（timeout-p2p，通常是需要中繼伺服器）。
   */
  private timeoutReason(): string {
    if (!this.peer?.open) return 'timeout-signal';
    const pc = this.conn?.peerConnection;
    recordError('net', `timeout: ice=${pc?.iceConnectionState ?? 'none'} gathering=${pc?.iceGatheringState ?? 'none'}`);
    return 'timeout-p2p';
  }

  private startJoin(servers: RTCIceServer[]) {
    const peer = new Peer({ debug: 1, config: { iceServers: servers }, ...hooks.peer });
    this.peer = peer;
    peer.on('open', () => {
      if (!this.conn?.open) this.dial();
    });
    peer.on('error', (err: Error & { type?: string }) => {
      // 比賽中斷線後的重連錯誤（例如房主暫時離線）不算失敗，下一輪再試
      if (this.everConnected) return;
      this.ev.onError(err.type === 'peer-unavailable' ? 'room-not-found' : err.type ?? err.message);
    });
  }

  private dial() {
    if (!this.peer || this.closed) return;
    const prev = this.conn;
    const conn = this.peer.connect(PREFIX + this.code, { reliable: true, serialization: 'json' });
    this.bind(conn);
    // 上一次撥號還沒連通就放棄它，免得房主接受了那條（之後不再理會的）連線而把新的撥號當成滿房
    if (prev && !prev.open) prev.close();
  }

  /** 加入者：斷線後重新連回同一個房間 */
  reconnect() {
    if (this.closed || this.isHost || !this.peer) return;
    if (this.conn?.open) return;
    if (this.peer.destroyed) {
      void iceServers().then((servers) => {
        if (!this.closed) this.startJoin(servers);
      });
    } else if (this.peer.disconnected) {
      this.peer.reconnect(); // 重新連上信令伺服器後，open 事件會自動撥號
    } else {
      this.dial();
    }
  }

  private bind(conn: DataConnection) {
    this.conn = conn;
    this.fast = null;
    conn.on('open', () => {
      if (conn !== this.conn) return;
      if (this.timeout) clearTimeout(this.timeout);
      this.everConnected = true;
      this.setupFastChannel(conn);
      this.ev.onOpen();
    });
    conn.on('data', (data) => {
      if (conn !== this.conn) return;
      const m = data as NetMessage;
      if (m && m.t === 'in' && Array.isArray(m.d)) {
        this.ev.onInput(new Uint8Array(m.d as number[]).buffer);
      } else if (m && typeof m.t === 'string') {
        this.ev.onMessage(m);
      }
    });
    conn.on('close', () => {
      if (conn === this.conn && !this.closed) this.ev.onClose();
    });
    conn.on('error', (e) => {
      if (conn !== this.conn) return;
      // 連上之後的錯誤（例如訊息太大）不中斷連線，只記錄下來
      if (!this.everConnected) this.ev.onError(String(e));
      else recordError('net', e);
    });
  }

  /** 不可靠、無序通道（雙方以相同 id 建立 negotiated channel，不需重新協商） */
  private setupFastChannel(conn: DataConnection) {
    const pc = conn.peerConnection;
    if (!pc) return;
    try {
      const ch = pc.createDataChannel('inputs', { negotiated: true, id: 100, ordered: false, maxRetransmits: 0 });
      ch.binaryType = 'arraybuffer';
      ch.onopen = () => {
        if (conn === this.conn) this.fast = ch;
      };
      ch.onmessage = (e) => {
        if (conn === this.conn && e.data instanceof ArrayBuffer) this.ev.onInput(e.data);
      };
      ch.onclose = () => {
        if (this.fast === ch) this.fast = null;
      };
    } catch {
      this.fast = null;
    }
  }

  get connected() {
    return !!this.conn?.open;
  }

  /** 測試用：模擬網路中斷（不送 bye，對方會進入重連流程） */
  dropForTest() {
    this.conn?.close();
  }

  send(m: NetMessage) {
    if (hooks.delayMs) {
      setTimeout(() => this.sendNow(m), hooks.delayMs);
      return;
    }
    this.sendNow(m);
  }

  private sendNow(m: NetMessage) {
    if (this.conn?.open) this.conn.send(m);
  }

  sendInput(buf: ArrayBuffer) {
    if (hooks.loss && Math.random() < hooks.loss) return;
    if (hooks.delayMs || hooks.jitterMs) {
      const copy = buf.slice(0);
      setTimeout(() => this.sendInputNow(copy), (hooks.delayMs ?? 0) + Math.random() * (hooks.jitterMs ?? 0));
      return;
    }
    this.sendInputNow(buf);
  }

  private sendInputNow(buf: ArrayBuffer) {
    if (this.fast && this.fast.readyState === 'open') {
      this.fast.send(buf);
    } else if (this.conn?.open) {
      this.conn.send({ t: 'in', d: Array.from(new Uint8Array(buf)) });
    }
  }

  close() {
    this.closed = true;
    if (this.timeout) clearTimeout(this.timeout);
    try {
      this.conn?.send({ t: 'bye' });
    } catch {
      // 忽略
    }
    setTimeout(() => {
      this.conn?.close();
      this.peer?.destroy();
    }, 100);
  }
}
