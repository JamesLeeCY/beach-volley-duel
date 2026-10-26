import { expect, test } from '@playwright/test';
import { app, newPlayer, waitScreen } from './helpers';

test('highlight replay: plays back the best point and records a video', async ({ browser }) => {
  const ctx = await newPlayer(browser);
  const page = await ctx.newPage();
  await page.goto('/');
  await waitScreen(page, 'title');
  // 兩邊都交給電腦，快轉打完一場 5 分賽
  await page.evaluate(async () => {
    const a = (window as any).app;
    a.chars = ['shishi', 'yueyue'];
    a.difficulty = 'normal';
    a.startLocalMatch('cpu', { target: 5 });
    const { AiController } = await import('/src/engine/ai.ts' as string);
    a.ais[0] = new AiController(0, 'hard', 5);
    for (let n = 0; n < 40000 && !a.resultShown; n++) a.tick();
  });
  await waitScreen(page, 'result');
  expect(await app(page, (a) => a.rec.marks.length)).toBeGreaterThan(0);

  await page.getByRole('button', { name: /Highlight replay/ }).click();
  await expect(page.locator('.replay-stage canvas')).toBeVisible();
  // 重播約 6～9 秒，錄好後換成影片
  const video = page.locator('.replay-stage video');
  await expect(video).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 10_000 }).toBe(864);
  await expect(page.getByRole('button', { name: 'Download video' })).toBeVisible();
  await ctx.close();
});
