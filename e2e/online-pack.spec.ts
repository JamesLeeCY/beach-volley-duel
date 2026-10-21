import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { app, newPlayer, waitScreen } from './helpers';

function packZip(id: string, name: string) {
  const dir = 'public/characters/glidey/';
  const manifest = { ...JSON.parse(readFileSync(dir + 'manifest.json', 'utf8')), id, name: { en: name, 'zh-TW': name } };
  return zipSync({
    [`${id}/manifest.json`]: strToU8(JSON.stringify(manifest)),
    [`${id}/sprite.png`]: readFileSync(dir + 'sprite.png'),
    [`${id}/portrait.png`]: readFileSync(dir + 'portrait.png'),
  });
}

test('online: opponent sees my imported character (pack sent over the connection)', async ({ browser }) => {
  const hostCtx = await newPlayer(browser);
  const guestCtx = await newPlayer(browser);
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  // 房客先匯入自訂角色（只存在房客的裝置）
  await guest.goto('/');
  await waitScreen(guest, 'title');
  const bytes = [...packZip('zippy', 'Zippy')];
  await guest.evaluate(async (data) => {
    const m = await import('/src/characters/localPacks.ts' as string);
    await m.importPackZip(new Blob([new Uint8Array(data)]));
  }, bytes);

  await host.goto('/');
  await waitScreen(host, 'title');
  await host.getByRole('button', { name: 'More modes', exact: true }).click();
  await host.getByRole('button', { name: 'Online', exact: true }).click();
  await host.getByRole('button', { name: 'Create room', exact: true }).click();
  const codeEl = host.locator('#overlay .code');
  await expect(codeEl).toHaveText(/^[A-Z0-9]{6}$/, { timeout: 20_000 });
  const code = (await codeEl.textContent())!;
  expect(await host.evaluate(async () => (await import('/src/characters/registry.ts' as string)).hasCharacter('zippy'))).toBe(false);

  await guest.goto(`/?room=${code}`);
  await waitScreen(guest, 'onlineChar');
  await waitScreen(host, 'onlineChar');
  // 房客在自己的面板點選匯入的角色
  await guest.locator('.cell[data-id="zippy"]').click();

  // 房主收到角色包後，清單裡會出現 Zippy（並已選取在房客的面板）
  const hasZippy = () => host.evaluate(async () => (await import('/src/characters/registry.ts' as string)).hasCharacter('zippy'));
  await expect.poll(hasZippy, { timeout: 15_000 }).toBe(true);
  await expect(host.locator('.cell[data-id="zippy"]')).toHaveClass(/p2/);

  for (const p of [host, guest]) await p.getByRole('button', { name: 'Ready', exact: true }).click();
  for (const p of [host, guest]) await p.waitForFunction(() => (window as any).app?.onlineStarted === true, null, { timeout: 15_000 });
  expect(await app(host, (a) => a.chars)).toEqual(await app(guest, (a) => a.chars));
  expect(await app(host, (a) => a.chars[1])).toBe('zippy');
  // 房主畫面上真的有 Zippy 的精靈圖
  expect(await host.evaluate(async () => !!(await import('/src/characters/registry.ts' as string)).getCharacter('zippy').sprite)).toBe(true);

  await hostCtx.close();
  await guestCtx.close();
});
