import { describe, expect, it } from 'vitest';
import { createState, defaultConfig, hashState, step } from '../src/engine/physics';
import { Rng } from '../src/engine/rng';
import { RollbackSession, decodePacket, encodePacket, type InputPacket } from '../src/net/rollback';

/** 模擬兩端：每 tick 雙方各取樣輸入並推進；封包隨機延遲 0..maxDelay tick、可丟包 */
function simulate(seed: number, ticks: number, maxDelay: number, loss: number, delayFrames: number) {
  const cfg = defaultConfig();
  const init = createState(seed);
  const a = new RollbackSession(init, cfg, 0, delayFrames);
  const b = new RollbackSession(init, cfg, 1, delayFrames);
  const r = new Rng(seed * 7 + 1);
  const queue: { at: number; to: RollbackSession; pkt: ArrayBuffer }[] = [];
  let ia = 0;
  let ib = 0;
  for (let t = 0; t < ticks; t++) {
    for (const [s, other] of [[a, b], [b, a]] as const) {
      if (r.int(5) === 0) {
        if (s === a) ia = r.int(32);
        else ib = r.int(32);
      }
      if (s.canAdvance() && s.frame < ticks) {
        s.addLocalInput(s === a ? ia : ib);
        s.advance();
      }
      if (r.int(100) >= loss) queue.push({ at: t + r.int(maxDelay + 1), to: other, pkt: encodePacket(s.packet()) });
    }
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].at <= t) {
        const p = decodePacket(queue[i].pkt) as InputPacket;
        queue[i].to.receive(p);
        queue.splice(i, 1);
      }
    }
  }
  // 收尾：持續交換直到雙方都確定到最後一幀
  for (let k = 0; k < 200; k++) {
    for (const [s, other] of [[a, b], [b, a]] as const) {
      if (s.canAdvance() && s.frame < ticks) {
        s.addLocalInput(0);
        s.advance();
      }
      other.receive(decodePacket(encodePacket(s.packet()))!);
    }
  }
  return { a, b, cfg, init };
}

describe('rollback', () => {
  it('封包編碼可還原', () => {
    const p = { start: 123456, inputs: [1, 2, 31, 0, 16], ack: -1, frame: 99 };
    expect(decodePacket(encodePacket(p))).toEqual(p);
  });

  it('對方輸入隨機延遲 0～8 幀後重算，雙方最終狀態一致且等於即時輸入版本', () => {
    for (const seed of [1, 2, 3]) {
      const { a, b, cfg, init } = simulate(seed, 1500, 8, 0, 2);
      expect(a.frame).toBe(1500);
      expect(b.frame).toBe(1500);
      expect(hashState(a.state)).toBe(hashState(b.state));
      // 以雙方實際的輸入重跑一次「無延遲」版本
      let s = init;
      for (let f = 1; f <= 1500; f++) s = step(s, a.localInputs.get(f) ?? 0, b.localInputs.get(f) ?? 0, cfg);
      expect(hashState(s)).toBe(hashState(a.state));
      expect(a.rollbacks + b.rollbacks).toBeGreaterThan(0);
    }
  });

  it('丟包 5% 仍能收斂', () => {
    const { a, b } = simulate(9, 1000, 4, 5, 1);
    expect(hashState(a.state)).toBe(hashState(b.state));
    expect(a.confirmed.frame).toBe(1000);
  });
});
