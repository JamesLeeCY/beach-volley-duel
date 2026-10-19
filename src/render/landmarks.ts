// 台北景點場景（全部原創繪製，取景點的特色，不使用官方標誌）：
// - ntu      台大椰林大道：兩排大王椰子延伸到總圖，椰子葉隨風擺動。
// - songshan 松菸與大巨蛋：銀色的大巨蛋、紅磚菸廠與高煙囪、生態池倒影，遠處一座小小的 101。
// - expo     圓山花博：山坡上的圓山大飯店、高架捷運列車駛過、花海與蝴蝶。
// - yangming 陽明山溫泉：七星山、硫磺噴氣孔與溫泉池的蒸氣、隨風搖曳的芒草、山谷雲霧。
// - tamsui   淡水夕陽：沉入河口的夕陽、觀音山剪影、情人橋、隨波起伏的漁船與白鷺。
import { HORIZON, SHORE, rng, ridge } from './scenery';

type G = CanvasRenderingContext2D;

function skyGradient(g: G, L: number, T: number, R: number, stops: [number, string][]) {
  const sky = g.createLinearGradient(0, Math.min(T, -40), 0, HORIZON + 2);
  for (const [o, c] of stops) sky.addColorStop(o, c);
  g.fillStyle = sky;
  g.fillRect(L, T, R - L, HORIZON + 2 - T);
}

function sunGlow(g: G, L: number, T: number, R: number, x: number, y: number, r: number, c: string, a: number) {
  const glow = g.createRadialGradient(x, y, 0, x, y, r);
  glow.addColorStop(0, `rgba(${c},${a})`);
  glow.addColorStop(0.12, `rgba(${c},${a * 0.7})`);
  glow.addColorStop(1, `rgba(${c},0)`);
  g.fillStyle = glow;
  g.fillRect(L, T, R - L, HORIZON + 2 - T);
}

/** 地面：漸層＋細顆粒（磚、石、木的質感由呼叫端另外加） */
function ground(g: G, L: number, R: number, B: number, top: string, mid: string, bottom: string, seed: number) {
  const grad = g.createLinearGradient(0, SHORE, 0, B);
  grad.addColorStop(0, top);
  grad.addColorStop(0.12, mid);
  grad.addColorStop(1, bottom);
  g.fillStyle = grad;
  g.fillRect(L, SHORE, R - L, B - SHORE);
  const r = rng(seed);
  for (let i = 0; i < (R - L) * 1.2; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(60,40,30,0.12)' : 'rgba(255,250,240,0.18)';
    g.fillRect(L + r() * (R - L), SHORE + 4 + r() * (B - SHORE - 4), 0.9, 0.9);
  }
}

/** 磚面：交錯排列的磚縫 */
function brickLines(g: G, L: number, R: number, B: number, color: string) {
  g.strokeStyle = color;
  g.lineWidth = 0.5;
  let row = 0;
  for (let y = SHORE + 4, h = 4; y < B; y += h, h *= 1.12, row++) {
    g.beginPath();
    g.moveTo(L, y);
    g.lineTo(R, y);
    g.stroke();
    const w = h * 2.4;
    for (let x = Math.floor(L / w) * w + (row % 2) * w * 0.5; x < R; x += w) {
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, y + h);
      g.stroke();
    }
  }
}

/** 木棧板：橫向木板＋少量釘痕 */
function planks(g: G, L: number, R: number, B: number, color: string) {
  g.strokeStyle = color;
  g.lineWidth = 0.6;
  for (let y = SHORE + 5, h = 4.5; y < B; y += h, h *= 1.1) {
    g.beginPath();
    g.moveTo(L, y);
    g.lineTo(R, y);
    g.stroke();
  }
}

function birds(ctx: G, time: number, L: number, R: number, y0: number, color: string, count = 5) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.8;
  for (let i = 0; i < count; i++) {
    const span = R - L + 60;
    const x = L - 30 + ((((i * 23 + time * 0.016) % span) + span) % span);
    const y = y0 + i * 5 + Math.sin(time * 0.002 + i) * 3;
    const flap = Math.sin(time * 0.012 + i * 2) * 1.6;
    ctx.beginPath();
    ctx.moveTo(x - 3, y - flap);
    ctx.lineTo(x, y);
    ctx.lineTo(x + 3, y - flap);
    ctx.stroke();
  }
}

