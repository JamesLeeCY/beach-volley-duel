// 輕量成效追蹤：只送事件名稱與少數屬性，不送個人資料、不用 cookie。
// 支援 Plausible 或 GoatCounter（都不用 cookie），用建置時的環境變數開啟；都沒設定時完全不載入任何東西。
//   VITE_PLAUSIBLE_DOMAIN=jamesleecy.github.io  （可另設 VITE_PLAUSIBLE_SRC 指向自架的 script）
//   VITE_GOATCOUNTER=<你的 GoatCounter 代號>
// 漏斗：visit → match_start → match_end → rematch → share
type Props = Record<string, string | number | boolean>;

const PLAUSIBLE = import.meta.env.VITE_PLAUSIBLE_DOMAIN as string | undefined;
const PLAUSIBLE_SRC = (import.meta.env.VITE_PLAUSIBLE_SRC as string | undefined) || 'https://plausible.io/js/script.manual.js';
const GOAT = import.meta.env.VITE_GOATCOUNTER as string | undefined;

type W = Window & {
  plausible?: ((e: string, o?: { props?: Props; u?: string }) => void) & { q?: unknown[] };
  goatcounter?: { count?: (o: { path: string; title?: string; event?: boolean }) => void; no_onload?: boolean };
};

const queue: [string, Props][] = [];
let ready = false;

function addScript(src: string, attrs: Record<string, string>) {
  const s = document.createElement('script');
  s.async = true;
  s.src = src;
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  document.head.append(s);
  return s;
}

export function analyticsEnabled() {
  return !!(PLAUSIBLE || GOAT);
}

/** 載入追蹤程式並送出 visit（含距離第一次來訪的天數，用來算 D1／D7 回訪） */
export function initAnalytics() {
  if (!analyticsEnabled()) return;
  const w = window as W;
  if (PLAUSIBLE) {
    w.plausible = w.plausible || Object.assign((...a: unknown[]) => (w.plausible!.q = w.plausible!.q || []).push(a), { q: [] });
    addScript(PLAUSIBLE_SRC, { 'data-domain': PLAUSIBLE });
    // 網址上的邀請／挑戰參數不送出，只送路徑
    w.plausible('pageview', { u: location.origin + location.pathname });
  }
  if (GOAT) {
    w.goatcounter = { no_onload: true };
    const s = addScript('https://gc.zgo.at/count.js', { 'data-goatcounter': `https://${GOAT}.goatcounter.com/count` });
    s.addEventListener('load', () => {
      w.goatcounter?.count?.({ path: location.pathname });
      ready = true;
      for (const [e, p] of queue.splice(0)) send(e, p);
    });
  }
  track('visit', { day: daysSinceFirstVisit() });
}

const FIRST_KEY = 'bvd.firstVisit';

/** 0 = 第一天、1 = 隔天回來…（只存在本機） */
export function daysSinceFirstVisit(now = Date.now()): number {
  try {
    let first = Number(localStorage.getItem(FIRST_KEY));
    if (!first) {
      first = now;
      localStorage.setItem(FIRST_KEY, String(now));
    }
    return Math.max(0, Math.floor((now - first) / 86_400_000));
  } catch {
    return 0;
  }
}

function send(event: string, props: Props) {
  const w = window as W;
  if (PLAUSIBLE) w.plausible?.(event, { props, u: location.origin + location.pathname });
  if (GOAT && ready) {
    const tail = Object.entries(props).map(([k, v]) => `${k}=${v}`).join('&');
    w.goatcounter?.count?.({ path: `${event}${tail ? `?${tail}` : ''}`, title: event, event: true });
  }
}

/** 記錄一個事件；沒有開啟追蹤時什麼都不做 */
export function track(event: string, props: Props = {}) {
  if (!analyticsEnabled()) return;
  if (GOAT && !ready) queue.push([event, props]);
  else send(event, props);
  if (import.meta.env.DEV) console.debug('[track]', event, props);
}
