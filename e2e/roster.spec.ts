import { expect, test, type Page } from '@playwright/test';
import { app, newPlayer, waitScreen } from './helpers';

/** 直接把比分改成打完，叫出結算畫面 */
async function finish(page: Page, score: [number, number], rallies: string[] = []) {
  await page.evaluate(({ s, r }) => {
    const a = (window as any).app;
    a.running = false;
    a.state.score = s;
    if (r.length) a.rallies = r;
    a.showResult(s[0] > s[1] ? 0 : 1);
  }, { s: score, r: rallies });
  await waitScreen(page, 'result');
}

async function modes(page: Page) {
  await page.goto('/');
  await waitScreen(page, 'title');
  await page.getByRole('button', { name: 'More modes', exact: true }).click();
  await waitScreen(page, 'modes');
}

test('character select: 4x4 habitat grid, keyboard wraps rows, hidden leopard is locked', async ({ browser }) => {
  const ctx = await newPlayer(browser, {}, { lastChar: 'shishi', difficulty: 'easy' });
  const page = await ctx.newPage();
  await modes(page);
  await page.getByRole('button', { name: 'vs CPU', exact: true }).click();
  await waitScreen(page, 'charSelect');

  // 4 排 × 4 隻，一排一種棲地
  await expect(page.locator('.char-grid .grid-row')).toHaveCount(4);
  await expect(page.locator('.row-label')).toHaveText(['Forest', 'Night & rare', 'Sky', 'Waterside']);
  await expect(page.locator('.cell')).toHaveCount(16);
  await expect(page.locator('.cell.p1')).toHaveAttribute('data-id', 'shishi');
  await expect(page.locator('.char-info .species').first()).toHaveText('Leopard cat');

  // ↓ 換排（同一欄）、↑ 從最上面回到最下面、→ 走到邊緣換排
  await page.keyboard.press('KeyS');
  await expect(page.locator('.cell.p1')).toHaveAttribute('data-id', 'jiajia');
  await page.keyboard.press('KeyW');
  await page.keyboard.press('KeyW');
  await expect(page.locator('.cell.p1')).toHaveAttribute('data-id', 'wawa');
  await page.keyboard.press('KeyD');
  await page.keyboard.press('KeyD');
  await page.keyboard.press('KeyD');
  await expect(page.locator('.cell.p1')).toHaveAttribute('data-id', 'yueyue');

  // 雲豹還沒解鎖：剪影、不能選
  await page.locator('.cell[data-id="baobao"]').click();
  await expect(page.locator('.cell[data-id="baobao"]')).toHaveClass(/locked/);
  await page.getByRole('button', { name: '▶ Start' }).click();
  await waitScreen(page, 'charSelect');
  expect(await app(page, (a) => a.mode)).toBe('demo');

  // 選甲甲（點兩下＝確定）開打，難度用選角畫面下方的設定
  await page.locator('.cell[data-id="jiajia"]').click();
  await page.locator('.cell[data-id="jiajia"]').click();
  await expect.poll(() => app(page, (a) => a.mode)).toBe('cpu');
  expect(await app(page, (a) => [a.chars[0], a.difficulty, a.settings.lastChar])).toEqual(['jiajia', 'easy', 'jiajia']);
  await ctx.close();
});

test('new player: key hints before the first matches, Space and J also hit', async ({ browser }) => {
  const ctx = await newPlayer(browser, {}, { matchesPlayed: 0 });
  const page = await ctx.newPage();
  await page.goto('/');
  await waitScreen(page, 'title');
  // 標題畫面載入後就能用鍵盤：Enter 按下「開始」
  await page.keyboard.press('Enter');
  await expect.poll(() => app(page, (a) => a.mode)).toBe('cpu');
  await expect(page.locator('.controls-card')).toBeVisible();
  expect(await app(page, (a) => a.paused)).toBe(true);
  await expect(page.locator('.controls-card')).toBeHidden({ timeout: 5000 });
  expect(await app(page, (a) => a.paused)).toBe(false);

  for (const key of ['Space', 'KeyJ']) {
    await page.keyboard.down(key);
    expect(await app(page, (a) => a.humanInput() & 16)).toBe(16);
    await page.keyboard.up(key);
  }
  // P 暫停（空白鍵不再是暫停）
  await page.keyboard.press('KeyP');
  await waitScreen(page, 'pause');
  await ctx.close();
});

test('field guide: conservation data and fun facts from TaiCOL', async ({ browser }) => {
  const ctx = await newPlayer(browser);
  const page = await ctx.newPage();
  await modes(page);
  await page.getByRole('button', { name: '📖 Field guide' }).click();
  await waitScreen(page, 'dex');
  await page.locator('.cell').filter({ hasText: 'Black-faced spoonbill' }).click();
  const card = page.locator('.dex-card');
  await expect(card).toContainText('Platalea minor');
  await expect(card).toContainText('Class I');
  await expect(card).toContainText('TaiCOL');
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await ctx.close();
});

test('daily challenge: same matchup for everyone, emoji result, streak', async ({ browser }) => {
  const ctx = await newPlayer(browser);
  const page = await ctx.newPage();
  await modes(page);
  await page.getByRole('button', { name: /Daily challenge #\d+/ }).click();
  await waitScreen(page, 'daily');
  const d = await app(page, (a) => a.todayDaily());
  await page.getByRole('button', { name: '▶ Start' }).click();
  expect(await app(page, (a) => [a.chars, a.scene, a.cfg.targetScore])).toEqual([[d.me, d.opp], d.scene, 5]);
  await finish(page, [5, 2], ['w', 'l', 'w', 'w', 'l', 'w', 'w']);
  await expect(page.locator('.emoji-line')).toContainText(`#${d.no} 🟩🟥🟩🟩🟥🟩🟩 5:2`);
  await expect(page.locator('.progress-lines')).toContainText('Daily streak: 1 days');
  expect(await app(page, (a) => a.progress.daily.streak)).toBe(1);
  await ctx.close();
});

test('round-island tour: win a stop to get a stamp, finishing unlocks the clouded leopard', async ({ browser }) => {
  const ctx = await newPlayer(browser, {}, { lastChar: 'shishi' });
  const page = await ctx.newPage();
  await modes(page);
  await page.getByRole('button', { name: /Round-island tour/ }).click();
  await waitScreen(page, 'tour');
  await page.getByRole('button', { name: /Go to/ }).click();
  expect(await app(page, (a) => [a.scene, a.chars[1], a.difficulty])).toEqual(['taipei', 'hoho', 'beginner']);
  await finish(page, [5, 3]);
  await expect(page.locator('.progress-lines')).toContainText('Stamped!');
  expect(await app(page, (a) => a.progress.tour.stamps)).toEqual(['taipei']);

  // 最後一站：集滿 12 個章 → 解鎖臺灣雲豹，跳出圖鑑卡片
  await page.evaluate(() => {
    const a = (window as any).app;
    a.progress.tour.stamps = ['taipei', 'songshan', 'ntu', 'zoo', 'expo', 'yangming', 'tamsui', 'wuling', 'comet', 'lake', 'beach'];
    a.startTourStation(11, false);
  });
  expect(await app(page, (a) => a.scene)).toBe('kinmen');
  await finish(page, [5, 4]);
  await expect(page.locator('.dex-card')).toContainText('Formosan clouded leopard');
  expect(await app(page, (a) => a.isUnlocked('baobao'))).toBe(true);
  await ctx.close();
});