function sparkles(ctx: G, time: number, L: number, R: number, cx: number, color: string, count: number, gain: number) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < count; i++) {
    const near = i % 2 === 0;
    const x = near ? cx + (((i * 37) % 70) - 35) : L + ((i * 61) % Math.max(1, Math.floor(R - L)));
    if (x < L || x > R) continue;
    const y = HORIZON + 3 + ((i * 13) % (SHORE - HORIZON - 8));
    const a = Math.sin(time * (0.002 + (i % 5) * 0.0007) + i);
    if (a < 0.25) continue;
    ctx.fillStyle = `rgba(${color},${(a - 0.25) * gain})`;
    ctx.fillRect(x, y, 2 + (y - HORIZON) * 0.08, 0.7);
  }
  ctx.restore();
}

// ================================================================== 台大椰林大道

interface Palm {
  x: number;
  base: number;
  h: number;
  s: number;
}

/** 兩排大王椰子：越近越高、越往畫面兩側 */
function palms(L: number, R: number): Palm[] {
  const out: Palm[] = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1); // 0 = 最遠
    const s = 0.35 + t * 0.75;
    const spread = 40 + t * Math.max(260, (R - L) / 2 + 20);
    const base = HORIZON + 2 + t * 40;
    for (const side of [-1, 1]) out.push({ x: 216 + side * spread, base, h: 70 * s + 20, s });
  }
  return out;
}

function drawPalm(ctx: G, p: Palm, sway: number) {
  const topX = p.x + sway * 2 * p.s;
  const topY = p.base - p.h;
  // 灰白色的樹幹，微微中段鼓起
  ctx.strokeStyle = '#d9d4c8';
  ctx.lineWidth = 2.6 * p.s;
  ctx.beginPath();
  ctx.moveTo(p.x, p.base);
  ctx.quadraticCurveTo(p.x + 1.2 * p.s, p.base - p.h * 0.5, topX, topY);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(120,115,100,0.35)';
  ctx.lineWidth = 0.6;
  for (let y = p.base - 4; y > topY + 6; y -= 4 * p.s + 1) {
    ctx.beginPath();
    ctx.moveTo(p.x - 1.2 * p.s, y);
    ctx.lineTo(p.x + 1.2 * p.s, y);
    ctx.stroke();
  }
  // 綠色冠莖
  ctx.fillStyle = '#7aa64f';
  ctx.fillRect(topX - 1.4 * p.s, topY - 6 * p.s, 2.8 * p.s, 7 * p.s);
  // 放射狀的羽狀葉
  for (let k = 0; k < 11; k++) {
    const a = -Math.PI / 2 + (k - 5) * 0.32 + sway * 0.06;
    const len = 16 * p.s * (0.8 + ((k * 7) % 5) * 0.06);
    const ex = topX + Math.cos(a) * len;
    const ey = topY - 6 * p.s + Math.sin(a) * len * 0.6 + len * 0.45;
    ctx.strokeStyle = k % 2 ? '#3f7d3a' : '#529446';
    ctx.lineWidth = 1.6 * p.s;
    ctx.beginPath();
    ctx.moveTo(topX, topY - 6 * p.s);
    ctx.quadraticCurveTo(topX + Math.cos(a) * len * 0.6, topY - 6 * p.s + Math.sin(a) * len * 0.7, ex, ey);
    ctx.stroke();
  }
}

