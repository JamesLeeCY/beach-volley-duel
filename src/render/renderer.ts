// Canvas 2D 繪圖：邏輯解析度 432×304，等比放大置中；在兩個邏輯幀之間內插位置。
import * as C from '../engine/constants';
import { Phase, PState, type GameEvent, type GameState, type PlayerState } from '../engine/types';
import { animOf, type AnimName, type CharacterPack } from '../characters/registry';

const FP = C.FP;
const W = C.FIELD_W;
const H = C.FIELD_H;

export interface View {
  /** 鏡像繪圖（線上時自己永遠在左側） */
  mirror: boolean;
  chars: [CharacterPack, CharacterPack];
  /** 2P 套用色調偏移（同角色時） */
  hueShift2: boolean;
  smooth: boolean;
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

// 3×5 像素數字
const DIGITS = [
  '111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001',
  '111100111001111', '111100111101111', '111001010010010', '111101111101111', '111101111001111',
];

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
  private clouds = [
    { x: 40, y: 34, w: 60, s: 0.15 },
    { x: 200, y: 60, w: 44, s: 0.1 },
    { x: 330, y: 26, w: 70, s: 0.2 },
    { x: 120, y: 88, w: 36, s: 0.08 },
  ];
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

  /** 從事件產生特效（只在新幀呼叫一次） */
  spawnEffects(events: GameEvent[], mirror: boolean) {
    for (const e of events) {
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
      this.drawPlayer(view.chars[i], p, x, y, facing, time, i === 1 && view.hueShift2);
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
    this.drawBall(bx, by, squash);

    for (const pt of this.particles) {
      ctx.globalAlpha = 1 - pt.life / pt.max;
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;

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
    // 可見範圍（手機填滿螢幕時會超出場地）
    const L = -this.offX - 1;
    const R = W + this.offX + 1;
    const T = -this.offY - 1;
    const B = H + this.offY + 1;
    const sky = ctx.createLinearGradient(0, 0, 0, 150);
    sky.addColorStop(0, '#4aa3f0');
    sky.addColorStop(1, '#bfe6ff');
    ctx.fillStyle = sky;
    ctx.fillRect(L, T, R - L, 152 - T);
    // 太陽
    ctx.fillStyle = 'rgba(255,240,170,0.5)';
    ctx.beginPath();
    ctx.arc(360, 46, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff3b0';
    ctx.beginPath();
    ctx.arc(360, 46, 18, 0, Math.PI * 2);
    ctx.fill();
    // 雲
    ctx.fillStyle = '#ffffff';
    const span = R - L;
    for (const c of this.clouds) {
      const x = L + (((c.x - L + time * c.s * 0.02) % (span + c.w * 2)) + span + c.w * 2) % (span + c.w * 2) - c.w;
      this.ellipse(x, c.y, c.w / 2, c.w / 6);
      this.ellipse(x - c.w / 5, c.y - c.w / 10, c.w / 4, c.w / 6);
      this.ellipse(x + c.w / 6, c.y - c.w / 8, c.w / 5, c.w / 6);
    }
    // 海
    const sea = ctx.createLinearGradient(0, 150, 0, 196);
    sea.addColorStop(0, '#1d7fc4');
    sea.addColorStop(1, '#3fb4d8');
    ctx.fillStyle = sea;
    ctx.fillRect(L, 150, R - L, 48);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (let row = 0; row < 3; row++) {
      const y = 160 + row * 12;
      const off = (time * 0.012 * (row + 1)) % 48;
      const start = Math.floor(L / 48) * 48 - 48;
      for (let x = start; x < R + 48; x += 48) ctx.fillRect(x + off + row * 13, y, 14 - row * 2, 2);
    }
    // 浪花
    const surf = 196 + Math.sin(time * 0.002) * 2;
    ctx.fillStyle = '#e9f8ff';
    ctx.fillRect(L, surf - 2, R - L, 4);
    // 沙灘
    const sand = ctx.createLinearGradient(0, surf, 0, H);
    sand.addColorStop(0, '#f6dd9b');
    sand.addColorStop(1, '#e8c26e');
    ctx.fillStyle = sand;
    ctx.fillRect(L, surf + 2, R - L, B - surf);
    ctx.fillStyle = 'rgba(190,140,60,0.35)';
    for (let i = 0; i < 60; i++) {
      const x = L + ((i * 97) % Math.max(1, Math.ceil(R - L)));
      const y = 210 + ((i * 53) % 90);
      ctx.fillRect(x, y, 2, 1);
    }
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

  private drawPlayer(pack: CharacterPack, p: PlayerState, x: number, y: number, facing: number, time: number, hue: boolean) {
    const ctx = this.ctx;
    const { name, frame } = this.animFor(p);
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

  private drawBall(x: number, y: number, squash: boolean) {
    const ctx = this.ctx;
    const R = C.BALL_R;
    ctx.save();
    ctx.translate(x, y + (squash ? 4 : 0));
    if (squash) ctx.scale(1.2, 0.8);
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.rotate(this.ballAngle);
    ctx.fillStyle = '#2f7fe0';
    ctx.beginPath();
    ctx.ellipse(-R * 0.55, -R * 0.2, R * 0.5, R * 1.1, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffc531';
    ctx.beginPath();
    ctx.ellipse(R * 0.45, R * 0.5, R * 0.9, R * 0.35, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.arc(-R * 0.35, -R * 0.4, R * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#1d3557';
    ctx.beginPath();
    ctx.arc(0, 0, R - 0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawNumber(n: number, x: number, y: number, align: 'left' | 'right', color: string) {
    const ctx = this.ctx;
    const text = String(n);
    const px = 6;
    const cw = 3 * px + px;
    const totalW = text.length * cw - px;
    let ox = align === 'left' ? x : x - totalW;
    for (const ch of text) {
      const bits = DIGITS[Number(ch)];
      for (let pass = 0; pass < 2; pass++) {
        ctx.fillStyle = pass === 0 ? '#1d3557' : color;
        const o = pass === 0 ? 2 : 0;
        for (let i = 0; i < 15; i++) {
          if (bits[i] === '1') ctx.fillRect(ox + (i % 3) * px + o, y + Math.floor(i / 3) * px + o, px, px);
        }
      }
      ox += cw;
    }
  }
}
