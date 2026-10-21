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
  /** 戰績標題（例如「我用石虎 7:3 打爆台灣黑熊 🏐」），取代 result */
  headline?: string;
  /** 卡片下方的行動按鈕文字（例如「挑戰我」），與網址一起畫成一顆按鈕 */
  cta?: string;
  /** 分享時附的文字（預設由角色名稱與比分組成） */
  text?: string;
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
  // 戰績卡（有標題）：角色與比分往上移，標題放在角色下方，可以用滿整個寬度
  const hl = !!info.headline && !info.tagline;
  const cy = hl ? 270 : 300;
  const r = hl ? 96 : 110;
  // 兩位角色
  const portraits = await Promise.all(info.players.map((p) => (p.portrait ? loadImg(p.portrait) : Promise.resolve(null))));
  info.players.forEach((p, i) => {
    const cx = i === 0 ? 330 : W - 330;
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
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
      g.drawImage(img, cx - (r - 10), cy - (r - 10), (r - 10) * 2, (r - 10) * 2);
      g.restore();
    }
    outlined(g, p.name, cx, cy + r + 30, hl ? 30 : 36, '#ffffff');
  });
  if (info.tagline) {
    outlined(g, 'VS', W / 2, 290, 88, '#ffffff');
    outlined(g, info.tagline[0], W / 2, 380, 30, '#ffe27a');
    outlined(g, info.tagline[1], W / 2, 422, 24, '#ffffff');
  } else {
    // 比分
    outlined(g, `${info.score[0]} : ${info.score[1]}`, W / 2, cy, 96, '#ffffff');
    const line = info.headline ?? info.result;
    // 長標題（英文、長角色名）縮小字級，不超出面板
    let size = hl ? 42 : 38;
    const maxW = W - 300;
    g.font = `900 ${size}px ${FONT}`;
    while (size > 20 && g.measureText(line).width > maxW) g.font = `900 ${--size}px ${FONT}`;
    outlined(g, line, W / 2, hl ? 440 : 395, size, '#ffe27a');
  }
  g.font = `700 ${hl ? 22 : 24}px ${FONT}`;
  g.fillStyle = 'rgba(255,255,255,0.85)';
  const date = new Date().toLocaleDateString();
  g.fillText(info.tagline ? info.sceneName : `${info.sceneName} · ${date}`, W / 2, hl ? 492 : 495);
  const site = info.url.replace(/^https?:\/\//, '').replace(/\?.*$/, '');
  if (info.cta) {
    // 「挑戰我 ▶」按鈕：跨在面板下緣，讓看到圖的人知道可以點連結來打同一場
    const label = `${info.cta}  ▶`;
    g.font = `900 30px ${FONT}`;
    const bw = g.measureText(label).width + 64;
    const by = 516;
    g.fillStyle = '#ffc531';
    roundRect(g, (W - bw) / 2, by, bw, 56, 28);
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(20,30,60,0.9)';
    g.stroke();
    g.fillStyle = '#1d3557';
    g.fillText(label, W / 2, by + 29);
  }
  g.font = `700 20px ${FONT}`;
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.fillText(site, W / 2, info.cta ? H - 24 : H - 34);
  return c;
}

export function cardBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((r) => canvas.toBlob(r, 'image/png'));
}

/** 手機用系統分享（可以傳圖片的話附上圖片），否則下載 PNG */
export async function shareCard(info: ShareInfo, canvas?: HTMLCanvasElement): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const blob = await cardBlob(canvas ?? (await renderShareCard(info)));
  if (!blob) return 'cancelled';
  const file = new File([blob], 'taiwan-gold-volley.png', { type: 'image/png' });
  const text = info.text ?? `${info.players[0].name} ${info.score[0]} : ${info.score[1]} ${info.players[1].name}｜${info.result}`;
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      // 自訂文字裡已經有連結時不再另外附網址，避免訊息裡出現兩次
      await nav.share({ files: [file], title: info.title, text, ...(info.text ? {} : { url: info.url }) });
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
