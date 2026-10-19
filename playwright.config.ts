import { defineConfig, devices } from '@playwright/test';

// E2E：Vite 開發伺服器 + 本機 PeerJS 信令伺服器（不依賴公用伺服器，可離線執行）
export default defineConfig({
  testDir: 'e2e',
  timeout: 240_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5199/',
    ...devices['Desktop Chrome'],
    launchOptions: {
      // 讓本機 WebRTC 直接用 host candidate 連通（不需要 STUN）
      args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
    },
  },
  webServer: [
    {
      command: 'npx vite --port 5199 --strictPort',
      url: 'http://localhost:5199/',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npx peerjs --port 9123 --path /',
      url: 'http://localhost:9123/',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
