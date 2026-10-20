// 產生連結預覽圖 public/og.jpg（1200×630）：用遊戲本身的分享卡片畫法畫一張宣傳海報。
// 執行：npm run gen:og（需要先 npx playwright install chromium）
import { writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const server = await createServer({ server: { port: 5198, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:5198/');
  await page.waitForFunction(() => window.app?.screenName === 'title');
  const dataUrl = await page.evaluate(async () => {
    const m = await import('/src/ui/sharecard.ts');
    const c = await m.renderShareCard({
      title: '沙灘排球對決 Beach Volley Duel',
      result: '',
      score: [0, 0],
      players: [
        { name: '金金', portrait: './characters/goldie/portrait.png', color: '#E2A93B' },
        { name: '橘子', portrait: './characters/kiki/portrait.png', color: '#F08A3C' },
      ],
      sceneId: 'beach',
      sceneName: '電腦對戰・同機雙人・線上對戰・10 個台灣場景',
      url: 'https://jamesleecy.github.io/beach-volley-duel/',
      tagline: ['2D 排球對戰網頁遊戲', '免安裝，手機、電腦都能玩'],
    });
    return c.toDataURL('image/jpeg', 0.88);
  });
  writeFileSync('public/og.jpg', Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('public/og.jpg written');
} finally {
  await browser.close();
  await server.close();
}
