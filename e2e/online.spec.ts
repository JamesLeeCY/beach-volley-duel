import { expect, test, type Page } from '@playwright/test';
import { app, newPlayer, waitScreen, type NetSim } from './helpers';

const KEYS = ['KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyT'];

/** 兩個瀏覽器分別建房、加入，打完 5 分賽，檢查雙方無 desync 且結果一致 */
async function playMatch(browser: import('@playwright/test').Browser, net: NetSim) {
  const hostCtx = await newPlayer(browser, net);
  const guestCtx = await newPlayer(browser, net);
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  const logs: string[] = [];
  for (const [who, p] of [['host', host], ['guest', guest]] as const) {
    p.on('console', (m) => {
      if (m.type() === 'warning' || m.type() === 'error') logs.push(`[${who}] ${m.text()}`);
    });
  }

  await host.goto('/');
  await waitScreen(host, 'title');
  await host.locator('#overlay .screen').click();
  await host.getByRole('button', { name: 'Online', exact: true }).click();
  await host.getByRole('button', { name: 'Create room', exact: true }).click();
  const codeEl = host.locator('#overlay .code');
  await expect(codeEl).toHaveText(/^[A-Z0-9]{6}$/, { timeout: 20_000 });
  const code = (await codeEl.textContent())!;

  await guest.goto(`/?room=${code}`);
  await waitScreen(guest, 'onlineChar');
  await waitScreen(host, 'onlineChar');

  // 房客改選角色再準備，確認角色同步
  await guest.getByRole('button', { name: '▶' }).last().click();
  for (const p of [host, guest]) await p.getByRole('button', { name: 'Ready', exact: true }).click();

  for (const p of [host, guest]) await p.waitForFunction(() => (window as any).app?.onlineStarted === true, null, { timeout: 15_000 });
  expect(await app(host, (a) => a.chars)).toEqual(await app(guest, (a) => a.chars));

  // 兩邊都隨機按鍵，讓預測失準、觸發 rollback
  let done = false;
  const mash = async (p: Page, seed: number) => {
    let r = seed;
    const rand = (n: number) => ((r = (r * 1103515245 + 12345) & 0x7fffffff) % n);
    while (!done) {
      const key = KEYS[rand(KEYS.length)];
      await p.keyboard.down(key);
      await p.waitForTimeout(40 + rand(260));
      await p.keyboard.up(key);
      await p.waitForTimeout(rand(200));
    }
  };
  const mashing = Promise.all([mash(host, 1), mash(guest, 2)]);
  try {
    await Promise.all([waitScreen(host, 'result', 200_000), waitScreen(guest, 'result', 200_000)]);
  } finally {
    done = true;
    await mashing;
  }

  const read = (p: Page) => app(p, (a) => ({
    score: a.state.score as number[],
    winner: a.state.winner as number,
    desyncs: a.online.desyncs as number,
    rollbacks: a.online.session.rollbacks as number,
    confirmed: a.online.session.confirmed.frame as number,
    rtt: a.online.rtt as number,
  }));
  const h = await read(host);
  const g = await read(guest);
  console.log(`net=${JSON.stringify(net)} host=${JSON.stringify(h)} guest=${JSON.stringify(g)}`);

  expect(h.desyncs, logs.join('\n')).toBe(0);
  expect(g.desyncs, logs.join('\n')).toBe(0);
  expect(Math.max(...h.score)).toBe(5);
  expect(h.score).toEqual(g.score);
  expect(h.winner).toBe(g.winner);
  // 同一個已確定幀的 hash 必須相同
  const frame = Math.floor(Math.min(h.confirmed, g.confirmed) / 30) * 30;
  const hashAt = (p: Page) => p.evaluate((f) => (window as any).app.online.session.hashAt(f), frame);
  const [hh, gh] = await Promise.all([hashAt(host), hashAt(guest)]);
  expect(hh).not.toBeNull();
  expect(hh).toBe(gh);
  // 兩邊顯示的結果相反（一贏一輸）
  await expect(host.locator('#overlay h2')).toHaveText(h.winner === 0 ? 'You win!' : 'You lose…');
  await expect(guest.locator('#overlay h2')).toHaveText(h.winner === 1 ? 'You win!' : 'You lose…');

  await hostCtx.close();
  await guestCtx.close();
  return { h, g };
}

test('online: create/join room and finish a 5-point match without desync', async ({ browser }) => {
  await playMatch(browser, {});
});

test('online: 150 ms latency and 5% packet loss', async ({ browser }) => {
  const { h, g } = await playMatch(browser, { delayMs: 150, jitterMs: 20, loss: 0.05 });
  // 確認模擬延遲確實生效（RTT ≈ 2 × 150 ms）
  expect(h.rtt).toBeGreaterThanOrEqual(280);
  expect(g.rtt).toBeGreaterThanOrEqual(280);
  expect(h.rollbacks + g.rollbacks).toBeGreaterThan(0);
});
