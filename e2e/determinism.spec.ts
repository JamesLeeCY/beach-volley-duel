import { expect, test } from '@playwright/test';
import { createState, defaultConfig, hashState, step } from '../src/engine/physics';
import { AiController } from '../src/engine/ai';

/** 同一份種子與輸入，在瀏覽器（Chromium、WebKit）與 Node 跑出的每段 hash 必須完全相同 */
function runAiMatch(seed: number, frames: number) {
  const cfg = defaultConfig({ targetScore: 99, balance: false, stats: [{ speed: 2, jump: -1, power: 1 }, { speed: -1, jump: 2, power: -2 }] });
  let s = createState(seed);
  const a = new AiController(0, 'hard', seed + 1);
  const b = new AiController(1, 'normal', seed + 2);
  const hashes: number[] = [];
  for (let i = 1; i <= frames; i++) {
    s = step(s, a.decide(s), b.decide(s), cfg);
    if (i % 500 === 0) hashes.push(hashState(s));
  }
  return hashes;
}

test('determinism: browser engine matches Node bit-for-bit', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).app?.screenName === 'title');
  const inBrowser = await page.evaluate(async () => {
    const physics = await import('/src/engine/physics.ts' as string);
    const ai = await import('/src/engine/ai.ts' as string);
    const cfg = physics.defaultConfig({ targetScore: 99, balance: false, stats: [{ speed: 2, jump: -1, power: 1 }, { speed: -1, jump: 2, power: -2 }] });
    let s = physics.createState(4242);
    const a = new ai.AiController(0, 'hard', 4243);
    const b = new ai.AiController(1, 'normal', 4244);
    const hashes: number[] = [];
    for (let i = 1; i <= 10000; i++) {
      s = physics.step(s, a.decide(s), b.decide(s), cfg);
      if (i % 500 === 0) hashes.push(physics.hashState(s));
    }
    return hashes;
  });
  expect(inBrowser).toEqual(runAiMatch(4242, 10000));
});
