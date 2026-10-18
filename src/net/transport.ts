// WebRTC 連線：用 PeerJS 公用信令伺服器配對（免自架後端，GitHub Pages 即可運作），
// 連通後另開一條不可靠、無序的 DataChannel 傳輸入；可靠通道傳房間事件。
import Peer, { type DataConnection } from 'peerjs';

const PREFIX = 'bvd-duel-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 排除 0/O/1/I
const CONNECT_TIMEOUT = 15000;

export function randomCode(): string {
  let s = '';
  const buf = new Uint32Array(6);
  crypto.getRandomValues(buf);
  for (const v of buf) s += CODE_CHARS[v % CODE_CHARS.length];
  return s;
}

export function normalizeCode(raw: string): string | null {
  const c = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.length !== 6 || [...c].some((ch) => !CODE_CHARS.includes(ch))) return null;
  return c;
}

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

  constructor(private ev: TransportEvents) {}

  /** 建立房間：等待對方加入 */
  host(onCode: (code: string) => void, attempt = 0) {
    this.isHost = true;
    this.code = randomCode();
    const peer = new Peer(PREFIX + this.code, { debug: 1 });
    this.peer = peer;
    peer.on('open', () => onCode(this.code));
    peer.on('connection', (conn) => {
      if (this.conn) {
        // 一房最多 2 人
        conn.on('open', () => {
          conn.send({ t: 'full' });
          setTimeout(() => conn.close(), 300);
        });
        return;
      }
      this.bind(conn);
    });
    peer.on('error', (err: Error & { type?: string }) => {
      if (err.type === 'unavailable-id' && attempt < 3) {
        peer.destroy();
        this.host(onCode, attempt + 1);
        return;
      }
      if (err.type === 'peer-unavailable') return;
      this.ev.onError(err.type ?? err.message);
    });
    peer.on('disconnected', () => {
      // 與信令伺服器斷線不影響已建立的 P2P 連線；尚未配對時嘗試重連
      if (!this.conn && !this.closed) peer.reconnect();
    });
  }

  /** 加入房間 */
  join(code: string) {
    this.isHost = false;
    this.code = code;
    const peer = new Peer({ debug: 1 });
    this.peer = peer;
    this.timeout = window.setTimeout(() => {
      if (!this.conn?.open) this.ev.onError('timeout');
    }, CONNECT_TIMEOUT);
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
      this.bind(conn);
    });
    peer.on('error', (err: Error & { type?: string }) => {
      this.ev.onError(err.type === 'peer-unavailable' ? 'room-not-found' : err.type ?? err.message);
    });
  }

  private bind(conn: DataConnection) {
    this.conn = conn;
    conn.on('open', () => {
      if (this.timeout) clearTimeout(this.timeout);
      this.setupFastChannel(conn);
      this.ev.onOpen();
    });
    conn.on('data', (data) => {
      const m = data as NetMessage;
      if (m && m.t === 'in' && Array.isArray(m.d)) {
        this.ev.onInput(new Uint8Array(m.d as number[]).buffer);
      } else if (m && typeof m.t === 'string') {
        this.ev.onMessage(m);
      }
    });
    conn.on('close', () => {
      if (!this.closed) this.ev.onClose();
    });
    conn.on('error', (e) => this.ev.onError(String(e)));
  }

  /** 不可靠、無序通道（雙方以相同 id 建立 negotiated channel，不需重新協商） */
  private setupFastChannel(conn: DataConnection) {
    const pc = conn.peerConnection;
    if (!pc) return;
    try {
      const ch = pc.createDataChannel('inputs', { negotiated: true, id: 100, ordered: false, maxRetransmits: 0 });
      ch.binaryType = 'arraybuffer';
      ch.onopen = () => (this.fast = ch);
      ch.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) this.ev.onInput(e.data);
      };
      ch.onclose = () => (this.fast = null);
    } catch {
      this.fast = null;
    }
  }

  get connected() {
    return !!this.conn?.open;
  }

  send(m: NetMessage) {
    if (this.conn?.open) this.conn.send(m);
  }

  sendInput(buf: ArrayBuffer) {
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
