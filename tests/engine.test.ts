import { describe, expect, it } from 'vitest';
import * as C from '../src/engine/constants';
import { createState, defaultConfig, hashState, step } from '../src/engine/physics';
import { AiController } from '../src/engine/ai';
import { Rng } from '../src/engine/rng';
import { IN_HIT, IN_RIGHT, IN_UP, Phase, type GameState } from '../src/engine/types';

function randomInputs(seed: number, n: number): [number, number][] {
  const r = new Rng(seed);
  const out: [number, number][] = [];
  let a = 0;
  let b = 0;
  for (let i = 0; i < n; i++) {
    // 輸入維持數幀，比較像真人
    if (r.int(4) === 0) a = r.int(32);
    if (r.int(4) === 0) b = r.int(32);
    out.push([a, b]);
  }
  return out;
}

function run(seed: number, inputs: [number, number][]): number[] {
  const cfg = defaultConfig();
  let s = createState(seed);
  const hashes: number[] = [];
  for (const [a, b] of inputs) {
    s = step(s, a, b, cfg);
    hashes.push(hashState(s));
  }
  return hashes;
}

describe('決定性', () => {
  it('同種子 + 同輸入跑 10,000 幀，每幀 hash 相同', () => {
    const inputs = randomInputs(42, 10_000);
    expect(run(1234, inputs)).toEqual(run(1234, inputs));
  });

  it('不同種子結果不同', () => {
    const inputs = randomInputs(7, 3000);
    expect(run(1, inputs)).not.toEqual(run(2, inputs));
  });

  it('step 不修改輸入的 state', () => {
    const s = createState(5);
    const before = JSON.stringify(s);
    step(s, IN_RIGHT | IN_UP, IN_HIT, defaultConfig());
    expect(JSON.stringify(s)).toBe(before);
  });

  it('狀態中只有整數', () => {
    const inputs = randomInputs(9, 5000);
    const cfg = defaultConfig({ balance: false, stats: [{ speed: 2, jump: -1, power: 1 }, { speed: -1, jump: 2, power: -1 }] });
    let s = createState(9);
    for (const [a, b] of inputs) {
      s = step(s, a, b, cfg);
      const nums = [s.ball.x, s.ball.y, s.ball.vx, s.ball.vy, ...s.players.flatMap((p) => [p.x, p.y, p.vx, p.vy])];
      for (const n of nums) expect(Number.isInteger(n)).toBe(true);
    }
  });
});

describe('物理', () => {
  function invariants(s: GameState) {
    const FP = C.FP;
    // 角色不越過中線
    expect(s.players[0].x).toBeLessThanOrEqual(C.PLAYER_MAX_X[0] * FP);
    expect(s.players[1].x).toBeGreaterThanOrEqual(C.PLAYER_MIN_X[1] * FP);
    // 球不卡牆
    expect(s.ball.x).toBeGreaterThanOrEqual(C.BALL_R * FP);
    expect(s.ball.x).toBeLessThanOrEqual((C.FIELD_W - C.BALL_R) * FP);
    // 球在網頂以下時不會與網子重疊
    if (s.ball.y >= C.NET_TOP_Y * FP) {
      expect(Math.abs(s.ball.x - C.NET_X * FP)).toBeGreaterThanOrEqual((C.BALL_R + C.NET_HALF_W) * FP);
    }
  }

  it('AI 對打 20,000 幀維持不變量', () => {
    const cfg = defaultConfig({ targetScore: 99 });
    let s = createState(77);
    const a = new AiController(0, 'hard', 1);
    const b = new AiController(1, 'normal', 2);
    let prevSide = 0;
    for (let i = 0; i < 20_000; i++) {
      const prevX = s.ball.x;
      s = step(s, a.decide(s), b.decide(s), cfg);
      invariants(s);
      // 球不穿網：網頂以下換邊即為穿網
      if (s.phase === Phase.Play && s.ball.y > (C.NET_TOP_Y + 4) * C.FP) {
        const side = s.ball.x < C.NET_X * C.FP ? -1 : 1;
        const was = prevX < C.NET_X * C.FP ? -1 : 1;
        if (prevSide !== 0) expect(side).toBe(was);
      }
      prevSide = 1;
    }
    expect(s.score[0] + s.score[1]).toBeGreaterThan(5);
  });

  it('球落在 1P 半場時 2P 得分並發球', () => {
    const cfg = defaultConfig();
    let s = createState(3, 0);
    // 1P 不動；發球直接落在 1P 頭上會被頂起，因此把 1P 移到最右邊
    for (let i = 0; i < 300 && s.score[0] + s.score[1] === 0; i++) s = step(s, IN_RIGHT, 0, cfg);
    expect(s.score).toEqual([0, 1]);
    expect(s.server).toBe(1);
    for (let i = 0; i < C.SCORED_FRAMES; i++) s = step(s, 0, 0, cfg);
    expect(s.phase).toBe(Phase.Play);
    expect(s.ball.x).toBe(C.BALL_SERVE_X[1] * C.FP);
  });

  it('先達目標分數者獲勝', () => {
    const cfg = defaultConfig({ targetScore: 5 });
    let s = createState(3, 0);
    for (let i = 0; i < 5000 && s.phase !== Phase.Over; i++) s = step(s, IN_RIGHT, 0, cfg);
    expect(s.phase).toBe(Phase.Over);
    expect(s.winner).toBe(1);
    expect(s.score[1]).toBe(5);
  });

  it('練習模式不計分', () => {
    const cfg = defaultConfig({ practice: true });
    let s = createState(3, 0);
    for (let i = 0; i < 2000; i++) s = step(s, IN_RIGHT, 0, cfg);
    expect(s.score).toEqual([0, 0]);
    expect(s.phase).not.toBe(Phase.Over);
  });
});
