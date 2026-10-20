// 錯誤紀錄：把執行時錯誤、繪圖錯誤、連線問題記在本機（最多 40 筆），
// 玩家可以在設定頁一鍵開 GitHub Issue 回報（內容先預填好，送出前可以自己檢查）。
// 只記錄錯誤訊息與環境資訊，不收集任何個人資料。

export interface ErrorEntry {
  time: string;
  kind: 'error' | 'promise' | 'frame' | 'net' | 'desync';
  message: string;
  stack?: string;
}

const KEY = 'bvd.errors.v1';
const MAX = 40;
const REPO_ISSUES = 'https://github.com/JamesLeeCY/beach-volley-duel/issues/new';

declare const __BUILD_VERSION__: string;
const VERSION = typeof __BUILD_VERSION__ === 'string' ? __BUILD_VERSION__ : 'dev';

function load(): ErrorEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ErrorEntry[]) : [];
  } catch {
    return [];
  }
}

let entries: ErrorEntry[] = load();
const listeners = new Set<() => void>();

export function recordError(kind: ErrorEntry['kind'], err: unknown) {
  const e = err instanceof Error ? err : null;
  const message = (e ? `${e.name}: ${e.message}` : String(err)).slice(0, 300);
  // 同一則訊息連續出現時只記一次
  const last = entries[entries.length - 1];
  if (last && last.message === message && last.kind === kind) return;
  entries.push({ time: new Date().toISOString(), kind, message, stack: e?.stack?.split('\n').slice(0, 6).join('\n') });
  if (entries.length > MAX) entries = entries.slice(-MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // 忽略
  }
  for (const l of listeners) l();
}

export function errorEntries(): readonly ErrorEntry[] {
  return entries;
}

export function clearErrors() {
  entries = [];
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 忽略
  }
  for (const l of listeners) l();
}

export function onErrorsChanged(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 監聽未處理的錯誤 */
export function installErrorLog() {
  window.addEventListener('error', (e) => recordError('error', e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => recordError('promise', e.reason));
}

/** 預填好內容的 GitHub Issue 網址（環境資訊＋最近 15 筆錯誤） */
export function issueUrl(extra: Record<string, unknown> = {}): string {
  const env = {
    version: VERSION,
    userAgent: navigator.userAgent,
    screen: `${screen.width}×${screen.height} @${devicePixelRatio}x`,
    viewport: `${innerWidth}×${innerHeight}`,
    touch: navigator.maxTouchPoints,
    ...extra,
  };
  const build = (n: number) => {
    const NL = '\n';
    const fence = '```';
    const recent = entries.slice(-n).map((e) => {
      const stack = e.stack ? `${NL}  ${fence}${NL}  ${e.stack.split(NL).join(`${NL}  `)}${NL}  ${fence}` : '';
      return `- ${e.time} [${e.kind}] ${e.message}${stack}`;
    });
    const body = [
      '## 發生了什麼事？',
      '（請描述你做了什麼、預期怎樣、實際發生什麼）',
      '',
      '## 環境',
      '```json',
      JSON.stringify(env, null, 2),
      '```',
      '',
      `## 最近的錯誤紀錄（共 ${entries.length} 筆，以下列出 ${Math.min(n, entries.length)} 筆）`,
      recent.length ? recent.join(NL) : '（沒有）',
    ].join(NL);
    const title = entries.length ? `問題回報：${entries[entries.length - 1].message.slice(0, 60)}` : '問題回報';
    return `${REPO_ISSUES}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  };
  // 網址太長時 GitHub 會拒絕：逐步減少附上的錯誤筆數
  for (let n = 15; n > 0; n--) {
    const url = build(n);
    if (url.length <= 7500) return url;
  }
  return build(0);
}
