import { expect, test, type Page } from '@playwright/test';
import { app, newPlayer } from './helpers';

/** 手機橫向、支援觸控的瀏覽器環境，直接開一場練習 */
async function phone(browser: import('@playwright/test').Browser) {
  const ctx = await newPlayer(browser, {}, {}, { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.waitForFunction(() => (window as any).app?.screenName === 'title');
  await app(page, (a) => {
    a.chars = ['goldie', 'kiki'];
    a.startLocalMatch('practice');
  });
  await expect(page.locator('.touch-controls').first()).toHaveClass(/visible/);
  return { ctx, page };
}

function center(page: Page, sel: string) {
  // 頁面上有兩組觸控按鍵（第二組是平板同機雙人的 2P，平常隱藏），取第一組
  return page.locator(sel).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
}

test('touch: a very quick tap on jump is never lost', async ({ browser }) => {
  const { ctx, page } = await phone(browser);
  let ok = 0;
  for (let attempt = 0; attempt < 15 && ok < 5; attempt++) {
    // 等角色落地、且球還在空中（球落地後的慢動作期間遊戲本來就不接受輸入）
    await page.waitForFunction(() => {
      const s = (window as any).app.state;
      return s.players[0].state === 0 && s.phase === 0 && s.ball.y < 15000;
    });
    const j = await center(page, '.touch-jump');
    // 偏離按鈕中心一點點，模擬沒有按得很準
    await page.touchscreen.tap(j.x + 18, j.y - 12);
    const jumped = await page
      .waitForFunction(() => (window as any).app.state.players[0].state === 1, null, { timeout: 1500 })
      .then(() => true, () => false);
    if (jumped) {
      ok++;
    } else {
      // 只有在點擊後球剛好落地（進入慢動作）時才允許沒跳起來
      expect(await app(page, (a) => a.state.phase)).not.toBe(0);
    }
  }
  expect(ok).toBe(5);
  await ctx.close();
});

test('touch: holding the stick and tapping anywhere on the right half dives', async ({ browser }) => {
  const { ctx, page } = await phone(browser);
  await page.waitForFunction(() => (window as any).app.state.players[0].state === 0);
  // 左半邊按住搖桿往右推（合成的 pointer 事件）
  await page.evaluate(() => {
    const zone = document.querySelector('.touch-zone')!;
    const fire = (type: string, x: number) =>
      zone.dispatchEvent(new PointerEvent(type, { pointerType: 'touch', pointerId: 41, clientX: x, clientY: 300, bubbles: true }));
    fire('pointerdown', 150);
    fire('pointermove', 210);
  });
  // 右半邊離按鈕很遠的地方快速點一下＝擊球；地上按擊球＋方向＝魚躍
  await page.touchscreen.tap(560, 140);
  await page.waitForFunction(() => [3, 4].includes((window as any).app.state.players[0].state), null, { timeout: 1500 });
  await ctx.close();
});
