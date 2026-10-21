// 每日挑戰：每天固定一組角色、對手、場景、電腦難度與特殊規則，所有人打同一關。
// 用日期當亂數種子，不需要後端。打完可以分享 Wordle 式的 emoji 戰績：
//   🏐 台灣金排球 #42 🟩🟩🟥🟩🟩 7:3
import type { Difficulty } from '../engine/ai';
import { Rng } from '../engine/rng';
import type { SceneId } from '../render/scenery';

export type DailyRule = 'none' | 'wind' | 'night' | 'melon' | 'boba';

export interface Daily {
  /** 第幾期（2026-10-22 是 #1） */
  no: number;
  date: string;
  me: string;
  opp: string;
  scene: SceneId;
  level: Difficulty;
  rule: DailyRule;
  target: number;
}

export const DAILY_START = '2026-10-22';
const RULES: DailyRule[] = ['none', 'wind', 'night', 'melon', 'boba', 'wind', 'none'];
/** 週一到週日的難度：週間輕鬆、週末比較難 */
const LEVELS: Difficulty[] = ['hard', 'easy', 'easy', 'normal', 'normal', 'normal', 'hard'];

/** 本機時區的日期字串 YYYY-MM-DD */
export function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 兩個 YYYY-MM-DD 相差幾天（b − a） */
export function dayDiff(a: string, b: string): number {
  const t = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((t(b) - t(a)) / 86_400_000);
}

function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function dailyFor(date: string, chars: readonly string[], scenes: readonly SceneId[]): Daily {
  const r = new Rng(seedOf(`daily:${date}`) | 0);
  const pick = <T,>(list: readonly T[]) => list[r.int(list.length)];
  const me = pick(chars);
  const others = chars.filter((c) => c !== me);
  const weekday = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10))).getUTCDay();
  return {
    no: dayDiff(DAILY_START, date) + 1,
    date,
    me,
    opp: pick(others.length ? others : chars),
    scene: pick(scenes),
    level: LEVELS[weekday],
    rule: pick(RULES),
    target: 5,
  };
}

/** 每一球的結果：w = 自己得分、l = 對手得分 */
export type Rally = 'w' | 'l';

export function emojiLine(rallies: readonly Rally[]): string {
  return rallies.map((x) => (x === 'w' ? '🟩' : '🟥')).join('');
}

export function dailyShareText(title: string, d: Daily, rallies: readonly Rally[], score: readonly [number, number], url: string) {
  return `🏐 ${title} #${d.no} ${emojiLine(rallies)} ${score[0]}:${score[1]}\n${url}`;
}
