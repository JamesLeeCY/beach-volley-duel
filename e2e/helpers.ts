import type { Browser, BrowserContext, BrowserContextOptions, Page } from '@playwright/test';

export const PEER = { host: 'localhost', port: 9123, path: '/', secure: false, config: { iceServers: [] } };

export interface NetSim {
  delayMs?: number;
  jitterMs?: number;
  loss?: number;
}

/** 以固定設定（英文、5 分、快速、靜音）開一個新的瀏覽器環境 */
export async function newPlayer(
  browser: Browser, net: NetSim = {}, settings: Record<string, unknown> = {}, options: BrowserContextOptions = {},
): Promise<BrowserContext> {
  const ctx = await browser.newContext(options);
  await ctx.addInitScript(
    ({ net, settings }) => {
      if (!sessionStorage.getItem('e2e-init')) {
        sessionStorage.setItem('e2e-init', '1');
        localStorage.setItem('bvd.settings.v1', JSON.stringify(settings));
      }
      (window as unknown as { __BVD_NET__: unknown }).__BVD_NET__ = net;
    },
    {
      net: { peer: PEER, ...net },
      settings: { lang: 'en', targetScore: 5, speed: 'fast', bgm: false, sfx: 'off', ...settings },
    },
  );
  return ctx;
}

/** 讀取開發模式下掛在 window.app 的遊戲狀態 */
export function app<T>(page: Page, fn: (app: any) => T): Promise<T> {
  return page.evaluate(`(${fn.toString()})(window.app)`) as Promise<T>;
}

export async function waitScreen(page: Page, name: string, timeout = 30_000) {
  await page.waitForFunction((n) => (window as unknown as { app?: { screenName: string } }).app?.screenName === n, name, { timeout });
}
