// 兩個台北場景：
// - taipei 信義夜景：台北 101 與信義區高樓的燈火、河面倒影、閃爍的航空障礙燈、
//   跑過河岸道路的車燈、101 會慢慢變換顏色，不時從塔頂附近放煙火。
// - zoo 木柵動物園：綠意盎然的山丘與樹林、橫越天空的貓空纜車、長頸鹿、大象、
//   竹林旁的貓熊、池塘邊的紅鶴，以及飛過的鳥群。
import { HORIZON, SHORE, rng, ridge } from './scenery';

const T101 = { x: 300 };

interface Building {
  x: number;
  w: number;
  h: number;
  light: boolean;
}

/** 信義區天際線（固定種子，每次都一樣） */
function skyline(L: number, R: number, seed: number, minH: number, maxH: number, nearTower: number): Building[] {
  const r = rng(seed);
  const out: Building[] = [];
  let x = L - 10;
  while (x < R + 10) {
    const w = 8 + r() * 18;
    const dist = Math.abs(x + w / 2 - T101.x);
    // 越靠近 101（信義計畫區）大樓越高
    const boost = dist < 120 ? (1 - dist / 120) * nearTower : 0;
    const h = minH + r() * (maxH - minH) + boost;
    if (!(x + w > T101.x - 16 && x < T101.x + 16)) out.push({ x, w, h, light: r() < 0.35 });
    x += w + 1 + r() * 4;
  }
  return out;
}

function paintBuilding(g: CanvasRenderingContext2D, b: Building, body: string, windowAlpha: number, seed: number) {
  const top = HORIZON - b.h;
  const grad = g.createLinearGradient(b.x, 0, b.x + b.w, 0);
  grad.addColorStop(0, body);
  grad.addColorStop(1, '#0c1226');
  g.fillStyle = grad;
  g.fillRect(b.x, top, b.w, b.h + 1);
  // 窗戶：大部分暖黃，少數冷白、青色
  const r = rng(seed);
  for (let y = top + 3; y < HORIZON - 2; y += 3) {
    for (let x = b.x + 1.5; x < b.x + b.w - 1.5; x += 2.5) {
      if (r() > 0.42) continue;
      const k = r();
      const c = k < 0.65 ? '255,214,140' : k < 0.9 ? '235,240,255' : '140,230,255';
      g.fillStyle = `rgba(${c},${windowAlpha * (0.5 + r() * 0.5)})`;
      g.fillRect(x, y, 1.2, 1.2);
    }
  }
  if (b.light) {
    g.fillStyle = 'rgba(160,220,255,0.35)';
    g.fillRect(b.x, top, b.w, 1);
  }
}

/** 台北 101 的輪廓（不含燈光）：基座、8 節往上外擴的塔身、頂部塔樓與尖塔 */
function tower101Path(): { segs: { y0: number; y1: number; wb: number; wt: number }[]; topY: number } {
  const segs: { y0: number; y1: number; wb: number; wt: number }[] = [];
  segs.push({ y0: HORIZON, y1: HORIZON - 12, wb: 46, wt: 44 }); // 裙樓
  segs.push({ y0: HORIZON - 12, y1: HORIZON - 40, wb: 26, wt: 19 }); // 底座塔身（往上收）
  let y = HORIZON - 40;
  for (let i = 0; i < 8; i++) {
    segs.push({ y0: y, y1: y - 10.5, wb: 15, wt: 22 }); // 每節往上外擴
    y -= 10.5;
  }
  segs.push({ y0: y, y1: y - 7, wb: 12, wt: 11 });
  segs.push({ y0: y - 7, y1: y - 12, wb: 8, wt: 7 });
  return { segs, topY: y - 12 };
}

function trapezoid(g: CanvasRenderingContext2D, cx: number, y0: number, y1: number, wb: number, wt: number) {
  g.beginPath();
  g.moveTo(cx - wb / 2, y0);
  g.lineTo(cx - wt / 2, y1);
  g.lineTo(cx + wt / 2, y1);
  g.lineTo(cx + wb / 2, y0);
  g.closePath();
  g.fill();
}

