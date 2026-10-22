// WebRTC 的 ICE 伺服器（STUN 找自己的對外位址、TURN 在無法直連時中繼）。
// PeerJS 內建的免費 TURN 與常見的公用 TURN 目前都沒有回應：
// 手機 4G 對家裡 Wi-Fi、或路由器不支援回流（hairpin）時就無法連線，最後連線逾時。
// 所以中繼伺服器做成可設定（建置時的環境變數，沒設定就只用 STUN）：
//   VITE_TURN_ENDPOINT：回傳 ICE 伺服器清單的網址（例如 Metered 的
//     https://<app>.metered.live/api/v1/turn/credentials?apiKey=<key>，
//     或自己的 Cloudflare Worker 產生的短期憑證）；回傳陣列或 { iceServers: [...] } 都可以。
//   VITE_TURN_URLS／VITE_TURN_USER／VITE_TURN_CRED：固定的 TURN 帳號（逗號分隔多個網址）。

const STUN: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

const ENDPOINT = import.meta.env.VITE_TURN_ENDPOINT as string | undefined;
const URLS = import.meta.env.VITE_TURN_URLS as string | undefined;
const USER = import.meta.env.VITE_TURN_USER as string | undefined;
const CRED = import.meta.env.VITE_TURN_CRED as string | undefined;

export function turnConfigured(): boolean {
  return !!(ENDPOINT || URLS);
}

/** 把服務回傳的資料整理成 RTCIceServer[]（格式不對的項目略過） */
export function parseIceServers(data: unknown): RTCIceServer[] {
  const list = Array.isArray(data) ? data : (data as { iceServers?: unknown })?.iceServers;
  if (!Array.isArray(list)) return [];
  return list
    .filter((s): s is RTCIceServer => {
      const u = (s as RTCIceServer)?.urls;
      return typeof u === 'string' || (Array.isArray(u) && u.every((x) => typeof x === 'string'));
    })
    // 瀏覽器會擋 53 埠（Cloudflare 的清單裡有），留著只會多等一個逾時
    .map((s) => ({ ...s, urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u)) }))
    .filter((s) => (s.urls as string[]).length > 0);
}

let cached: Promise<RTCIceServer[]> | null = null;

/** 取得 ICE 伺服器；中繼憑證每 10 分鐘重新取一次（短期憑證會過期） */
export function iceServers(): Promise<RTCIceServer[]> {
  cached ??= load();
  return cached;
}

async function load(): Promise<RTCIceServer[]> {
  const out = [...STUN];
  if (URLS) out.push({ urls: URLS.split(',').map((u) => u.trim()).filter(Boolean), username: USER, credential: CRED });
  if (ENDPOINT) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 4000);
      const res = await fetch(ENDPOINT, { signal: ctl.signal });
      clearTimeout(timer);
      if (res.ok) out.push(...parseIceServers(await res.json()));
    } catch {
      // 取不到中繼憑證：只用 STUN，同一個 Wi-Fi 或一般網路仍可直連
    }
    setTimeout(() => (cached = null), 10 * 60_000);
  }
  return out;
}
