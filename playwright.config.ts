import { defineConfig, devices } from '@playwright/test';

// E2E：Vite 開發伺服器 + 本機 PeerJS 信令伺服器（不依賴公用伺服器，可離線執行）
// Windows 會隨機保留一段連接埠（Hyper-V），被佔到時可用 E2E_PORT 換一個
const PORT = Number(process.env.E2E_PORT) || 5199;

export default defineConfig({
  testDir: 'e2e',
  timeout: 240_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/`,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // 讓本機 WebRTC 直接用 host candidate 連通（不需要 STUN）
          args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
        },
      },
    },
    {
      // Safari／iPhone 的核心：引擎決定性、觸控、設定（線上對戰的 WebRTC 只在 Chromium 跑）
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testMatch: ['determinism.spec.ts', 'touch.spec.ts', 'settings.spec.ts', 'share.spec.ts'],
    },
  ],
  webServer: [
    {
      command: `npx vite --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}/`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npx peerjs --port 9123 --path /',
      url: 'http://localhost:9123/',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
