// 挑戰連結：網址帶上「我用哪個角色、打哪個電腦角色、在哪個場景、比分多少」，
// 朋友點開就直接打同一場，目標是打出比分享者更好的比分。
// 這裡只放純函式（產生／解析網址、戰績標題、比較比分），方便單元測試。
import type { Difficulty } from '../engine/ai';
import type { Lang } from '../i18n';
import type { SceneId } from '../render/scenery';

export interface Dare {
  /** 分享者用的角色（朋友預設也用這個角色） */
  me: string;
  /** 對手（電腦）的角色 */
  opp: string;
  scene: SceneId;
  /** 分享者觀點的比分：[自己, 對手] */
  score: [number, number];
  level: Difficulty;
  /** 幾分勝 */
  target: number;
}

const LEVELS: readonly Difficulty[] = ['beginner', 'easy', 'normal', 'hard'];
const ID = /^[a-z0-9_-]{1,32}$/;

export function dareUrl(base: string, d: Dare): string {
  const q = new URLSearchParams({
    vs: d.opp,
    as: d.me,
    scene: d.scene,
    score: `${d.score[0]}-${d.score[1]}`,
    lv: d.level,
    to: String(d.target),
  });
  return `${base}?${q}`;
}

/**
 * 解析網址參數；任何一項不合法（角色不存在、場景不認得、比分不合理）就整個不採用。
 * 網址是別人給的，所有值都只當資料使用，不會直接放進 HTML。
 */
export function parseDare(
  search: string,
  valid: { char: (id: string) => boolean; scenes: readonly SceneId[] },
): Dare | null {
  const q = new URLSearchParams(search);
  const opp = q.get('vs');
  if (!opp) return null;
  const me = q.get('as') ?? '';
  const scene = q.get('scene') as SceneId | null;
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(q.get('score') ?? '');
  const level = (q.get('lv') ?? 'normal') as Difficulty;
  const target = Number(q.get('to') ?? 7);
  if (!ID.test(opp) || !valid.char(opp)) return null;
  if (!ID.test(me) || !valid.char(me)) return null;
  if (!scene || !valid.scenes.includes(scene)) return null;
  if (!m || !LEVELS.includes(level)) return null;
  if (!Number.isInteger(target) || target < 3 || target > 21) return null;
  const score: [number, number] = [Number(m[1]), Number(m[2])];
  // 比賽一定有一方剛好打到目標分數
  if (Math.max(...score) < target || score[0] === score[1]) return null;
  return { me, opp, scene, score, level, target };
}

/** 比分差（自己 − 對手），越大越好 */
export const margin = (s: readonly [number, number]) => s[0] - s[1];

/** 這次的比分有沒有比分享者好：分差嚴格比較大 */
export function beats(mine: readonly [number, number], theirs: readonly [number, number]) {
  return margin(mine) > margin(theirs);
}

/**
 * 戰績標題：「我用石虎 7:3 打爆台灣黑熊 🏐」
 * self = false 時（同機雙人）不用「我」，改成「石虎 7:3 打爆台灣黑熊」
 */
export function headline(lang: Lang, me: string, opp: string, score: readonly [number, number], self = true): string {
  const d = margin(score);
  const s = `${score[0]}:${score[1]}`;
  if (lang === 'en') {
    const verb = d >= 4 ? 'crushed' : d >= 2 ? 'beat' : d > 0 ? 'edged' : d >= -2 ? 'narrowly lost to' : 'lost to';
    return self ? `My ${me} ${verb} ${opp} ${s} 🏐` : `${me} ${verb} ${opp} ${s} 🏐`;
  }
  const verb = d >= 4 ? '打爆' : d >= 2 ? '擊敗' : d > 0 ? '險勝' : d >= -2 ? '惜敗給' : '輸給';
  return self ? `我用${me} ${s} ${verb}${opp} 🏐` : `${me} ${s} ${verb}${opp} 🏐`;
}

/** 網址上的邀請／挑戰／每日挑戰參數（處理完就清掉，重新整理不會再觸發一次） */
const LINK_PARAMS = ['room', 'vs', 'as', 'scene', 'score', 'lv', 'to', 'daily', 'openExternalBrowser'];

export function hasLinkParams(search: string): boolean {
  const q = new URLSearchParams(search);
  return LINK_PARAMS.some((k) => q.has(k));
}

export function stripLinkParams(url: string): string {
  const u = new URL(url);
  for (const k of LINK_PARAMS) u.searchParams.delete(k);
  return u.pathname + (u.search === '?' ? '' : u.search) + u.hash;
}

/**
 * 分享出去的連結：請 LINE 改用手機預設的瀏覽器開啟（LINE 官方支援的參數）。
 * 內建瀏覽器不能加入主畫面、全螢幕與轉向支援較差，線上對戰也可能不穩。
 */
export function withExternalBrowser(url: string): string {
  const u = new URL(url);
  u.searchParams.set('openExternalBrowser', '1');
  return u.toString();
}

/** 是否為手機或平板（iPadOS 會偽裝成 Mac，用觸控點數判斷） */
export function isMobileDevice(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints ?? 0): boolean {
  return /Android|iPhone|iPad|iPod/i.test(ua) || (touchPoints > 1 && /Macintosh/.test(ua));
}

/**
 * LINE 分享網址：
 * - 手機：line.me/R/share，直接開 LINE App
 * - 電腦：LINE 官方的分享外掛（line.me/R/share 在電腦上會被導回首頁，內容會消失）
 */
export function lineShareUrl(text: string, url: string, mobile = isMobileDevice()): string {
  if (mobile) return `https://line.me/R/share?text=${encodeURIComponent(text)}`;
  return `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
}
