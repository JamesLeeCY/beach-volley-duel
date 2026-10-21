// 玩家進度（存在本機 localStorage）：隱藏角色、環島集章、每日挑戰連續天數、成就、每日任務、造型。
// 可以匯出成一段「進度碼」備份，換裝置時再匯入。
// 這裡的函式大多是純函式（傳入進度、回傳結果），方便單元測試；存檔由 load/save 負責。
import type { SceneId } from '../render/scenery';
import { dayDiff } from './daily';

export interface MatchRecord {
  mode: 'cpu' | 'local' | 'online' | 'challenge' | 'dare' | 'daily' | 'tour';
  /** 自己的角色、對手角色 */
  me: string;
  opp: string;
  scene: SceneId;
  won: boolean;
  score: [number, number];
  /** 這場自己的扣殺、魚躍次數 */
  spikes: number;
  dives: number;
  /** 這場最多連續救起幾次對手的扣殺 */
  saveStreak: number;
}

export interface Progress {
  unlocked: string[];
  tour: { stamps: SceneId[]; hardStamps: SceneId[] };
  daily: { last: string; streak: number; best: number; makeups: number; played: Record<string, { won: boolean; score: [number, number]; emoji: string }> };
  ach: Record<string, string>;
  stats: {
    matches: number;
    wins: number;
    spikes: number;
    dives: number;
    winsBy: Record<string, number>;
    winsAt: Record<string, number>;
    playedBy: Record<string, number>;
    playedAt: Record<string, number>;
  };
  tasks: { date: string; list: Task[] };
  stars: number;
  cosmetics: { equipped: string | null };
}

export function emptyProgress(): Progress {
  return {
    unlocked: [],
    tour: { stamps: [], hardStamps: [] },
    daily: { last: '', streak: 0, best: 0, makeups: 1, played: {} },
    ach: {},
    stats: { matches: 0, wins: 0, spikes: 0, dives: 0, winsBy: {}, winsAt: {}, playedBy: {}, playedAt: {} },
    tasks: { date: '', list: [] },
    stars: 0,
    cosmetics: { equipped: null },
  };
}

const KEY = 'bvd.progress.v1';

function merge(raw: unknown): Progress {
  const d = emptyProgress();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<Progress>;
  return {
    ...d,
    ...r,
    tour: { ...d.tour, ...r.tour },
    daily: { ...d.daily, ...r.daily },
    stats: { ...d.stats, ...r.stats },
    tasks: { ...d.tasks, ...r.tasks },
    cosmetics: { ...d.cosmetics, ...r.cosmetics },
  };
}

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return merge(JSON.parse(raw));
  } catch {
    // 無痕模式等：從頭開始
  }
  return emptyProgress();
}

export function saveProgress(p: Progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // 忽略
  }
}

// ---------------------------------------------------------------- 進度碼
/** 進度 → 一段可以複製貼上的文字（base64 的 JSON） */
export function exportCode(p: Progress): string {
  const json = JSON.stringify(p);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return 'TGV1.' + btoa(bin);
}

export function importCode(code: string): Progress | null {
  const m = /^TGV1\.([A-Za-z0-9+/=]+)$/.exec(code.trim());
  if (!m) return null;
  try {
    const bin = atob(m[1]);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || typeof data !== 'object' || !Array.isArray(data.unlocked)) return null;
    return merge(data);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- 成就
export interface Achievement {
  id: string;
  /** 解鎖的造型（沒有就是 null） */
  reward: string | null;
  check(p: Progress, m: MatchRecord | null, ctx: { visibleChars: readonly string[]; scenes: readonly SceneId[] }): boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'firstWin', reward: 'headband', check: (p) => p.stats.wins >= 1 },
  { id: 'shutout', reward: 'sunglasses', check: (_p, m) => !!m && m.won && m.score[1] === 0 && m.score[0] >= 5 },
  { id: 'save5', reward: 'straw', check: (_p, m) => !!m && m.saveStreak >= 5 },
  { id: 'spike100', reward: 'cap', check: (p) => p.stats.spikes >= 100 },
  { id: 'allAnimals', reward: 'crown', check: (p, _m, c) => c.visibleChars.every((id) => (p.stats.winsBy[id] ?? 0) > 0) },
  { id: 'allScenes', reward: 'lei', check: (p, _m, c) => c.scenes.every((s) => (p.stats.winsAt[s] ?? 0) > 0) },
  { id: 'daily3', reward: 'cny', check: (p) => p.daily.best >= 3 },
  { id: 'daily7', reward: 'goggles', check: (p) => p.daily.best >= 7 },
  { id: 'tour', reward: null, check: (p) => p.tour.stamps.length >= 12 },
  { id: 'tourHard', reward: 'goldcrown', check: (p) => p.tour.hardStamps.length >= 12 },
];

/** 造型：成就獎勵＋星星（每日任務）兌換 */
export const COSMETICS = ['headband', 'straw', 'sunglasses', 'cap', 'flower', 'party', 'cny', 'goggles', 'lei', 'crown', 'goldcrown'] as const;
export type Cosmetic = (typeof COSMETICS)[number];
/** 用星星解鎖的造型：累積幾顆星 */
export const STAR_REWARDS: Partial<Record<Cosmetic, number>> = { flower: 3, party: 9 };

