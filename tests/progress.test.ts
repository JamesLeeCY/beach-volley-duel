import { describe, expect, it } from 'vitest';
import { dailyFor, dayDiff, emojiLine } from '../src/ui/daily';
import {
  ACHIEVEMENTS, emptyProgress, ensureTasks, exportCode, importCode, makeTasks, markDaily, ownedCosmetics, recordMatch, type MatchRecord,
} from '../src/ui/progress';
import { ROUTE, nextStation, stationHost } from '../src/ui/tour';
import { CONSERVATION, DEX, HABITAT_ROWS, isHome } from '../src/data/dex';
import { SCENES, type SceneId } from '../src/render/scenery';
import index from '../public/characters/index.json';

const CHARS = HABITAT_ROWS.flatMap((r) => r.ids).filter((id) => id !== 'baobao');
const ctx = { visibleChars: CHARS, scenes: SCENES };
const match = (m: Partial<MatchRecord> = {}): MatchRecord => ({
  mode: 'cpu', me: 'shishi', opp: 'meimei', scene: 'beach', won: true, score: [5, 2], spikes: 0, dives: 0, saveStreak: 0, ...m,
});

describe('動物圖鑑與陣容', () => {
  it('16 隻，4×4 排列順序和角色清單一致，每隻都有保育資料與冷知識', () => {
    expect(index).toEqual(HABITAT_ROWS.flatMap((r) => r.ids));
    expect(index).toHaveLength(16);
    for (const id of index) {
      expect(CONSERVATION[id], id).toBeDefined();
      expect(DEX[id].trivia.length, id).toBeGreaterThan(0);
      for (const s of DEX[id].home) expect(SCENES).toContain(s);
    }
    expect(index).not.toContain('yunyun');
    expect(index).not.toContain('goldie');
    expect(index).not.toContain('kiki');
  });

  it('主場：水獺在金門、櫻花鉤吻鮭在武陵', () => {
    expect(isHome('tata', 'kinmen')).toBe(true);
    expect(isHome('sakura', 'wuling')).toBe(true);
    expect(isHome('tata', 'beach')).toBe(false);
  });
});

describe('每日挑戰', () => {
  it('同一天所有人拿到同一關；不同天通常不同', () => {
    const a = dailyFor('2026-10-22', CHARS, SCENES);
    expect(dailyFor('2026-10-22', CHARS, SCENES)).toEqual(a);
    expect(a.no).toBe(1);
    expect(a.me).not.toBe(a.opp);
    const days = Array.from({ length: 14 }, (_, i) => dailyFor(`2026-11-${String(i + 1).padStart(2, '0')}`, CHARS, SCENES));
    expect(new Set(days.map((d) => `${d.me}-${d.opp}-${d.scene}`)).size).toBeGreaterThan(10);
    expect(new Set(days.map((d) => d.rule)).size).toBeGreaterThan(2);
  });

  it('emoji 戰績與日期差', () => {
    expect(emojiLine(['w', 'w', 'l', 'w'])).toBe('🟩🟩🟥🟩');
    expect(dayDiff('2026-12-31', '2027-01-01')).toBe(1);
  });

  it('連續天數：漏一天用補簽，漏兩天重來', () => {
    const p = emptyProgress();
    markDaily(p, '2026-10-22');
    markDaily(p, '2026-10-23');
    expect(p.daily.streak).toBe(2);
    markDaily(p, '2026-10-23');
    expect(p.daily.streak).toBe(2);
    expect(markDaily(p, '2026-10-25').usedMakeup).toBe(true);
    expect(p.daily.streak).toBe(3);
    expect(p.daily.makeups).toBe(0);
    markDaily(p, '2026-10-27');
    expect(p.daily.streak).toBe(1);
    expect(p.daily.best).toBe(3);
  });
});

describe('成就、任務、造型', () => {
  it('第一勝解鎖頭帶；完封解鎖墨鏡', () => {
    const p = emptyProgress();
    const out = recordMatch(p, match({ score: [5, 0] }), '2026-10-22', ctx);
    expect(out.newAch.map((a) => a.id)).toEqual(expect.arrayContaining(['firstWin', 'shutout']));
    expect(ownedCosmetics(p)).toEqual(expect.arrayContaining(['headband', 'sunglasses']));
    expect(recordMatch(p, match(), '2026-10-22', ctx).newAch).toEqual([]);
  });

  it('每日任務導向還沒玩過的角色與場景，完成得到星星', () => {
    const p = emptyProgress();
    for (const id of CHARS.slice(0, 14)) p.stats.playedBy[id] = 3;
    const t = makeTasks(p, '2026-10-22', CHARS, SCENES);
    expect(t).toHaveLength(3);
    expect(CHARS.slice(14)).toContain(t[0].arg);
    ensureTasks(p, '2026-10-22', CHARS, SCENES);
    const target = p.tasks.list[0].arg!;
    const out = recordMatch(p, match({ me: target, scene: p.tasks.list[1].arg as SceneId }), '2026-10-22', ctx);
    expect(out.tasksDone.length).toBeGreaterThanOrEqual(2);
    expect(p.stars).toBe(out.tasksDone.length);
  });

  it('每一個成就都有對應的造型（環島完成除外，它解鎖雲豹）', () => {
    for (const a of ACHIEVEMENTS) if (a.id !== 'tour') expect(a.reward, a.id).not.toBeNull();
  });

  it('進度碼可以匯出再匯入；壞掉的碼不接受', () => {
    const p = emptyProgress();
    p.unlocked.push('baobao');
    p.tour.stamps.push('taipei');
    p.stars = 7;
    const code = exportCode(p);
    expect(code.startsWith('TGV1.')).toBe(true);
    expect(importCode(code)).toEqual(p);
    expect(importCode('TGV1.abc')).toBeNull();
    expect(importCode('hello')).toBeNull();
  });
});

describe('環島巡迴賽', () => {
  it('12 站、每站不同場景；站長剛好是自己時換人', () => {
    expect(ROUTE).toHaveLength(12);
    expect(new Set(ROUTE.map((s) => s.scene)).size).toBe(12);
    expect(stationHost(ROUTE[0], 'hoho')).not.toBe('hoho');
    expect(nextStation([])).toBe(0);
    expect(nextStation(ROUTE.map((s) => s.scene))).toBe(-1);
  });
});