export function paintNtu(g: G, L: number, T: number, R: number, B: number) {
  skyGradient(g, L, T, R, [[0, '#2f78d0'], [0.6, '#86c4f0'], [1, '#e8f5fb']]);
  sunGlow(g, L, T, R, 330, 58, 160, '255,250,230', 0.8);
  // 遠方的樹
  const tr = rng(201);
  for (let i = 0; i < (R - L) * 0.9; i++) {
    const x = L + tr() * (R - L);
    const y = HORIZON - 4 - tr() * 12;
    g.fillStyle = tr() < 0.5 ? '#5f9a5a' : '#78ae66';
    g.beginPath();
    g.arc(x, y, 3 + tr() * 4, 0, Math.PI * 2);
    g.fill();
  }
  // 總圖：褐色面磚的主樓＋中央門廊列柱＋灰色屋頂
  const cx = 216;
  const bodyGrad = g.createLinearGradient(0, 112, 0, HORIZON);
  bodyGrad.addColorStop(0, '#c98a62');
  bodyGrad.addColorStop(1, '#a96a4a');
  g.fillStyle = bodyGrad;
  g.fillRect(cx - 82, 116, 164, HORIZON - 116);
  g.fillStyle = '#7d8691';
  g.beginPath();
  g.moveTo(cx - 88, 117);
  g.lineTo(cx - 78, 108);
  g.lineTo(cx + 78, 108);
  g.lineTo(cx + 88, 117);
  g.closePath();
  g.fill();
  // 兩翼的拱窗
  g.fillStyle = 'rgba(60,70,90,0.75)';
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const x = cx + side * (36 + i * 11) - 3;
      g.fillRect(x, 124, 6, 16);
      g.beginPath();
      g.arc(x + 3, 124, 3, Math.PI, 0);
      g.fill();
    }
  }
  // 中央門廊
  g.fillStyle = '#d9a27a';
  g.fillRect(cx - 28, 100, 56, HORIZON - 100);
  g.fillStyle = '#6d7782';
  g.beginPath();
  g.moveTo(cx - 34, 101);
  g.lineTo(cx, 86);
  g.lineTo(cx + 34, 101);
  g.closePath();
  g.fill();
  g.fillStyle = '#f2e6d4';
  for (let i = 0; i < 6; i++) g.fillRect(cx - 24 + i * 9.4, 106, 2.4, HORIZON - 108);
  g.fillStyle = 'rgba(70,60,60,0.55)';
  g.beginPath();
  g.arc(cx, 124, 9, Math.PI, 0);
  g.fill();
  g.fillRect(cx - 9, 124, 18, HORIZON - 124);
  // 中段：椰林大道路面＋兩側草地
  const lawn = g.createLinearGradient(0, HORIZON, 0, SHORE + 2);
  lawn.addColorStop(0, '#8cc06a');
  lawn.addColorStop(1, '#6fae55');
  g.fillStyle = lawn;
  g.fillRect(L, HORIZON, R - L, SHORE + 2 - HORIZON);
  g.fillStyle = '#9a9ea6';
  g.beginPath();
  g.moveTo(cx - 14, HORIZON);
  g.lineTo(cx + 14, HORIZON);
  g.lineTo(cx + 150, SHORE + 2);
  g.lineTo(cx - 150, SHORE + 2);
  g.closePath();
  g.fill();
  g.fillStyle = '#b4725a';
  for (const side of [-1, 1]) {
    g.beginPath();
    g.moveTo(cx + side * 14, HORIZON);
    g.lineTo(cx + side * 19, HORIZON);
    g.lineTo(cx + side * 172, SHORE + 2);
    g.lineTo(cx + side * 150, SHORE + 2);
    g.closePath();
    g.fill();
  }
  // 停在路邊的腳踏車
  const bk = rng(203);
  for (let i = 0; i < 9; i++) {
    const side = i % 2 ? 1 : -1;
    const t = 0.3 + bk() * 0.6;
    const x = cx + side * (20 + t * 160);
    const y = HORIZON + t * (SHORE - HORIZON) - 2;
    const s = 0.5 + t * 0.6;
    g.strokeStyle = ['#2d4a6e', '#b33a3a', '#2f2f35', '#3d7a4a'][i % 4];
    g.lineWidth = 0.7 * s;
    g.beginPath();
    g.arc(x - 3 * s, y, 2 * s, 0, Math.PI * 2);
    g.arc(x + 3 * s, y, 2 * s, 0, Math.PI * 2);
    g.moveTo(x - 3 * s, y);
    g.lineTo(x, y - 3 * s);
    g.lineTo(x + 3 * s, y);
    g.stroke();
  }
  // 地面：柏油路面
  ground(g, L, R, B, '#7e828a', '#8f939b', '#777b83', 205);
  g.fillStyle = 'rgba(255,255,255,0.35)';
  for (let x = Math.floor(L / 30) * 30; x < R; x += 30) g.fillRect(x, 288, 14, 1.5);
}

export function drawNtu(ctx: G, time: number, L: number, R: number) {
  const list = palms(L, R).sort((a, b) => a.base - b.base);
  for (const p of list) drawPalm(ctx, p, Math.sin(time * 0.0012 + p.x * 0.05));
  birds(ctx, time, L, R, 40, 'rgba(40,50,70,0.7)', 4);
}

// ================================================================== 松菸與大巨蛋

const DOME = { x: 300, w: 210, h: 58 };

