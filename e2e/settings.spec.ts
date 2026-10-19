import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { newPlayer, waitScreen } from './helpers';

async function openSettings(page: Page) {
  await page.goto('/');
  await waitScreen(page, 'title');
  await page.locator('#overlay .screen').click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await waitScreen(page, 'settings');
}

test('key rebinding: capture a new key, persist it, use it in game', async ({ browser }) => {
  const ctx = await newPlayer(browser);
  const page = await ctx.newPage();
  await openSettings(page);

  const hit1 = page.locator('[data-bind="0-hit"]');
  await expect(hit1).toHaveText('Hit T');
  await hit1.click();
  await expect(hit1).toHaveText('Hit …');
  await expect(page.getByText('Press a new key')).toBeVisible();
  await page.keyboard.press('Space'); // 保留鍵：忽略，繼續等待
  await expect(hit1).toHaveText('Hit …');
  await page.keyboard.press('KeyX');
  await expect(hit1).toHaveText('Hit X');

  // 把 2P 的「左」綁到 1P 已在用的 A：1P 的左因此解除
  await page.locator('[data-bind="1-left"]').click();
  await page.keyboard.press('KeyA');
  await expect(page.locator('[data-bind="1-left"]')).toHaveText('Left A');
  await expect(page.locator('[data-bind="0-left"]')).toHaveText('Left —');

  // Esc 取消
  await page.locator('[data-bind="0-up"]').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-bind="0-up"]')).toHaveText('Jump W');
  await waitScreen(page, 'settings');

  // 重新整理後仍保留
  await openSettings(page);
  await expect(page.locator('[data-bind="0-hit"]')).toHaveText('Hit X');
  await expect(page.locator('[data-bind="1-left"]')).toHaveText('Left A');

  // 新鍵位實際作用於遊戲輸入
  await page.keyboard.down('KeyX');
  expect(await page.evaluate(async () => {
    const { KEYMAP_1P } = await import('/src/input/keyboard.ts' as string);
    return (window as any).app.keyboard.read(KEYMAP_1P);
  })).toBe(16);
  await page.keyboard.up('KeyX');

  // 恢復預設
  await page.getByRole('button', { name: 'Reset keys' }).click();
  await expect(page.locator('[data-bind="0-hit"]')).toHaveText('Hit T');
  await expect(page.locator('[data-bind="1-left"]')).toHaveText('Left ←');
  await ctx.close();
});

function packZip(id: string, name: string) {
  const dir = 'public/characters/momo/';
  const manifest = { ...JSON.parse(readFileSync(dir + 'manifest.json', 'utf8')), id, name: { en: name, 'zh-TW': name } };
  return zipSync({
    [`${id}/manifest.json`]: strToU8(JSON.stringify(manifest)),
    [`${id}/sprite.png`]: readFileSync(dir + 'sprite.png'),
    [`${id}/portrait.png`]: readFileSync(dir + 'portrait.png'),
  });
}

async function dropFile(page: Page, bytes: Uint8Array, filename: string) {
  await page.evaluate(({ data, filename }) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(data)], filename, { type: 'application/zip' }));
    const zone = document.querySelector('#pack-drop')!;
    zone.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, { data: [...bytes], filename });
}

test('character pack: drag in a .zip, stored in IndexedDB, local only', async ({ browser }) => {
  const ctx = await newPlayer(browser);
  const page = await ctx.newPage();
  await openSettings(page);
  await expect(page.getByText('No imported characters')).toBeVisible();

  // 壞掉的檔案顯示錯誤
  await dropFile(page, new Uint8Array([1, 2, 3]), 'broken.zip');
  await expect(page.locator('#pack-status')).toHaveText('Import failed: not a zip file');
  // 不能覆蓋內建角色
  await dropFile(page, packZip('momo', 'Fake'), 'momo.zip');
  await expect(page.locator('#pack-status')).toContainText('built-in');

  await dropFile(page, packZip('e2e-zed', 'Zed'), 'zed.zip');
  await expect(page.locator('#toast')).toContainText('Imported Zed');
  await expect(page.locator('.pack-row label')).toHaveText(['Zed']);

  // 重新整理：從 IndexedDB 載回，可在選角畫面選到
  await page.reload();
  await waitScreen(page, 'title');
  const chars = await page.evaluate(async () => {
    const r = await import('/src/characters/registry.ts' as string);
    return r.allCharacters().map((c: { id: string; local?: boolean; sprite: unknown }) => ({ id: c.id, local: !!c.local, sprite: !!c.sprite }));
  });
  expect(chars).toContainEqual({ id: 'e2e-zed', local: true, sprite: true });
  await page.locator('#overlay .screen').click();
  await page.getByRole('button', { name: 'Practice', exact: true }).click();
  const name = page.locator('.char-panel .name').first();
  for (let i = 0; i < chars.length && (await name.textContent()) !== 'Zed'; i++) {
    await page.locator('.char-panel').first().getByRole('button', { name: '▶' }).click();
  }
  await expect(name).toHaveText('Zed');

  // 另一個瀏覽器環境看不到
  const other = await newPlayer(browser);
  const otherPage = await other.newPage();
  await openSettings(otherPage);
  await expect(otherPage.getByText('No imported characters')).toBeVisible();
  await other.close();

  // 刪除
  await openSettings(page);
  await page.locator('.pack-row').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('No imported characters')).toBeVisible();
  await page.reload();
  await openSettings(page);
  await expect(page.getByText('No imported characters')).toBeVisible();
  await ctx.close();
});
