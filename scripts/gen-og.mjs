// 產生連結預覽圖 public/og.jpg（1200×630）：用遊戲本身的分享卡片畫法畫一張宣傳海報。
// 執行：npm run gen:og（需要先 npx playwright install chromium）
import { writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const server = await createServer({ server: { port: Number(process.env.OG_PORT) || 5198, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`http://localhost:${server.config.server.port}/`);
  await page.waitForFunction(() => window.app?.screenName === 'title');
  const dataUrl = await page.evaluate(async () => {
    const m = await import('/src/ui/sharecard.ts');
    const c = await m.renderShareCard({
      title: '台灣金排球 Taiwan Gold Volley',
      result: '',
      score: [0, 0],
      players: [
        { name: '石石', portrait: './characters/shishi/portrait.png', color: '#C8A878' },
        { name: '月月', portrait: './characters/yueyue/portrait.png', color: '#C8A07A' },
      ],
      sceneId: 'beach',
      sceneName: '16 種臺灣動物・12 個臺灣場景・每日挑戰・環島巡迴賽',
      url: 'https://jamesleecy.github.io/beach-volley-duel/',
      tagline: ['臺灣動物排球對戰', '免安裝，手機、電腦都能玩'],
    });
    return c.toDataURL('image/jpeg', 0.88);
  });
  writeFileSync('public/og.jpg', Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('public/og.jpg written');
} finally {
  await browser.close();
  await server.close();
}
