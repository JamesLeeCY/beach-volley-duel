import { expect, test, type Page } from '@playwright/test';
import { app, newPlayer, waitScreen } from './helpers';

/** 攔下 window.open，記錄要開的網址（LINE 分享） */
async function captureOpen(page: Page) {
  await page.evaluate(() => {
    (window as any).__opened = [];
    window.open = ((url: string) => {
      (window as any).__opened.push(url);
      return null;
    }) as typeof window.open;
  });
}

/** 直接把比分改成打完，叫出結算畫面 */
async function finish(page: Page, score: [number, number]) {
  await page.evaluate((s) => {
    const a = (window as any).app;
    a.running = false;
    a.state.score = s;
    a.showResult(s[0] > s[1] ? 0 : 1);
  }, score);
  await waitScreen(page, 'result');
}

test('title: one tap starts a coached first match vs a beginner CPU, then a challenge link is shared', async ({ browser }) => {
  const ctx = await newPlayer(browser, {}, { firstMatchDone: false });
  const page = await ctx.newPage();
  await page.goto('/');
  await waitScreen(page, 'title');
  await page.getByRole('button', { name: '▶ Start' }).click();

  expect(await app(page, (a) => [a.mode, a.difficulty, a.cfg.targetScore, a.chars[0]])).toEqual(['cpu', 'beginner', 5, 'goldie']);
  const coach = page.locator('.coach');
  await expect(coach).toContainText('First match');
  // 往右走：第一句提示（移動）完成，閃一下「Nice!」後換成下一句
  await page.keyboard.down('KeyD');
  await expect(coach).toContainText('Nice!');
  await page.keyboard.up('KeyD');
  await expect(coach).toContainText('jump');

  await finish(page, [5, 1]);
  await expect(coach).toHaveCount(0);
  expect(await app(page, (a) => a.settings.firstMatchDone)).toBe(true);
  await expect(page.locator('.card-preview img')).toHaveAttribute('src', /^data:image\/jpeg/);

  await captureOpen(page);
  await page.getByRole('button', { name: 'Challenge on LINE' }).click();
  const opened: string[] = await page.evaluate(() => (window as any).__opened);
  expect(opened).toHaveLength(1);
  const text = decodeURIComponent(opened[0].replace('https://line.me/R/share?text=', ''));
  expect(text).toContain('crushed');
  expect(text).toMatch(/\?vs=[a-z]+&as=goldie&scene=beach&score=5-1&lv=beginner&to=5/);

  // 第二次按「開始」就是一般比賽，沒有提示
  await page.getByRole('button', { name: 'Title', exact: true }).click();
  await waitScreen(page, 'modes');
  await page.keyboard.press('Escape');
  await waitScreen(page, 'title');
  await page.getByRole('button', { name: '▶ Start' }).click();
  expect(await app(page, (a) => a.difficulty)).not.toBe('beginner');
  await expect(coach).toHaveCount(0);
  await ctx.close();
});

test('challenge link: opens the same matchup and compares the score', async ({ browser }) => {
  const ctx = await newPlayer(browser);
  const page = await ctx.newPage();
  await page.goto('/?vs=meimei&as=shishi&scene=lake&score=7-3&lv=easy&to=7');
  await waitScreen(page, 'dare');
  // 處理完就從網址拿掉，重新整理不會再進一次
  expect(new URL(page.url()).search).toBe('');
  await expect(page.locator('#overlay')).toContainText('7:3');
  await page.getByRole('button', { name: '▶ Accept challenge' }).click();
  expect(await app(page, (a) => [a.mode, a.chars, a.scene, a.difficulty, a.cfg.targetScore])).toEqual(
    ['cpu', ['shishi', 'meimei'], 'lake', 'easy', 7],
  );

  await finish(page, [7, 2]);
  await expect(page.locator('.dare-line')).toContainText("beat your friend's 7:3");
  // 再來一局仍是同一組挑戰
  await page.getByRole('button', { name: 'Rematch' }).click();
  expect(await app(page, (a) => [a.chars, a.scene, a.cfg.targetScore, a.dare?.score])).toEqual([['shishi', 'meimei'], 'lake', 7, [7, 3]]);
  await finish(page, [5, 7]);
  await expect(page.locator('.dare-line')).toContainText('not better');
  await ctx.close();
});

test('challenge link: a broken link falls back to the title with a notice', async ({ browser }) => {
  const ctx = await newPlayer(browser);
  const page = await ctx.newPage();
  await page.goto('/?vs=nobody&as=shishi&scene=lake&score=7-3&lv=easy&to=7');
  await waitScreen(page, 'title');
  await expect(page.locator('#toast')).toContainText("can't be used");
  await ctx.close();
});
