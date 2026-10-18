// mulberry32：32 位元整數 PRNG，狀態只是一個整數，可存進 GameState。

export function nextRng(state: number): [value: number, state: number] {
  const s = (state + 0x6d2b79f5) | 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [(t ^ (t >>> 14)) >>> 0, s];
}

/** 可變的 RNG 包裝，給引擎外（AI、測試）使用 */
export class Rng {
  constructor(public state: number) {}
  next(): number {
    const [v, s] = nextRng(this.state);
    this.state = s;
    return v;
  }
  /** [0, n) 的整數 */
  int(n: number): number {
    return this.next() % n;
  }
  /** 0..99 */
  percent(): number {
    return this.int(100);
  }
}