export function ownedCosmetics(p: Progress): Cosmetic[] {
  const fromAch = ACHIEVEMENTS.filter((a) => a.reward && p.ach[a.id]).map((a) => a.reward as Cosmetic);
  const fromStars = (Object.entries(STAR_REWARDS) as [Cosmetic, number][]).filter(([, n]) => p.stars >= n).map(([c]) => c);
  return COSMETICS.filter((c) => fromAch.includes(c) || fromStars.includes(c));
}

// ---------------------------------------------------------------- 每日任務
export type TaskKind = 'winWith' | 'playAt' | 'spikes' | 'dives' | 'daily' | 'win';

export interface Task {
  kind: TaskKind;
  /** winWith 的角色、playAt 的場景 */
  arg?: string;
  /** spikes／dives 的目標次數 */
  n?: number;
  /** 目前進度 */
  have: number;
  done: boolean;
}

function seeded(date: string) {
  let h = 2166136261;
  for (const c of date) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** 今天的 3 個小任務：把玩家導向還沒玩過（或玩得最少）的角色與場景 */
export function makeTasks(p: Progress, date: string, chars: readonly string[], scenes: readonly SceneId[]): Task[] {
  const r = seeded(date);
  const least = <T extends string>(list: readonly T[], played: Record<string, number>) => {
    const min = Math.min(...list.map((x) => played[x] ?? 0));
    const pool = list.filter((x) => (played[x] ?? 0) === min);
    return pool[Math.floor(r() * pool.length)];
  };
  const third: Task = r() < 0.5 ? { kind: 'spikes', n: 10, have: 0, done: false } : { kind: 'dives', n: 3, have: 0, done: false };
  return [
    { kind: 'winWith', arg: least(chars, p.stats.playedBy), have: 0, done: false },
    { kind: 'playAt', arg: least(scenes, p.stats.playedAt), have: 0, done: false },
    r() < 0.4 ? { kind: 'daily', have: 0, done: false } : third,
  ];
}

/** 換日時重新產生任務 */
export function ensureTasks(p: Progress, date: string, chars: readonly string[], scenes: readonly SceneId[]) {
  if (p.tasks.date !== date) p.tasks = { date, list: makeTasks(p, date, chars, scenes) };
}

// ---------------------------------------------------------------- 每日挑戰連續天數
/**
 * 記錄今天打過每日挑戰。昨天也有打 → 連續 +1；只漏了一天且還有「補簽」→ 用掉一次補簽，
 * 連續不中斷；否則從 1 重新開始。每連續 7 天送一次補簽（最多 2 次）。
 */
export function markDaily(p: Progress, date: string): { usedMakeup: boolean } {
  const d = p.daily;
  if (d.last === date) return { usedMakeup: false };
  const gap = d.last ? dayDiff(d.last, date) : Infinity;
  let usedMakeup = false;
  if (gap === 1) d.streak++;
  else if (gap === 2 && d.makeups > 0) {
    d.makeups--;
    d.streak++;
    usedMakeup = true;
  } else d.streak = 1;
  d.last = date;
  d.best = Math.max(d.best, d.streak);
  if (d.streak % 7 === 0) d.makeups = Math.min(2, d.makeups + 1);
  return { usedMakeup };
}

// ---------------------------------------------------------------- 一場比賽結束
export interface MatchOutcome {
  newAch: Achievement[];
  tasksDone: Task[];
  newCosmetics: Cosmetic[];
}

export function recordMatch(
  p: Progress, m: MatchRecord, date: string,
  ctx: { visibleChars: readonly string[]; scenes: readonly SceneId[] },
): MatchOutcome {
  const before = ownedCosmetics(p);
  const s = p.stats;
  s.matches++;
  s.spikes += m.spikes;
  s.dives += m.dives;
  s.playedBy[m.me] = (s.playedBy[m.me] ?? 0) + 1;
  s.playedAt[m.scene] = (s.playedAt[m.scene] ?? 0) + 1;
  if (m.won) {
    s.wins++;
    s.winsBy[m.me] = (s.winsBy[m.me] ?? 0) + 1;
    s.winsAt[m.scene] = (s.winsAt[m.scene] ?? 0) + 1;
  }
  // 每日任務
  ensureTasks(p, date, ctx.visibleChars, ctx.scenes);
  const tasksDone: Task[] = [];
  for (const t of p.tasks.list) {
    if (t.done) continue;
    if (t.kind === 'winWith' && m.won && m.me === t.arg) t.have = 1;
    if (t.kind === 'playAt' && m.scene === t.arg) t.have = 1;
    if (t.kind === 'spikes') t.have += m.spikes;
    if (t.kind === 'dives') t.have += m.dives;
    if (t.kind === 'daily' && m.mode === 'daily') t.have = 1;
    if (t.kind === 'win' && m.won) t.have = 1;
    if (t.have >= (t.n ?? 1)) {
      t.done = true;
      p.stars++;
      tasksDone.push(t);
    }
  }
  const newAch = checkAchievements(p, m, ctx);
  const after = ownedCosmetics(p);
  return { newAch, tasksDone, newCosmetics: after.filter((c) => !before.includes(c)) };
}

export function checkAchievements(
  p: Progress, m: MatchRecord | null, ctx: { visibleChars: readonly string[]; scenes: readonly SceneId[] },
): Achievement[] {
  const out: Achievement[] = [];
  for (const a of ACHIEVEMENTS) {
    if (p.ach[a.id]) continue;
    if (a.check(p, m, ctx)) {
      p.ach[a.id] = new Date().toISOString().slice(0, 10);
      out.push(a);
    }
  }
  return out;
}
