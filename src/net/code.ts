// 房間碼：6 碼、排除容易混淆的 0/O/1/I。獨立成小模組，讓主程式不必一開始就載入 PeerJS。

export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

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
