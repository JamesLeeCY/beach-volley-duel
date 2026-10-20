import { describe, expect, it } from 'vitest';
import { createState, defaultConfig, step } from '../src/engine/physics';
import { AiController } from '../src/engine/ai';
import { FP, NET_X } from '../src/engine/constants';
import { IN_RIGHT, IN_UP } from '../src/engine/types';
import { STAGE_COUNT, STAGE_DIFFS, buildStages } from '../src/ui/challenge';
import { TUTORIAL_STEPS, Tutorial } from '../src/ui/tutorial';

describe('闖關挑戰', () => {
  it('6 關：其他角色依序上場，最後一關是鏡像對決，難度遞增', () => {
    const all = ['kiki', 'goldie', 'glidey', 'lanlan', 'yueyue', 'mikado'];
    const st = buildStages('glidey', all);
    expect(st).toHaveLength(STAGE_COUNT);
    expect(st.slice(0, 5)).toEqual(['kiki', 'goldie', 'lanlan', 'yueyue', 'mikado']);
    expect(st[5]).toBe('glidey');
    expect(STAGE_DIFFS[0]).toBe('beginner');
    expect(STAGE_DIFFS[5]).toBe('hard');
  });

  it('角色很少時也能湊滿 6 關', () => {
    expect(buildStages('a', ['a', 'b'])).toHaveLength(STAGE_COUNT);
    expect(buildStages('a', ['a'])).toHaveLength(STAGE_COUNT);
  });
});

describe('入門難度', () => {
  it('入門 AI 明顯比困難 AI 弱', () => {
    const cfg = defaultConfig({ targetScore: 999 });
    let s = createState(21);
    const a = new AiController(0, 'beginner', 1);
    const b = new AiController(1, 'hard', 2);
    for (let i = 0; i < 40000; i++) s = step(s, a.decide(s), b.decide(s), cfg);
    expect(s.score[1]).toBeGreaterThan(s.score[0] * 2);
  });
});

describe('新手教學', () => {
  it('依序完成：移動、跳、接球、過網', () => {
    const cfg = defaultConfig({ practice: true });
    let s = createState(1, 0);
    const tut = new Tutorial(s);
    // 移動
    for (let i = 0; i < 10; i++) {
      s = step(s, IN_RIGHT, 0, cfg);
      tut.update(s, s.events);
    }
    expect(tut.step).toBe(1);
    // 跳
    s = step(s, IN_UP, 0, cfg);
    tut.update(s, s.events);
    expect(tut.step).toBe(2);
    // 接球：發出接球事件
    tut.update(s, [{ type: 'bump', who: 0, x: 0, y: 0 }]);
    expect(tut.step).toBe(3);
    // 過網
    tut.update({ ...s, ball: { ...s.ball, lastTouch: 0, x: (NET_X + 30) * FP } }, []);
    expect(tut.step).toBe(4);
  });

  it('扣殺、往下重扣、魚躍', () => {
    const s = createState(1, 0);
    const tut = new Tutorial(s);
    tut.step = 4;
    tut.update(s, [{ type: 'spike', who: 0, x: 0, y: 0 }]);
    expect(tut.step).toBe(5);
    // 往下重扣：一般扣殺（球沒往下）不算
    tut.update({ ...s, ball: { ...s.ball, vy: 0 } }, [{ type: 'spike', who: 0, x: 0, y: 0 }]);
    expect(tut.step).toBe(5);
    tut.update({ ...s, ball: { ...s.ball, vy: 15 * FP } }, [{ type: 'spike', who: 0, x: 0, y: 0 }]);
    expect(tut.step).toBe(6);
    tut.update(s, [{ type: 'dive', who: 0, x: 0, y: 0 }]);
    expect(tut.finished).toBe(true);
    expect(TUTORIAL_STEPS).toHaveLength(7);
  });
});
