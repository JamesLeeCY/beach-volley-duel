import { describe, expect, it } from 'vitest';
import { createState, defaultConfig, hashState, step } from '../src/engine/physics';
import { AiController } from '../src/engine/ai';
import { MatchRecorder, pickHighlight } from '../src/replay/recorder';

function playMatch() {
  const cfg = defaultConfig({ targetScore: 5 });
  let s = createState(7);
  const rec = new MatchRecorder(s, cfg, {
    chars: ['shishi', 'meimei'], scene: 'beach', ball: 'classic', hats: [null, null], night: false, humanSide: 0, fps: 60,
  });
  const a = [new AiController(0, 'hard', 1), new AiController(1, 'normal', 2)];
  const hashes: number[] = [];
  for (let f = 0; f < 20000 && s.winner < 0; f++) {
    const in1 = a[0].decide(s), in2 = a[1].decide(s);
    rec.push(in1, in2);
    const prev = s;
    s = step(s, in1, in2, cfg);
    rec.note(s.events, prev);
    hashes.push(hashState(s));
  }
  return { rec, hashes, final: s };
}

describe('精彩重播', () => {
  it('只記輸入就能完整重演：任何一幀的狀態都和實際比賽一模一樣', () => {
    const { rec, hashes, final } = playMatch();
    expect(final.winner).toBeGreaterThanOrEqual(0);
    for (const f of [1, 100, Math.floor(hashes.length / 2), hashes.length]) {
      expect(hashState(rec.stateAt(f)), `frame ${f}`).toBe(hashes[f - 1]);
    }
  });

  it('挑精彩球：每一分都有記錄，範圍是得分前 4 秒到得分後 1.2 秒', () => {
    const { rec, final } = playMatch();
    expect(rec.marks.length).toBe(final.score[0] + final.score[1]);
    const hl = pickHighlight(rec)!;
    expect(hl.at - hl.from).toBeLessThanOrEqual(240);
    expect(hl.to - hl.at).toBeLessThanOrEqual(72);
    // 優先挑自己（左邊）得分的球
    const mine = rec.marks.filter((m) => m.scorer === 0);
    if (mine.length) expect(rec.marks.find((m) => m.frame === hl.at)!.scorer).toBe(0);
  });

  it('沒有得分就沒有精彩球', () => {
    const rec = new MatchRecorder(createState(1), defaultConfig(), {
      chars: ['shishi', 'meimei'], scene: 'beach', ball: 'classic', hats: [null, null], night: false, humanSide: 0, fps: 60,
    });
    expect(pickHighlight(rec)).toBeNull();
  });
});