export function paintSongshan(g: G, L: number, T: number, R: number, B: number) {
  skyGradient(g, L, T, R, [[0, '#3a6fc0'], [0.55, '#8bb9e6'], [0.85, '#f3cfae'], [1, '#ffd9a8']]);
  sunGlow(g, L, T, R, 120, 110, 180, '255,220,170', 0.75);
  // 遠處的小 101
  g.fillStyle = 'rgba(90,110,150,0.8)';
  g.fillRect(418, 92, 5, HORIZON - 92);
  for (let i = 0; i < 6; i++) g.fillRect(416.5, 96 + i * 7, 8, 2);
  g.fillRect(420, 80, 1, 12);
  // 遠方樓群
  const bl = rng(301);
  for (let x = L; x < R; ) {
    const w = 8 + bl() * 16;
    const h = 10 + bl() * 26;
    g.fillStyle = `rgba(${110 + bl() * 30},${125 + bl() * 30},${160 + bl() * 30},0.7)`;
    g.fillRect(x, HORIZON - h, w, h);
    x += w + 2;
  }
  // 大巨蛋：銀色橢圓屋頂＋放射肋骨＋底部玻璃帶
  const top = HORIZON - 18 - DOME.h;
  const roof = g.createLinearGradient(DOME.x - DOME.w / 2, top, DOME.x + DOME.w / 2, HORIZON);
  roof.addColorStop(0, '#f4f6fa');
  roof.addColorStop(0.45, '#cfd6e2');
  roof.addColorStop(1, '#8e98ab');
  g.fillStyle = roof;
  g.beginPath();
  g.ellipse(DOME.x, HORIZON - 18, DOME.w / 2, DOME.h, 0, Math.PI, 0);
  g.fill();
  g.strokeStyle = 'rgba(120,130,150,0.55)';
  g.lineWidth = 0.6;
  for (let i = 1; i < 14; i++) {
    const t = i / 14;
    const x = DOME.x - DOME.w / 2 + DOME.w * t;
    g.beginPath();
    g.moveTo(DOME.x, top + 2);
    g.quadraticCurveTo(DOME.x + (x - DOME.x) * 0.8, top + DOME.h * 0.2, x, HORIZON - 18);
    g.stroke();
  }
  for (const k of [0.45, 0.75]) {
    g.beginPath();
    g.ellipse(DOME.x, HORIZON - 18, (DOME.w / 2) * Math.sqrt(1 - k * k) + 1, DOME.h * (1 - k), 0, Math.PI, 0);
    g.stroke();
  }
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.beginPath();
  g.ellipse(DOME.x, top + 6, 22, 3, 0, 0, Math.PI * 2);
  g.fill();
  const glass = g.createLinearGradient(0, HORIZON - 18, 0, HORIZON);
  glass.addColorStop(0, '#4f6a8e');
  glass.addColorStop(1, '#2d3f5c');
  g.fillStyle = glass;
  g.fillRect(DOME.x - DOME.w / 2 + 4, HORIZON - 18, DOME.w - 8, 18);
  g.fillStyle = 'rgba(255,220,160,0.5)';
  for (let x = DOME.x - DOME.w / 2 + 8; x < DOME.x + DOME.w / 2 - 6; x += 6) g.fillRect(x, HORIZON - 14, 3, 1.2);
  // 松菸：紅磚菸廠與高煙囪
  g.fillStyle = '#9c4b33';
  g.fillRect(70, 52, 7, HORIZON - 52);
  g.fillStyle = '#7f3a27';
  g.fillRect(68.5, 50, 10, 4);
  for (const [x, w, h] of [[L + 5, 70, 28], [40, 110, 34], [150, 40, 24]] as const) {
    const brick = g.createLinearGradient(0, HORIZON - h, 0, HORIZON);
    brick.addColorStop(0, '#b8603f');
    brick.addColorStop(1, '#93472f');
    g.fillStyle = brick;
    g.fillRect(x, HORIZON - h, w, h);
    g.fillStyle = '#5a5f6a';
    g.beginPath();
    g.moveTo(x - 3, HORIZON - h);
    g.lineTo(x + w / 2, HORIZON - h - 9);
    g.lineTo(x + w + 3, HORIZON - h);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(250,236,200,0.75)';
    for (let wx = x + 4; wx < x + w - 5; wx += 8) g.fillRect(wx, HORIZON - h + 8, 4, 7);
  }
  // 生態池與樹
  const pond = g.createLinearGradient(0, HORIZON, 0, SHORE + 2);
  pond.addColorStop(0, '#a7c4d9');
  pond.addColorStop(1, '#5e86a6');
  g.fillStyle = pond;
  g.fillRect(L, HORIZON, R - L, SHORE + 2 - HORIZON);
  g.save();
  g.globalAlpha = 0.3;
  g.fillStyle = '#e6ebf2';
  g.beginPath();
  g.ellipse(DOME.x, HORIZON + 18, DOME.w / 2, DOME.h * 0.4, 0, 0, Math.PI);
  g.fill();
  g.restore();
  const tr = rng(305);
  for (let i = 0; i < (R - L) * 0.5; i++) {
    const x = L + tr() * (R - L);
    if (x > 230 && x < 370 && tr() < 0.8) continue;
    const y = HORIZON + 2 + tr() * 8;
    g.fillStyle = tr() < 0.5 ? '#4d8a4a' : '#68a35a';
    g.beginPath();
    g.arc(x, y, 3 + tr() * 5, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#6a9a5a';
  g.fillRect(L, SHORE - 4, R - L, 6);
  // 地面：紅磚廣場
  ground(g, L, R, B, '#a8644a', '#c07a5a', '#9a5a42', 307);
  brickLines(g, L, R, B, 'rgba(90,45,30,0.35)');
}

export function drawSongshan(ctx: G, time: number, L: number, R: number) {
  // 陽光掃過巨蛋屋頂的反光
  const t = ((time * 0.00006) % 1.4) - 0.2;
  const x = DOME.x - DOME.w / 2 + DOME.w * t;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(DOME.x, HORIZON - 18, DOME.w / 2, DOME.h, 0, Math.PI, 0);
  ctx.clip();
  const shine = ctx.createLinearGradient(x - 20, 0, x + 20, 0);
  shine.addColorStop(0, 'rgba(255,255,255,0)');
  shine.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  shine.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = shine;
  ctx.fillRect(x - 20, HORIZON - 18 - DOME.h, 40, DOME.h);
  ctx.restore();
  sparkles(ctx, time, L, R, DOME.x, '255,240,220', 30, 0.7);
  birds(ctx, time, L, R, 50, 'rgba(50,50,70,0.7)', 4);
}

// ================================================================== 圓山花博

const TRACK_Y = 136;

export function paintExpo(g: G, L: number, T: number, R: number, B: number) {
  skyGradient(g, L, T, R, [[0, '#2c78d6'], [0.6, '#8ccaf2'], [1, '#eaf6fb']]);
  sunGlow(g, L, T, R, 330, 58, 160, '255,250,230', 0.8);
  // 劍潭山
  ridge(g, L, R, HORIZON + 1, 70, 401, '#5f9a68', 10);
  const tr = rng(402);
  for (let i = 0; i < (R - L) * 1.2; i++) {
    const x = L + tr() * (R - L);
    const y = HORIZON - 6 - Math.pow(tr(), 1.4) * 50;
    g.fillStyle = tr() < 0.4 ? '#467f50' : tr() < 0.7 ? '#58925c' : '#73ab6c';
    g.beginPath();
    g.arc(x, y, 2 + tr() * 3.5, 0, Math.PI * 2);
    g.fill();
  }
  // 圓山大飯店：紅柱、黃色琉璃瓦的宮殿式屋頂（三層）
  const hx = 300;
  const hy = 104;
  g.fillStyle = '#c4362c';
  g.fillRect(hx - 54, hy, 108, 22);
  g.fillStyle = '#f2d7a0';
  for (let i = 0; i < 12; i++) g.fillRect(hx - 50 + i * 9, hy + 4, 4, 6);
  g.fillStyle = '#8f231c';
  for (let i = 0; i < 13; i++) g.fillRect(hx - 52 + i * 8.7, hy + 2, 1.6, 20);
  const roof = (w: number, y: number, h: number) => {
    const grad = g.createLinearGradient(0, y - h, 0, y);
    grad.addColorStop(0, '#f7c64a');
    grad.addColorStop(1, '#d9952a');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(hx - w / 2 - 6, y - 1);
    g.quadraticCurveTo(hx - w / 2, y - 2, hx - w / 2 + 6, y - h);
    g.lineTo(hx + w / 2 - 6, y - h);
    g.quadraticCurveTo(hx + w / 2, y - 2, hx + w / 2 + 6, y - 1);
    g.closePath();
    g.fill();
    g.fillStyle = '#2f6a4a';
    g.fillRect(hx - w / 2 + 4, y - 1, w - 8, 1.4);
  };
  roof(124, hy + 1, 7);
  g.fillStyle = '#c4362c';
  g.fillRect(hx - 30, hy - 14, 60, 9);
  roof(74, hy - 13, 7);
  g.fillStyle = '#c4362c';
  g.fillRect(hx - 12, hy - 26, 24, 7);
  roof(34, hy - 25, 6);
  // 高架捷運軌道
  g.fillStyle = '#c9ccd2';
  g.fillRect(L, TRACK_Y, R - L, 4);
  g.fillStyle = '#a8acb4';
  for (let x = Math.floor(L / 40) * 40; x < R; x += 40) g.fillRect(x, TRACK_Y + 4, 4, HORIZON - TRACK_Y - 3);
  // 花海
  const fl = g.createLinearGradient(0, HORIZON, 0, SHORE + 2);
  fl.addColorStop(0, '#7fb85f');
  fl.addColorStop(1, '#5e9e48');
  g.fillStyle = fl;
  g.fillRect(L, HORIZON, R - L, SHORE + 2 - HORIZON);
  const colors = ['#ff6b8a', '#ffd23f', '#b07cff', '#ff8f3f', '#ffffff', '#ff4d6d'];
  const fr = rng(405);
  for (let row = 0; row < 7; row++) {
    const y = HORIZON + 5 + row * 6.2;
    const c = colors[row % colors.length];
    for (let i = 0; i < (R - L) * (0.5 + row * 0.15); i++) {
      g.fillStyle = fr() < 0.85 ? c : colors[Math.floor(fr() * colors.length)];
      g.beginPath();
      g.arc(L + fr() * (R - L), y + fr() * 4, 0.8 + row * 0.18, 0, Math.PI * 2);
      g.fill();
    }
  }
  // 地面：修剪過的草坪
  ground(g, L, R, B, '#5f9f48', '#6fb256', '#5a9a44', 407);
  g.fillStyle = 'rgba(255,255,255,0.08)';
  for (let x = Math.floor(L / 40) * 40; x < R; x += 40) g.fillRect(x, SHORE, 20, B - SHORE);
}

export function drawExpo(ctx: G, time: number, L: number, R: number) {
  // 捷運列車：每 14 秒駛過一次
  const period = 14000;
  const p = (time % period) / period;
  if (p < 0.55) {
    const len = 120;
    const x = L - len + (R - L + len * 2) * (p / 0.55);
    ctx.fillStyle = '#f4f5f7';
    ctx.beginPath();
    ctx.roundRect(x, TRACK_Y - 8, len, 8, 2);
    ctx.fill();
    ctx.fillStyle = '#d23a3a';
    ctx.fillRect(x, TRACK_Y - 3, len, 1.2);
    ctx.fillStyle = 'rgba(60,90,130,0.85)';
    for (let k = 0; k < 6; k++) {
      for (let w = 0; w < 3; w++) ctx.fillRect(x + k * 20 + 3 + w * 5, TRACK_Y - 7, 3.5, 3);
    }
  }
  // 蝴蝶
  for (let i = 0; i < 5; i++) {
    const span = R - L;
    const x = L + ((((i * 97 + time * 0.01) % span) + span) % span);
    const y = 168 + Math.sin(time * 0.0015 + i * 1.7) * 10;
    const flap = Math.abs(Math.sin(time * 0.02 + i));
    ctx.fillStyle = ['#ffd23f', '#ffffff', '#ff8fb0', '#a7d8ff', '#ffb347'][i];
    ctx.beginPath();
    ctx.ellipse(x - 1.2, y, 1.4 * flap + 0.3, 1.2, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 1.2, y, 1.4 * flap + 0.3, 1.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  birds(ctx, time, L, R, 30, 'rgba(40,50,70,0.7)', 3);
}

// ================================================================== 陽明山溫泉

const VENTS = [{ x: 330, y: 98 }, { x: 352, y: 104 }, { x: 315, y: 108 }];
const POOL = { x: 60, y: 178, w: 70 };

export function paintYangming(g: G, L: number, T: number, R: number, B: number) {
  skyGradient(g, L, T, R, [[0, '#4b6ea8'], [0.5, '#a8bfd8'], [0.85, '#efd9c4'], [1, '#f6e2c8']]);
  sunGlow(g, L, T, R, 90, 80, 170, '255,230,190', 0.6);
  // 七星山（圓錐形主峰）與周圍群山
  ridge(g, L, R, HORIZON + 1, 46, 501, '#8aa3a8', 8);
  const peak = g.createLinearGradient(0, 40, 0, HORIZON);
  peak.addColorStop(0, '#6f8f6c');
  peak.addColorStop(1, '#5a7a58');
  g.fillStyle = peak;
  g.beginPath();
  g.moveTo(180, HORIZON);
  g.quadraticCurveTo(300, 30, 420, HORIZON);
  g.closePath();
  g.fill();
  // 硫磺噴氣區：山坡上一片黃白色裸露地
  const sf = rng(502);
  for (let i = 0; i < 22; i++) {
    const x = 312 + sf() * 48;
    const y = 96 + sf() * 16 + (x - 312) * 0.08;
    g.fillStyle = sf() < 0.6 ? `rgba(226,214,150,${0.35 + sf() * 0.3})` : `rgba(245,240,215,${0.3 + sf() * 0.3})`;
    g.beginPath();
    g.ellipse(x, y, 2 + sf() * 5, 1 + sf() * 2, -0.3 + sf() * 0.6, 0, Math.PI * 2);
    g.fill();
  }
  ridge(g, L, R, HORIZON + 1, 22, 503, '#4f6e4c', 40);
  // 山谷雲霧
  for (const [y, a] of [[132, 0.55], [142, 0.4]] as const) {
    const fog = g.createLinearGradient(0, y - 8, 0, y + 8);
    fog.addColorStop(0, 'rgba(255,255,255,0)');
    fog.addColorStop(0.5, `rgba(255,255,255,${a})`);
    fog.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = fog;
    g.fillRect(L, y - 8, R - L, 16);
  }
  // 芒草原（底色，搖曳的花穗每幀再畫）
  const grass = g.createLinearGradient(0, HORIZON, 0, SHORE + 2);
  grass.addColorStop(0, '#b9a77a');
  grass.addColorStop(1, '#8f8256');
  g.fillStyle = grass;
  g.fillRect(L, HORIZON, R - L, SHORE + 2 - HORIZON);
  // 溫泉池：石頭圍起的乳白色溫泉
  const pool = g.createRadialGradient(POOL.x, POOL.y, 2, POOL.x, POOL.y, POOL.w / 2);
  pool.addColorStop(0, '#dfeee8');
  pool.addColorStop(1, '#a9cfc4');
  g.fillStyle = pool;
  g.beginPath();
  g.ellipse(POOL.x, POOL.y, POOL.w / 2, 9, 0, 0, Math.PI * 2);
  g.fill();
  const st = rng(505);
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    g.fillStyle = st() < 0.5 ? '#6d6a66' : '#86827c';
    g.beginPath();
    g.ellipse(POOL.x + Math.cos(a) * (POOL.w / 2 + 2), POOL.y + Math.sin(a) * 10.5, 3.6, 2.4, 0, 0, Math.PI * 2);
    g.fill();
  }
  // 地面：木棧道
  ground(g, L, R, B, '#7a5a3e', '#9a7250', '#7d5a3c', 507);
  planks(g, L, R, B, 'rgba(60,40,25,0.45)');
}

function steam(ctx: G, time: number, x: number, y: number, scale: number, seed: number) {
  for (let k = 0; k < 6; k++) {
    const life = 4200;
    const tt = (time + seed * 777 + k * (life / 6)) % life;
    const p = tt / life;
    const px = x + Math.sin(p * 3 + seed + k) * 4 * scale + p * 10 * scale;
    const py = y - p * 40 * scale;
    const r = (3 + p * 12) * scale;
    const a = 0.6 * (1 - p) * Math.min(1, p * 5);
    const g = ctx.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(px - r, py - r, r * 2, r * 2);
  }
}

export function drawYangming(ctx: G, time: number, L: number, R: number) {
  for (const [i, v] of VENTS.entries()) steam(ctx, time, v.x, v.y, 0.8, i);
  for (let i = 0; i < 3; i++) steam(ctx, time, POOL.x - 20 + i * 20, POOL.y - 3, 0.9, i + 5);
  // 搖曳的芒草花穗
  for (let i = 0; i < (R - L) / 3; i++) {
    const x = L + ((i * 37.3) % (R - L));
    const baseY = HORIZON + 6 + ((i * 13) % (SHORE - HORIZON - 8));
    if (Math.abs(x - POOL.x) < POOL.w / 2 + 4 && Math.abs(baseY - POOL.y) < 14) continue;
    const h = 7 + ((i * 7) % 6) + (baseY - HORIZON) * 0.15;
    const sway = Math.sin(time * 0.0018 + x * 0.04) * 3;
    ctx.strokeStyle = 'rgba(120,110,70,0.7)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.quadraticCurveTo(x + sway * 0.3, baseY - h * 0.6, x + sway, baseY - h);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(245,235,215,0.85)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x + sway, baseY - h);
    ctx.quadraticCurveTo(x + sway * 1.4 + 2, baseY - h - 2, x + sway * 1.6 + 4, baseY - h + 1);
    ctx.stroke();
  }
  // 緩緩飄過的霧
  ctx.save();
  ctx.globalAlpha = 0.25;
  for (let i = 0; i < 3; i++) {
    const span = R - L + 200;
    const x = L - 100 + ((((i * 210 + time * 0.006) % span) + span) % span);
    const g = ctx.createRadialGradient(x, 120 + i * 8, 0, x, 120 + i * 8, 70);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 70, 50 + i * 8, 140, 140);
  }
  ctx.restore();
}

// ================================================================== 淡水夕陽

const TS_SUN = { x: 250, y: 140 };

export function paintTamsui(g: G, L: number, T: number, R: number, B: number) {
  skyGradient(g, L, T, R, [[0, '#2b2f6e'], [0.35, '#7a4c86'], [0.62, '#e0736a'], [0.85, '#ffb35c'], [1, '#ffe08a']]);
  sunGlow(g, L, T, R, TS_SUN.x, TS_SUN.y, 200, '255,200,120', 0.85);
  // 落日：下緣沒入河口
  g.fillStyle = '#fff1b8';
  g.beginPath();
  g.arc(TS_SUN.x, TS_SUN.y, 14, Math.PI, 0);
  g.fill();
  g.fillStyle = 'rgba(255,190,90,0.6)';
  g.fillRect(TS_SUN.x - 14, TS_SUN.y, 28, HORIZON - TS_SUN.y);
  // 觀音山：橫臥的剪影，從左側一路延伸
  const mt = g.createLinearGradient(0, 90, 0, HORIZON);
  mt.addColorStop(0, '#4a3a6a');
  mt.addColorStop(1, '#6a4a74');
  g.fillStyle = mt;
  g.beginPath();
  g.moveTo(L, HORIZON + 1);
  const prof: [number, number][] = [[L, 132], [-10, 120], [20, 104], [44, 96], [62, 100], [80, 92], [100, 98], [118, 108], [140, 112], [168, 126], [196, 140], [220, HORIZON + 1]];
  for (const [x, y] of prof) g.lineTo(x, y);
  g.closePath();
  g.fill();
  // 對岸八里的燈火
  const lr = rng(601);
  for (let i = 0; i < 30; i++) {
    g.fillStyle = `rgba(255,214,140,${0.4 + lr() * 0.5})`;
    g.fillRect(L + lr() * (210 - L), HORIZON - 1 - lr() * 3, 0.9, 0.9);
  }
  // 河面：金色的夕照
  const water = g.createLinearGradient(0, HORIZON, 0, SHORE + 2);
  water.addColorStop(0, '#f2a25e');
  water.addColorStop(0.35, '#b8607a');
  water.addColorStop(1, '#4a3a6e');
  g.fillStyle = water;
  g.fillRect(L, HORIZON, R - L, SHORE + 2 - HORIZON);
  const refl = g.createLinearGradient(TS_SUN.x - 30, 0, TS_SUN.x + 30, 0);
  refl.addColorStop(0, 'rgba(255,220,140,0)');
  refl.addColorStop(0.5, 'rgba(255,230,160,0.65)');
  refl.addColorStop(1, 'rgba(255,220,140,0)');
  g.fillStyle = refl;
  g.fillRect(TS_SUN.x - 30, HORIZON, 60, SHORE - HORIZON);
  // 情人橋：單一斜塔＋扇形斜張索的白色橋
  const deckY = 172;
  g.strokeStyle = '#f4ece6';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(300, deckY + 4);
  g.quadraticCurveTo(370, deckY - 8, 445, deckY + 4);
  g.stroke();
  g.lineWidth = 2.6;
  g.beginPath();
  g.moveTo(360, deckY - 2);
  g.lineTo(386, 104);
  g.stroke();
  g.lineWidth = 0.5;
  g.strokeStyle = 'rgba(250,240,235,0.85)';
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const tx = 360 + 26 * (0.45 + t * 0.55);
    const ty = deckY - 2 - (deckY - 2 - 104) * (0.45 + t * 0.55);
    for (const dx of [-1, 1]) {
      const x = 372 + dx * (12 + i * 8);
      const y = deckY - 4 + Math.abs(x - 372) * 0.06;
      g.beginPath();
      g.moveTo(tx, ty);
      g.lineTo(x, y);
      g.stroke();
    }
  }
  // 地面：河岸木棧道（被夕陽染成橘色）
  ground(g, L, R, B, '#8a5a3e', '#b07850', '#7f5238', 607);
  planks(g, L, R, B, 'rgba(70,40,25,0.4)');
  g.fillStyle = 'rgba(60,35,25,0.7)';
  g.fillRect(L, SHORE, R - L, 2);
  for (let x = Math.floor(L / 16) * 16; x < R; x += 16) g.fillRect(x, SHORE - 7, 1.5, 7);
  g.fillRect(L, SHORE - 7, R - L, 1);
}

export function drawTamsui(ctx: G, time: number, L: number, R: number) {
  sparkles(ctx, time, L, R, TS_SUN.x, '255,230,170', 60, 0.9);
  // 漁船剪影隨波起伏、緩緩移動
  for (let i = 0; i < 3; i++) {
    const span = R - L + 60;
    const x = L - 30 + ((((i * 170 + time * 0.004 * (i % 2 ? 1 : -1)) % span) + span) % span);
    const y = 160 + i * 9 + Math.sin(time * 0.002 + i * 2) * 0.8;
    const s = 0.7 + i * 0.25;
    ctx.fillStyle = 'rgba(40,25,45,0.85)';
    ctx.beginPath();
    ctx.moveTo(x - 9 * s, y);
    ctx.lineTo(x + 9 * s, y);
    ctx.lineTo(x + 6 * s, y + 3 * s);
    ctx.lineTo(x - 7 * s, y + 3 * s);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(x - 2 * s, y - 4 * s, 5 * s, 4 * s);
    ctx.fillRect(x + 0.5 * s, y - 10 * s, 0.8, 6 * s);
  }
  birds(ctx, time, L, R, 70, 'rgba(255,245,235,0.85)', 4);
}
