// Canvas 2D 繪圖：邏輯解析度 432×304，等比放大置中；在兩個邏輯幀之間內插位置。
import * as C from '../engine/constants';
import { Phase, PState, type GameEvent, type GameState, type PlayerState } from '../engine/types';
import { Scenery, type SceneId } from './scenery';
import { animOf, type AnimName, type CharacterPack } from '../characters/registry';

const FP = C.FP;
const W = C.FIELD_W;
const H = C.FIELD_H;

export type BallSkin = 'classic' | 'red' | 'blue' | 'ultra';

/** 排球配色：底色、兩種色塊、縫線、外框 */
export const BALL_SKINS: Record<BallSkin, { base: string; a: string; b: string; seam: string; outline: string }> = {
  classic: { base: '#ffffff', a: '#2f7fe0', b: '#ffc531', seam: '#1d3557', outline: '#1d3557' },
  red: { base: '#ffffff', a: '#e53935', b: '#ffffff', seam: '#5c1a1a', outline: '#3a1212' },
  blue: { base: '#ffffff', a: '#2f6fe0', b: '#e53935', seam: '#1a2c5c', outline: '#14204a' },
  ultra: { base: '#ffffff', a: '#2a2a2e', b: '#f6c625', seam: '#111114', outline: '#111114' },
};

