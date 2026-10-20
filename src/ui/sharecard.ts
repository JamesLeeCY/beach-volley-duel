// 賽後分享卡片：1200×630（社群預覽的標準比例），背景是這場的場景，
// 中間放兩位角色、比分、結果與場景名稱；可以直接分享（手機）或下載圖片（電腦）。
import { sceneImage } from '../render/thumbs';
import type { SceneId } from '../render/scenery';

export interface ShareInfo {
  title: string;
  result: string;
  score: [number, number];
  players: { name: string; portrait: string | null; color: string }[];
  sceneId: SceneId;
  sceneName: string;
  url: string;
  /** 宣傳海報（連結預覽圖）：中間顯示標語而不是比分 */
  tagline?: [string, string];
}

const W = 1200;
const H = 630;
const FONT = '"Arial Rounded MT Bold", "Nunito", "Segoe UI", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';

function loadImg(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** 粗體字＋深色描邊 */
function outlined(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, fill: string) {
  g.font = `900 ${size}px ${FONT}`;
  g.lineJoin = 'round';
  g.lineWidth = Math.max(4, size / 7);
  g.strokeStyle = 'rgba(20,30,60,0.9)';
  g.strokeText(text, x, y);
  g.fillStyle = fill;
  g.fillText(text, x, y);
}

export async function renderShareCard(info: ShareInfo): Promise<HTMLCanvasElement> {
  const bg = await sceneImage(info.sceneId, W, H, 0.55);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.drawImage(bg, 0, 0);
  // 中央半透明面板
  g.fillStyle = 'rgba(12,28,52,0.62)';
  roundRect(g, 120, 90, W - 240, H - 180, 36);
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = 'rgba(246,221,155,0.9)';
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  outlined(g, info.title, W / 2, 150, 44, '#ffc531');
  // 兩位角色
  const portraits = await Promise.all(info.players.map((p) => (p.portrait ? loadImg(p.portrait) : Promise.resolve(null))));
  info.players.forEach((p, i) => {
    const cx = i === 0 ? 330 : W - 330;
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.beginPath();
    g.arc(cx, 300, 110, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = p.color;
    g.stroke();
    const img = portraits[i];
    if (img) {
      g.save();
      if (i === 1) {
        g.translate(cx * 2, 0);
        g.scale(-1, 1);
      }
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, cx - 100, 200, 200, 200);
      g.restore();
    }
    outlined(g, p.name, cx, 440, 36, '#ffffff');
  });
  if (info.tagline) {
    outlined(g, 'VS', W / 2, 290, 88, '#ffffff');
    outlined(g, info.tagline[0], W / 2, 380, 30, '#ffe27a');
    outlined(g, info.tagline[1], W / 2, 422, 24, '#ffffff');
  } else {
    // 比分
    outlined(g, `${info.score[0]} : ${info.score[1]}`, W / 2, 300, 96, '#ffffff');
    outlined(g, info.result, W / 2, 395, 38, '#ffe27a');
  }
  g.font = `700 24px ${FONT}`;
  g.fillStyle = 'rgba(255,255,255,0.85)';
  const date = new Date().toLocaleDateString();
  g.fillText(info.tagline ? info.sceneName : `${info.sceneName} · ${date}`, W / 2, 495);
  g.font = `700 20px ${FONT}`;
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.fillText(info.url.replace(/^https?:\/\//, ''), W / 2, H - 60);
  return c;
}

/** 手機用系統分享（可以傳圖片的話附上圖片），否則下載 PNG */
export async function shareCard(info: ShareInfo): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const canvas = await renderShareCard(info);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) return 'cancelled';
  const file = new File([blob], 'taiwan-gold-volley.png', { type: 'image/png' });
  const text = `${info.players[0].name} ${info.score[0]} : ${info.score[1]} ${info.players[1].name}｜${info.result}`;
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: info.title, text, url: info.url });
      return 'shared';
    } catch {
      return 'cancelled';
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'taiwan-gold-volley.png';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return 'downloaded';
}