export function paintTaipei(g: CanvasRenderingContext2D, L: number, T: number, R: number, B: number) {
  const W = R - L;
  // 夜空：深藍，接近地平線被城市燈光染成紫紅
  const sky = g.createLinearGradient(0, Math.min(T, -40), 0, HORIZON + 2);
  sky.addColorStop(0, '#070b24');
  sky.addColorStop(0.5, '#18184a');
  sky.addColorStop(0.82, '#46265e');
  sky.addColorStop(1, '#a24a6e');
  g.fillStyle = sky;
  g.fillRect(L, T, W, HORIZON + 2 - T);
  const st = rng(61);
  for (let i = 0; i < W * 0.25; i++) {
    g.fillStyle = `rgba(255,255,255,${0.15 + st() * 0.4})`;
    g.fillRect(L + st() * W, T + st() * (90 - T), 0.6, 0.6);
  }
  // 月亮
  const mx = 90;
  const my = 34;
  const moon = g.createRadialGradient(mx, my, 0, mx, my, 30);
  moon.addColorStop(0, 'rgba(255,250,230,0.5)');
  moon.addColorStop(1, 'rgba(255,250,230,0)');
  g.fillStyle = moon;
  g.fillRect(mx - 30, my - 30, 60, 60);
  g.fillStyle = '#fff6dc';
  g.beginPath();
  g.arc(mx, my, 7, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(200,190,170,0.5)';
  g.beginPath();
  g.arc(mx + 2, my - 1.5, 1.6, 0, Math.PI * 2);
  g.arc(mx - 2.5, my + 2, 1.1, 0, Math.PI * 2);
  g.fill();

  // 遠山（四獸山一帶）
  ridge(g, L, R, HORIZON + 1, 40, 71, '#191a3e', 10);
  // 城市光害
  const glow = g.createLinearGradient(0, HORIZON - 60, 0, HORIZON);
  glow.addColorStop(0, 'rgba(255,140,120,0)');
  glow.addColorStop(1, 'rgba(255,150,120,0.25)');
  g.fillStyle = glow;
  g.fillRect(L, HORIZON - 60, W, 60);

  // 天際線：遠排較矮較淡、近排較高
  for (const b of skyline(L, R, 81, 8, 26, 10)) paintBuilding(g, b, '#232a52', 0.45, b.x * 7);
  for (const b of skyline(L, R, 82, 14, 44, 40)) paintBuilding(g, b, '#1a2142', 0.85, b.x * 13 + 1);

  // 台北 101：深色玻璃塔身＋窗戶（燈光顏色在每幀另外畫）
  const { segs, topY } = tower101Path();
  for (const s of segs) {
    const grad = g.createLinearGradient(T101.x - s.wt / 2, 0, T101.x + s.wt / 2, 0);
    grad.addColorStop(0, '#2c3d58');
    grad.addColorStop(0.45, '#1a2740');
    grad.addColorStop(1, '#0d1528');
    g.fillStyle = grad;
    trapezoid(g, T101.x, s.y0, s.y1, s.wb, s.wt);
  }
  const wr = rng(91);
  for (const s of segs.slice(1)) {
    for (let y = s.y1 + 1.5; y < s.y0 - 1; y += 1.8) {
      const t = (s.y0 - y) / (s.y0 - s.y1);
      const half = (s.wb + (s.wt - s.wb) * t) / 2 - 1.5;
      for (let x = T101.x - half; x < T101.x + half; x += 1.6) {
        if (wr() < 0.5) {
          g.fillStyle = `rgba(255,236,190,${0.35 + wr() * 0.4})`;
          g.fillRect(x, y, 0.8, 0.6);
        }
      }
    }
  }
  // 尖塔
  g.strokeStyle = '#8fa3c0';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(T101.x, topY);
  g.lineTo(T101.x, topY - 26);
  g.stroke();

  // 基隆河：倒映燈火的深色河面
  const river = g.createLinearGradient(0, HORIZON, 0, SHORE + 2);
  river.addColorStop(0, '#2a2350');
  river.addColorStop(0.5, '#141634');
  river.addColorStop(1, '#0d1028');
  g.fillStyle = river;
  g.fillRect(L, HORIZON, W, SHORE + 2 - HORIZON);
  const rr = rng(95);
  for (let i = 0; i < W * 0.6; i++) {
    const x = L + rr() * W;
    const y = HORIZON + 2 + rr() * (SHORE - HORIZON - 6);
    const c = rr() < 0.7 ? '255,200,130' : '200,220,255';
    g.fillStyle = `rgba(${c},${0.12 + rr() * 0.3})`;
    g.fillRect(x, y, 0.8 + rr() * 2.5, 0.6);
  }
  // 河岸道路
  g.fillStyle = '#20223f';
  g.fillRect(L, HORIZON - 1, W, 2.5);

  // 前景廣場：深色地磚＋路燈照出的光暈
  const plaza = g.createLinearGradient(0, SHORE, 0, B);
  plaza.addColorStop(0, '#3a3d5c');
  plaza.addColorStop(0.15, '#4a4c6c');
  plaza.addColorStop(1, '#2e3050');
  g.fillStyle = plaza;
  g.fillRect(L, SHORE, W, B - SHORE);
  g.strokeStyle = 'rgba(20,22,45,0.5)';
  g.lineWidth = 0.6;
  for (let y = SHORE + 6, gap = 5; y < B; y += gap, gap *= 1.18) {
    g.beginPath();
    g.moveTo(L, y);
    g.lineTo(R, y);
    g.stroke();
  }
  for (let x = Math.floor(L / 24) * 24; x < R; x += 24) {
    g.beginPath();
    g.moveTo(x, SHORE + 6);
    g.lineTo(x + (x - 216) * 0.4, B);
    g.stroke();
  }
  for (const lx of [L + 30, R - 30]) {
    const pool = g.createRadialGradient(lx, 270, 0, lx, 270, 70);
    pool.addColorStop(0, 'rgba(255,214,150,0.35)');
    pool.addColorStop(1, 'rgba(255,214,150,0)');
    g.fillStyle = pool;
    g.fillRect(lx - 70, 200, 140, B - 200);
    g.fillStyle = '#15172e';
    g.fillRect(lx - 1, 214, 2, 56);
    g.fillStyle = '#ffe2a8';
    g.beginPath();
    g.arc(lx, 214, 2.4, 0, Math.PI * 2);
    g.fill();
  }
  // 河岸欄杆
  g.fillStyle = 'rgba(120,130,170,0.6)';
  g.fillRect(L, SHORE + 2, W, 1);
  for (let x = Math.floor(L); x < R; x += 6) g.fillRect(x, SHORE + 2, 0.7, 5);
}

/** 信義夜景會動的部分：101 變色燈光、倒影、航空障礙燈、車流、煙火 */
export function drawTaipei(ctx: CanvasRenderingContext2D, time: number, L: number, R: number) {
  const hue = (time / 60) % 360;
  const { segs, topY } = tower101Path();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // 塔身每一節的邊緣燈光
  segs.slice(2).forEach((s, i) => {
    const h = (hue + i * 6) % 360;
    ctx.fillStyle = `hsla(${h},90%,62%,0.55)`;
    trapezoid(ctx, T101.x, s.y0, s.y0 - 1.6, s.wb, s.wb + (s.wt - s.wb) * 0.15);
    ctx.fillStyle = `hsla(${h},90%,70%,0.18)`;
    trapezoid(ctx, T101.x, s.y0, s.y1, s.wb, s.wt);
  });
  // 塔頂光暈
  const top = ctx.createRadialGradient(T101.x, topY, 0, T101.x, topY, 26);
  top.addColorStop(0, `hsla(${hue},90%,70%,0.45)`);
  top.addColorStop(1, `hsla(${hue},90%,70%,0)`);
  ctx.fillStyle = top;
  ctx.fillRect(T101.x - 26, topY - 26, 52, 52);
  // 河面上的倒影光柱
  const refl = ctx.createLinearGradient(T101.x - 14, 0, T101.x + 14, 0);
  refl.addColorStop(0, `hsla(${hue},90%,65%,0)`);
  refl.addColorStop(0.5, `hsla(${hue},90%,65%,0.3)`);
  refl.addColorStop(1, `hsla(${hue},90%,65%,0)`);
  ctx.fillStyle = refl;
  for (let y = HORIZON + 2; y < SHORE; y += 2) {
    const wob = Math.sin(y * 0.7 + time * 0.004) * 2;
    ctx.fillRect(T101.x - 14 + wob, y, 28, 1.2);
  }
  // 航空障礙燈（紅色閃爍）
  const blink = Math.sin(time * 0.004) > 0.3;
  if (blink) {
    ctx.fillStyle = 'rgba(255,60,60,0.95)';
    ctx.fillRect(T101.x - 0.6, topY - 27, 1.2, 1.2);
    for (const b of skyline(L, R, 82, 14, 44, 40)) {
      if (b.h > 40) ctx.fillRect(b.x + b.w / 2 - 0.5, HORIZON - b.h - 1.2, 1, 1);
    }
  }
  // 河岸道路的車流
  for (let i = 0; i < 18; i++) {
    const dir = i % 2 ? 1 : -1;
    const speed = 0.02 + (i % 5) * 0.004;
    const span = R - L + 40;
    const x = L - 20 + ((((i * 73 + dir * time * speed) % span) + span) % span);
    ctx.fillStyle = dir > 0 ? 'rgba(255,90,80,0.9)' : 'rgba(255,245,220,0.95)';
    ctx.fillRect(x, HORIZON - 0.4 + (dir > 0 ? 0.9 : 0), 1.4, 0.6);
  }
  // 煙火
  for (let slot = 0; slot < 2; slot++) {
    const period = 3400 + slot * 1300;
    const tt = time + slot * 1700;
    const n = Math.floor(tt / period);
    const p = (tt % period) / period;
    if (p > 0.75) continue;
    const r = rng(n * 11 + slot * 5);
    const bx = T101.x + (r() - 0.5) * 160;
    const by = 10 + r() * 45;
    const h = Math.floor(r() * 360);
    if (p < 0.15) {
      // 升空
      const k = p / 0.15;
      ctx.fillStyle = `hsla(${h},100%,80%,0.9)`;
      ctx.fillRect(bx - 0.5, HORIZON - (HORIZON - by) * k, 1, 2);
      continue;
    }
    const k = (p - 0.15) / 0.6;
    const fade = 1 - k;
    const count = 30;
    for (let j = 0; j < count; j++) {
      const a = (j / count) * Math.PI * 2 + r() * 0.1;
      const dist = 26 * Math.sqrt(k) * (0.85 + 0.3 * ((j * 37) % 7) / 7);
      const x = bx + Math.cos(a) * dist;
      const y = by + Math.sin(a) * dist + k * k * 14;
      ctx.fillStyle = `hsla(${(h + (j % 3) * 20) % 360},100%,${65 + fade * 20}%,${fade})`;
      ctx.fillRect(x - 0.7, y - 0.7, 1.4, 1.4);
    }
    const flash = ctx.createRadialGradient(bx, by, 0, bx, by, 30);
    flash.addColorStop(0, `hsla(${h},100%,75%,${0.25 * fade})`);
    flash.addColorStop(1, `hsla(${h},100%,75%,0)`);
    ctx.fillStyle = flash;
    ctx.fillRect(bx - 30, by - 30, 60, 60);
  }
  ctx.restore();
}

// ------------------------------------------------------------------ 木柵動物園

/** 纜車線：從左邊山丘往右上方的山頭 */
const CABLE = { x0: -60, y0: 118, x1: 500, y1: 30 };

function cableY(x: number, offset: number) {
  const t = (x - CABLE.x0) / (CABLE.x1 - CABLE.x0);
  // 微微下垂的懸鏈
  return CABLE.y0 + (CABLE.y1 - CABLE.y0) * t + Math.sin(t * Math.PI) * 10 + offset;
}

function giraffe(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  g.fillStyle = '#e8b04f';
  g.strokeStyle = '#e8b04f';
  g.lineWidth = 1.6 * s;
  for (const lx of [-6, -3, 4, 7]) {
    g.beginPath();
    g.moveTo(x + lx * s, y - 2 * s);
    g.lineTo(x + lx * s, y + 9 * s);
    g.stroke();
  }
  g.beginPath();
  g.ellipse(x, y - 3 * s, 9 * s, 4.5 * s, -0.1, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 2.6 * s;
  g.beginPath();
  g.moveTo(x + 6 * s, y - 5 * s);
  g.lineTo(x + 11 * s, y - 22 * s);
  g.stroke();
  g.beginPath();
  g.ellipse(x + 13 * s, y - 23 * s, 3.6 * s, 2 * s, 0.3, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#9a5a2a';
  for (const [px, py] of [[-4, -4], [1, -2], [4, -5], [-1, -6], [8, -10], [9, -15]]) {
    g.beginPath();
    g.arc(x + px * s, y + py * s, 1.2 * s, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#5a3a1a';
  g.fillRect(x + 11 * s, y - 27 * s, 0.8 * s, 2.5 * s);
  g.fillRect(x + 13 * s, y - 27 * s, 0.8 * s, 2.5 * s);
}

function elephant(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  g.fillStyle = '#8a8f9c';
  for (const lx of [-7, -3, 3, 7]) g.fillRect(x + lx * s - 1.5 * s, y - 2 * s, 3 * s, 9 * s);
  g.beginPath();
  g.ellipse(x, y - 4 * s, 11 * s, 7 * s, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(x + 11 * s, y - 7 * s, 5.5 * s, 5 * s, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#8a8f9c';
  g.lineWidth = 2.2 * s;
  g.beginPath();
  g.moveTo(x + 15 * s, y - 6 * s);
  g.quadraticCurveTo(x + 18 * s, y + 1 * s, x + 16 * s, y + 5 * s);
  g.stroke();
  g.fillStyle = '#767b88';
  g.beginPath();
  g.ellipse(x + 8 * s, y - 7 * s, 3.5 * s, 4.5 * s, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1d1d24';
  g.fillRect(x + 12.5 * s, y - 9 * s, 1 * s, 1 * s);
}

function panda(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  // 竹子
  g.strokeStyle = '#4f9a3c';
  g.lineWidth = 1.4 * s;
  for (const bx of [-14, -11, 12, 15]) {
    g.beginPath();
    g.moveTo(x + bx * s, y + 8 * s);
    g.lineTo(x + bx * s + 1, y - 26 * s);
    g.stroke();
    g.fillStyle = '#6cbf4f';
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      g.ellipse(x + bx * s + 3 * s, y - (8 + k * 8) * s, 3 * s, 1 * s, -0.5, 0, Math.PI * 2);
      g.fill();
    }
  }
  // 坐著的貓熊
  g.fillStyle = '#f7f5ef';
  g.beginPath();
  g.ellipse(x, y, 8 * s, 8 * s, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(x, y - 10 * s, 6 * s, 5.5 * s, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1e1e24';
  for (const ex of [-4.5, 4.5]) {
    g.beginPath();
    g.arc(x + ex * s, y - 15 * s, 2 * s, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(x + ex * 0.5 * s, y - 10.5 * s, 1.5 * s, 2 * s, ex > 0 ? 0.5 : -0.5, 0, Math.PI * 2);
    g.fill();
  }
  g.beginPath();
  g.ellipse(x - 6 * s, y + 1 * s, 2.6 * s, 4.5 * s, 0.4, 0, Math.PI * 2);
  g.ellipse(x + 6 * s, y + 1 * s, 2.6 * s, 4.5 * s, -0.4, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(x - 4 * s, y + 7 * s, 3 * s, 2 * s, 0, 0, Math.PI * 2);
  g.ellipse(x + 4 * s, y + 7 * s, 3 * s, 2 * s, 0, 0, Math.PI * 2);
  g.fill();
  g.fillRect(x - 0.6 * s, y - 9 * s, 1.2 * s, 0.9 * s);
}

function flamingo(g: CanvasRenderingContext2D, x: number, y: number, s: number, flip: number) {
  g.strokeStyle = '#d9707a';
  g.lineWidth = 0.7 * s;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x, y - 9 * s);
  g.stroke();
  g.fillStyle = '#f59aa6';
  g.beginPath();
  g.ellipse(x, y - 11 * s, 3.4 * s, 2.2 * s, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#f59aa6';
  g.lineWidth = 1 * s;
  g.beginPath();
  g.moveTo(x + 2 * flip * s, y - 12 * s);
  g.quadraticCurveTo(x + 5 * flip * s, y - 16 * s, x + 2.5 * flip * s, y - 19 * s);
  g.stroke();
  g.fillStyle = '#f59aa6';
  g.beginPath();
  g.arc(x + 2.5 * flip * s, y - 19.5 * s, 1.2 * s, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#2a2a2a';
  g.fillRect(x + 3.4 * flip * s - (flip < 0 ? 1 : 0), y - 19.8 * s, 1 * s, 0.7 * s);
}

export function paintZoo(g: CanvasRenderingContext2D, L: number, T: number, R: number, B: number) {
  const W = R - L;
  const sky = g.createLinearGradient(0, Math.min(T, -40), 0, HORIZON + 2);
  sky.addColorStop(0, '#2f7fd8');
  sky.addColorStop(0.6, '#7cc2f2');
  sky.addColorStop(1, '#e3f4fb');
  g.fillStyle = sky;
  g.fillRect(L, T, W, HORIZON + 2 - T);
  const sun = g.createRadialGradient(360, 40, 0, 360, 40, 120);
  sun.addColorStop(0, 'rgba(255,253,235,0.95)');
  sun.addColorStop(0.12, 'rgba(255,248,220,0.6)');
  sun.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = sun;
  g.fillRect(L, T, W, HORIZON - T);

  // 木柵、貓空一帶的山：遠山偏藍、近山翠綠
  ridge(g, L, R, HORIZON + 1, 62, 111, '#8bbfa8', 30);
  ridge(g, L, R, HORIZON + 1, 40, 112, '#5fa36e', 50);
  // 樹冠
  const tr = rng(113);
  for (let i = 0; i < W * 1.6; i++) {
    const x = L + tr() * W;
    const y = HORIZON - 4 - Math.pow(tr(), 1.6) * 34;
    const r = 2 + tr() * 3.5;
    const shade = tr();
    g.fillStyle = shade < 0.33 ? '#3f8a52' : shade < 0.66 ? '#4f9a5c' : '#6db56f';
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  // 纜車塔架
  for (const tx of [60, 220, 380]) {
    const ty = cableY(tx, 0);
    g.strokeStyle = 'rgba(90,100,110,0.9)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(tx - 3, ty + 40);
    g.lineTo(tx, ty - 2);
    g.lineTo(tx + 3, ty + 40);
    g.moveTo(tx - 5, ty - 2);
    g.lineTo(tx + 5, ty - 2);
    g.stroke();
  }
  // 纜繩（去程、回程兩條）
  for (const off of [0, 3]) {
    g.strokeStyle = 'rgba(60,64,72,0.85)';
    g.lineWidth = 0.6;
    g.beginPath();
    for (let x = Math.floor(L); x <= R; x += 4) {
      if (x === Math.floor(L)) g.moveTo(x, cableY(x, off));
      else g.lineTo(x, cableY(x, off));
    }
    g.stroke();
  }

  // 草原與動物區
  const meadow = g.createLinearGradient(0, HORIZON, 0, SHORE + 2);
  meadow.addColorStop(0, '#9ccf72');
  meadow.addColorStop(1, '#7dbb5c');
  g.fillStyle = meadow;
  g.fillRect(L, HORIZON, W, SHORE + 2 - HORIZON);
  // 紅鶴的池塘
  const pond = g.createLinearGradient(0, 176, 0, 192);
  pond.addColorStop(0, '#7ec8e3');
  pond.addColorStop(1, '#4fa3c8');
  g.fillStyle = pond;
  g.beginPath();
  g.ellipse(372, 184, 46, 8, 0, 0, Math.PI * 2);
  g.fill();
  // 草叢點綴
  const gr = rng(117);
  for (let i = 0; i < W; i++) {
    g.fillStyle = gr() < 0.5 ? 'rgba(70,130,50,0.35)' : 'rgba(200,235,160,0.35)';
    g.fillRect(L + gr() * W, HORIZON + 2 + gr() * (SHORE - HORIZON - 4), 1.2, 0.8);
  }
  giraffe(g, 44, 178, 1.1);
  giraffe(g, 92, 182, 0.85);
  elephant(g, 168, 184, 1);
  panda(g, 262, 182, 0.9);
  flamingo(g, 352, 186, 0.9, 1);
  flamingo(g, 366, 184, 0.9, -1);
  flamingo(g, 384, 187, 0.9, 1);
  // 動物區的木柵欄
  g.fillStyle = '#9a6b42';
  g.fillRect(L, SHORE - 6, W, 1.2);
  g.fillRect(L, SHORE - 2, W, 1.2);
  for (let x = Math.floor(L / 8) * 8; x < R; x += 8) g.fillRect(x, SHORE - 9, 1.4, 9);

  // 步道（球場）：紅磚色的土地
  const path = g.createLinearGradient(0, SHORE, 0, B);
  path.addColorStop(0, '#c99a6c');
  path.addColorStop(0.1, '#e2bb8c');
  path.addColorStop(1, '#cfa071');
  g.fillStyle = path;
  g.fillRect(L, SHORE, W, B - SHORE);
  const pr = rng(119);
  for (let i = 0; i < W * 1.5; i++) {
    g.fillStyle = pr() < 0.5 ? 'rgba(130,80,40,0.2)' : 'rgba(255,240,220,0.3)';
    g.fillRect(L + pr() * W, SHORE + 4 + pr() * (B - SHORE - 4), 0.9, 0.9);
  }
  // 落葉
  for (let i = 0; i < 14; i++) {
    g.fillStyle = i % 2 ? 'rgba(120,170,70,0.8)' : 'rgba(210,150,60,0.8)';
    g.beginPath();
    g.ellipse(L + pr() * W, 262 + pr() * 36, 1.8, 0.9, pr() * 3, 0, Math.PI * 2);
    g.fill();
  }
}

/** 動物園會動的部分：纜車車廂、鳥群、池塘波光 */
export function drawZoo(ctx: CanvasRenderingContext2D, time: number, L: number, R: number) {
  const colors = ['#ffffff', '#7cc26b', '#ffd36b', '#ff9a8a'];
  for (const [off, dir] of [[0, 1], [3, -1]] as const) {
    for (let i = 0; i < 7; i++) {
      const span = CABLE.x1 - CABLE.x0;
      const x = CABLE.x0 + ((((i * span) / 7 + dir * time * 0.012) % span) + span) % span;
      if (x < L - 10 || x > R + 10) continue;
      const y = cableY(x, off);
      ctx.strokeStyle = 'rgba(60,64,72,0.9)';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + 4);
      ctx.stroke();
      ctx.fillStyle = colors[(i + (dir > 0 ? 0 : 2)) % colors.length];
      ctx.beginPath();
      ctx.roundRect(x - 3.5, y + 4, 7, 6, 1.8);
      ctx.fill();
      ctx.fillStyle = 'rgba(80,140,190,0.8)';
      ctx.fillRect(x - 2.5, y + 5.2, 5, 2);
    }
  }
  // 鳥群
  ctx.strokeStyle = 'rgba(40,50,70,0.75)';
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 5; i++) {
    const span = R - L + 60;
    const x = L - 30 + ((((i * 23 + time * 0.018) % span) + span) % span);
    const y = 60 + i * 5 + Math.sin(time * 0.002 + i) * 3;
    const flap = Math.sin(time * 0.012 + i * 2) * 1.6;
    ctx.beginPath();
    ctx.moveTo(x - 3, y - flap);
    ctx.lineTo(x, y);
    ctx.lineTo(x + 3, y - flap);
    ctx.stroke();
  }
  // 池塘波光
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 14; i++) {
    const a = Math.sin(time * 0.003 + i * 1.7);
    if (a < 0.3) continue;
    ctx.fillStyle = `rgba(255,255,255,${(a - 0.3) * 0.8})`;
    ctx.fillRect(338 + ((i * 29) % 68), 180 + ((i * 7) % 8), 3, 0.6);
  }
  ctx.restore();
}