/** 畫一顆排球（遊戲中與選單預覽共用） */
export function paintBall(ctx: CanvasRenderingContext2D, x: number, y: number, R: number, angle: number, skin: BallSkin, squash = false) {
  const pal = BALL_SKINS[skin] ?? BALL_SKINS.classic;
  ctx.save();
  ctx.translate(x, y + (squash ? 4 : 0));
  if (squash) ctx.scale(1.2, 0.8);
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fillStyle = pal.base;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.rotate(angle);
  // 排球的三組弧形色塊
  const panel = (rot: number, color: string) => {
    ctx.save();
    ctx.rotate(rot);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, -R * 1.25, R * 1.15, 0.22 * Math.PI, 0.78 * Math.PI);
    ctx.arc(0, -R * 1.85, R * 1.3, 0.72 * Math.PI, 0.28 * Math.PI, true);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };
  panel(0, pal.a);
  panel((Math.PI * 2) / 3, pal.b);
  panel((Math.PI * 4) / 3, pal.a);
  // 縫線
  ctx.strokeStyle = pal.seam;
  ctx.lineWidth = 0.9;
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI * 2) / 3);
    ctx.beginPath();
    ctx.arc(0, -R * 1.25, R * 1.15, 0.2 * Math.PI, 0.8 * Math.PI);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
  // 立體感：左上受光、右下陰影
  const shade = ctx.createRadialGradient(-R * 0.4, -R * 0.45, R * 0.1, 0, 0, R * 1.05);
  shade.addColorStop(0, 'rgba(255,255,255,0.55)');
  shade.addColorStop(0.35, 'rgba(255,255,255,0)');
  shade.addColorStop(0.8, 'rgba(20,30,60,0.08)');
  shade.addColorStop(1, 'rgba(20,30,60,0.32)');
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = pal.outline;
  ctx.beginPath();
  ctx.arc(0, 0, R - 0.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export interface View {
  /** 鏡像繪圖（線上時自己永遠在左側） */
  mirror: boolean;
  chars: [CharacterPack, CharacterPack];
  /** 2P 套用色調偏移（同角色時） */
  hueShift2: boolean;
  smooth: boolean;
  ball: BallSkin;
  scene: SceneId;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
}


const hueCache = new WeakMap<HTMLImageElement, HTMLCanvasElement>();

function hueShifted(img: HTMLImageElement): HTMLCanvasElement {
  let c = hueCache.get(img);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height);
  const d = data.data;
  // RGB 色相旋轉約 150°（矩陣法）
  const a = (150 * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  const m = [
    0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928,
    0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.14, 0.072 - cos * 0.072 - sin * 0.283,
    0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072,
  ];
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], gg = d[i + 1], b = d[i + 2];
    d[i] = m[0] * r + m[1] * gg + m[2] * b;
    d[i + 1] = m[3] * r + m[4] * gg + m[5] * b;
    d[i + 2] = m[6] * r + m[7] * gg + m[8] * b;
  }
  g.putImageData(data, 0, 0);
  hueCache.set(img, c);
  return c;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  private particles: Particle[] = [];
  private trail: { x: number; y: number }[] = [];
  private ballAngle = 0;
  private lastFrame = -1;
  private scenery = new Scenery();
  /** 每位角色目前的短暫反應動作（事件觸發，純視覺） */
  private react: ({ name: AnimName; start: number; dur: number } | null)[] = [null, null];
  private shake = 0;
  private viewW = W;
  private viewH = H;
  private offX = 0;
  private offY = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
  }

  /**
   * 依容器大小計算放大倍率。
   * fill = false：等比放大置中、可整數倍時優先用整數倍，其餘留黑邊。
   * fill = true（手機）：畫布填滿整個螢幕，場地等比置中，多出的部分延伸畫沙灘與天空。
   */
  resize(availW: number, availH: number, fill = false) {
    const fit = Math.min(availW / W, availH / H);
    const dpr = window.devicePixelRatio || 1;
    let cssW: number;
    let cssH: number;
    if (fill) {
      this.scale = fit;
      cssW = Math.floor(availW);
      cssH = Math.floor(availH);
    } else {
      const int = Math.floor(fit);
      this.scale = int >= 2 && int / fit > 0.85 ? int : fit;
      cssW = Math.floor(W * this.scale);
      cssH = Math.floor(H * this.scale);
    }
    this.viewW = cssW / this.scale;
    this.viewH = cssH / this.scale;
    this.offX = (this.viewW - W) / 2;
    this.offY = (this.viewH - H) / 2;
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
  }

  /** 繪圖出錯後重設畫布狀態（清掉殘留的 save()、合成模式、透明度） */
  recover() {
    const w = this.canvas.width;
    this.canvas.width = w;
  }

  /** 從事件產生特效（只在新幀呼叫一次） */
  spawnEffects(events: GameEvent[], mirror: boolean) {
    const now = performance.now();
    for (const e of events) {
      // 角色的短暫反應動作：接球、得分歡呼、失分嚇一跳
      if (e.type === 'bump' && e.who >= 0) this.react[e.who] = { name: 'bump', start: now, dur: 260 };
      if (e.type === 'score') {
        this.react[e.who] = { name: 'cheer', start: now, dur: 1100 };
        this.react[1 - e.who] = { name: 'oops', start: now, dur: 1100 };
      }
      const x = mirror ? W - e.x : e.x;
      if (e.type === 'ground') {
        this.burst(x, C.GROUND_Y, 14, '#e8c97a', 3.2, -2.5);
        this.shake = 4;
      } else if (e.type === 'spike') {
        this.burst(x, e.y, 10, '#fff6a8', 4, 0);
        this.shake = 3;
      } else if (e.type === 'dive') {
        this.burst(x, C.GROUND_Y, 6, '#e8c97a', 2, -1.5);
      } else if (e.type === 'bump') {
        this.burst(x, e.y, 4, '#ffffff', 2, 0);
      }
    }
  }

  private burst(x: number, y: number, n: number, color: string, speed: number, upBias: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = Math.random() * speed;
      this.particles.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6 + upBias * Math.random(),
        life: 0, max: 18 + Math.random() * 14, color, size: 2 + Math.random() * 2,
      });
    }
  }

  draw(prev: GameState, cur: GameState, alpha: number, view: View, time: number) {
    const ctx = this.ctx;
    this.scenery.setTheme(view.scene);
    const k = this.canvas.width / this.viewW;
    ctx.setTransform(k, 0, 0, k, this.offX * k, this.offY * k);
    ctx.imageSmoothingEnabled = view.smooth;

    const jump = Math.abs(cur.ball.x - prev.ball.x) > 60 * FP || cur.frame !== prev.frame + 1;
    const a = jump ? 1 : alpha;
    const lerp = (p: number, c: number) => (p + (c - p) * a) / FP;
    const mx = (x: number) => (view.mirror ? W - x : x);

    let sx = 0, sy = 0;
    if (this.shake > 0) {
      sx = (Math.random() - 0.5) * this.shake;
      sy = (Math.random() - 0.5) * this.shake;
      this.shake *= 0.85;
      if (this.shake < 0.3) this.shake = 0;
    }
    ctx.save();
    ctx.translate(sx, sy);
    this.drawBackground(time);

    const bx = mx(lerp(prev.ball.x, cur.ball.x));
    const by = lerp(prev.ball.y, cur.ball.y);

    // 影子
    ctx.fillStyle = 'rgba(80,50,20,0.25)';
    for (let i = 0; i < 2; i++) {
      const px = mx(lerp(prev.players[i].x, cur.players[i].x));
      this.ellipse(px, C.GROUND_Y + 2, 22, 5);
    }
    const shadowK = Math.max(0.3, 1 - (C.GROUND_Y - by) / 300);
    this.ellipse(bx, C.GROUND_Y + 2, 16 * shadowK, 4 * shadowK);

    this.drawNet();

    // 角色
    for (let i = 0; i < 2; i++) {
      const p = cur.players[i];
      const x = mx(lerp(prev.players[i].x, p.x));
      const y = lerp(prev.players[i].y, p.y);
      const facing = view.mirror ? -p.facing : p.facing;
      this.drawPlayer(view.chars[i], p, x, y, facing, time, i === 1 && view.hueShift2, i);
    }

    // 球與拖尾
    if (cur.frame !== this.lastFrame) {
      this.lastFrame = cur.frame;
      this.ballAngle += (cur.ball.vx / FP) * 0.05 * (view.mirror ? -1 : 1);
      if (cur.ball.power && cur.phase === Phase.Play) this.trail.push({ x: mx(cur.ball.x / FP), y: cur.ball.y / FP });
      else this.trail.length = 0;
      if (this.trail.length > 6) this.trail.shift();
      for (const pt of this.particles) {
        pt.x += pt.vx;
        pt.y += pt.vy;
        pt.vy += 0.15;
        pt.life++;
      }
      this.particles = this.particles.filter((pt) => pt.life < pt.max);
    }
    this.trail.forEach((tpt, i) => {
      ctx.globalAlpha = ((i + 1) / this.trail.length) * 0.35;
      ctx.fillStyle = '#ff7b3a';
      ctx.beginPath();
      ctx.arc(tpt.x, tpt.y, C.BALL_R * (0.5 + (i / this.trail.length) * 0.5), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    const squash = cur.phase !== Phase.Play && by >= C.GROUND_Y - C.BALL_R - 2;
    this.drawBall(bx, by, squash, view.ball);

    for (const pt of this.particles) {
      ctx.globalAlpha = 1 - pt.life / pt.max;
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;

    this.scenery.drawOverlay(ctx, time, -this.offX, -this.offY, W + this.offX, H + this.offY);

    // 比分
    const s0 = cur.score[view.mirror ? 1 : 0];
    const s1 = cur.score[view.mirror ? 0 : 1];
    this.drawNumber(s0, 22, 12, 'left', view.chars[view.mirror ? 1 : 0].manifest.themeColor);
    this.drawNumber(s1, W - 22, 12, 'right', view.chars[view.mirror ? 0 : 1].manifest.themeColor);
    ctx.restore();
  }

  private ellipse(x: number, y: number, rx: number, ry: number) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawBackground(time: number) {
    const ctx = this.ctx;
    const L = -this.offX;
    const R = W + this.offX;
    const T = -this.offY;
    const B = H + this.offY;
    // 多畫一點邊，畫面震動時不會露出黑邊
    this.scenery.draw(ctx, time, this.canvas.width / this.viewW, L - 6, T - 6, R + 6, B + 6);
    // 場地線
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(0, C.GROUND_Y + 1, W, 2);
    // 場地外（左右延伸區）：稍微壓暗，並在邊界立柱，讓玩家知道球會在這裡反彈
    if (this.offX > 0.5) {
      ctx.fillStyle = 'rgba(10,30,60,0.16)';
      ctx.fillRect(L, T, -L, B - T);
      ctx.fillRect(W, T, R - W, B - T);
      for (const x of [0, W]) {
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(x - 0.5, T, 1, C.GROUND_Y - T);
        ctx.fillStyle = '#6b4b2a';
        ctx.fillRect(x - 2, C.GROUND_Y - 34, 4, 38);
        ctx.fillStyle = '#d33';
        ctx.fillRect(x - 3, C.GROUND_Y - 36, 6, 4);
      }
    }
  }

  private drawNet() {
    const ctx = this.ctx;
    const x = C.NET_X;
    // 網柱
    ctx.fillStyle = '#6b4b2a';
    ctx.fillRect(x - 2, C.NET_TOP_Y, 4, C.GROUND_Y - C.NET_TOP_Y + 4);
    // 網面
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let y = C.NET_TOP_Y + 4; y < C.GROUND_Y - 30; y += 6) ctx.fillRect(x - C.NET_HALF_W, y, C.NET_HALF_W * 2, 1);
    ctx.fillRect(x - C.NET_HALF_W, C.NET_TOP_Y + 2, 1, C.GROUND_Y - 30 - C.NET_TOP_Y);
    ctx.fillRect(x + C.NET_HALF_W - 1, C.NET_TOP_Y + 2, 1, C.GROUND_Y - 30 - C.NET_TOP_Y);
    // 網頂
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, C.NET_TOP_Y, C.NET_HALF_W + 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#d33';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private animFor(p: PlayerState): { name: AnimName; frame: number | null } {
    switch (p.state) {
      case PState.Jump: {
        const v = p.vy / FP;
        return { name: 'jump', frame: v < -10 ? 1 : v < -3 ? 2 : v < 4 ? 3 : 4 };
      }
      case PState.Spike:
        return { name: 'spike', frame: Math.min(4, C.SPIKE_FRAMES - p.timer) };
      case PState.Dive:
        return { name: 'dive', frame: p.vy < 0 ? 0 : 1 };
      case PState.Lying:
        return { name: 'dive', frame: 2 };
      case PState.Win:
        return { name: 'win', frame: null };
      case PState.Lose:
        return { name: 'lose', frame: null };
      default:
        return { name: p.vx !== 0 ? 'run' : 'idle', frame: null };
    }
  }

  private drawPlayer(pack: CharacterPack, p: PlayerState, x: number, y: number, facing: number, time: number, hue: boolean, who: number) {
    const ctx = this.ctx;
    let { name, frame } = this.animFor(p);
    // 反應動作只在一般站立／跳躍時顯示，且角色包要有這個動畫（匯入的角色包可能沒有）
    const r = this.react[who];
    if (r) {
      const t = performance.now() - r.start;
      const anims = pack.manifest.animations as Record<string, { frames: number } | undefined>;
      if (t > r.dur) this.react[who] = null;
      else if ((p.state === PState.Normal || p.state === PState.Jump) && anims[r.name]) {
        name = r.name;
        frame = Math.min(anims[r.name]!.frames - 1, Math.floor((t / r.dur) * anims[r.name]!.frames));
        // 歡呼、嚇一跳的動畫循環播放
        if (r.name !== 'bump') frame = null;
      }
    }
    const anim = animOf(pack, name);
    const [fw, fh] = pack.manifest.frameSize;
    const idx = frame !== null ? Math.min(frame, anim.frames - 1) : Math.floor((time / 1000) * anim.fps) % anim.frames;
    if (!pack.sprite) {
      ctx.fillStyle = pack.manifest.themeColor;
      this.ellipse(x, y + 4, 26, 26);
      ctx.fillStyle = '#222';
      this.ellipse(x + facing * 10, y - 4, 3, 4);
      return;
    }
    const img: CanvasImageSource = hue ? hueShifted(pack.sprite) : pack.sprite;
    ctx.save();
    ctx.translate(Math.round(x * 4) / 4, Math.round(y * 4) / 4);
    if (facing < 0) ctx.scale(-1, 1);
    ctx.drawImage(img, idx * fw, anim.row * fh, fw, fh, -32, -32, 64, 64);
    ctx.restore();
  }

  private drawBall(x: number, y: number, squash: boolean, skin: BallSkin) {
    paintBall(this.ctx, x, y, C.BALL_R, this.ballAngle, skin, squash);
  }

  /** 比分：圓潤的粗體數字＋深色描邊＋角色主題色漸層，搭配手繪畫風 */
  private drawNumber(n: number, x: number, y: number, align: 'left' | 'right', color: string) {
    const ctx = this.ctx;
    const text = String(n);
    ctx.save();
    ctx.font = '900 32px "Arial Rounded MT Bold", "Nunito", "Varela Round", "Segoe UI", "Noto Sans TC", system-ui, sans-serif';
    ctx.textAlign = align;
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    // 柔和陰影＋深色外框
    ctx.shadowColor = 'rgba(10,20,40,0.35)';
    ctx.shadowOffsetY = 2;
    ctx.shadowBlur = 3;
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(29,53,87,0.9)';
    ctx.strokeText(text, x, y);
    ctx.shadowColor = 'transparent';
    // 上亮下深的主題色
    const grad = ctx.createLinearGradient(0, y, 0, y + 30);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.18, color);
    grad.addColorStop(1, color);
    ctx.fillStyle = grad;
    ctx.fillText(text, x, y);
    // 高光
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeText(text, x, y - 0.5);
    ctx.restore();
  }

}
