// 金門與武陵場景（原創繪製，取地方特色，不使用任何標誌）：
// - kinmen 金門：晴空下的海岸、紅磚燕尾脊的閩南古厝、石雕風獅爺、隨風搖曳的高粱田，遠方的小島。
//   歐亞水獺（獺獺）的主場。
// - wuling 武陵：雪山山脈與臺灣冷杉林、粉色山櫻、七家灣溪的清澈溪流，偶爾有櫻花鉤吻鮭躍出水面，
//   花瓣隨風飄落。櫻花鉤吻鮭（櫻櫻）、黑熊、帝雉、熊鷹的主場。
import { HORIZON, SHORE, rng, ridge } from './scenery';
import { birds, brickLines, ground, skyGradient, sparkles, sunGlow } from './landmarks';

type G = CanvasRenderingContext2D;

// ================================================================== 金門

const LION = { x: 372, y: SHORE - 2 };

/** 一棟閩南古厝：紅磚牆、白色石基、燕尾翹起的屋脊 */
function house(g: G, x: number, base: number, w: number, h: number, shade: number) {
  const wall = shade ? '#b9553c' : '#c8644a';
  // 石基
  g.fillStyle = '#d9d2c4';
  g.fillRect(x, base - 3, w, 3);
  // 紅磚牆與磚縫
  g.fillStyle = wall;
  g.fillRect(x, base - 3 - h, w, h);
  g.strokeStyle = 'rgba(120,40,30,0.35)';
  g.lineWidth = 0.4;
  for (let y = base - 3 - h + 2; y < base - 3; y += 2.2) {
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + w, y);
    g.stroke();
  }
  // 門與窗
  g.fillStyle = '#5a2e22';
  g.fillRect(x + w / 2 - 2.5, base - 3 - h * 0.62, 5, h * 0.62);
  g.fillStyle = '#e8d8b0';
  for (const dx of [w * 0.2, w * 0.8]) g.fillRect(x + dx - 2, base - 3 - h * 0.7, 4, 3);
  // 屋頂：紅瓦斜面＋兩端往上翹的燕尾
  const top = base - 3 - h;
  const roofH = h * 0.45;
  g.fillStyle = '#a8402e';
  g.beginPath();
  g.moveTo(x - 3, top);
  g.lineTo(x + w + 3, top);
  g.lineTo(x + w - 2, top - roofH);
  g.lineTo(x + 2, top - roofH);
  g.closePath();
  g.fill();
  g.strokeStyle = '#7a2a20';
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(x - 4, top - roofH - 6);
  g.quadraticCurveTo(x + 4, top - roofH + 1, x + w / 2, top - roofH);
  g.quadraticCurveTo(x + w - 4, top - roofH + 1, x + w + 4, top - roofH - 6);
  g.stroke();
}

/** 風獅爺：站著的石雕獅子，披著紅披風 */
function windLion(g: G, x: number, y: number) {
  const stone = '#c8bca6', dark = '#8a7e6a';
  g.fillStyle = '#9a9080';
  g.fillRect(x - 9, y - 6, 18, 6);
  g.fillStyle = stone;
  g.beginPath();
  g.ellipse(x, y - 17, 7, 11, 0, 0, Math.PI * 2);
  g.fill();
  // 頭與鬃毛
  g.fillStyle = dark;
  g.beginPath();
  g.arc(x, y - 33, 8.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = stone;
  g.beginPath();
  g.arc(x, y - 33, 6, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#3a3428';
  g.fillRect(x - 3, y - 35, 1.6, 1.6);
  g.fillRect(x + 1.6, y - 35, 1.6, 1.6);
  g.fillStyle = '#7a4a3a';
  g.fillRect(x - 2.5, y - 30.5, 5, 1.4);
  // 紅披風
  g.fillStyle = '#c8302a';
  g.beginPath();
  g.moveTo(x - 6, y - 26);
  g.lineTo(x + 6, y - 26);
  g.lineTo(x + 8, y - 14);
  g.lineTo(x - 8, y - 14);
  g.closePath();
  g.fill();
}

export function paintKinmen(g: G, L: number, T: number, R: number, B: number) {
  skyGradient(g, L, T, R, [[0, '#2f6fc0'], [0.55, '#8ec0ea'], [0.9, '#e6f0f4'], [1, '#f4efe0']]);
  sunGlow(g, L, T, R, 90, 46, 160, '255,244,210', 0.75);
  // 遠方的小島與海
  ridge(g, L, R, HORIZON - 6, 10, 701, 'rgba(110,140,160,0.55)', 0);
  const sea = g.createLinearGradient(0, HORIZON - 8, 0, HORIZON + 22);
  sea.addColorStop(0, '#5aa0c8');
  sea.addColorStop(1, '#3a7aa8');
  g.fillStyle = sea;
  g.fillRect(L, HORIZON - 8, R - L, 30);
  // 花崗岩海岸
  const rk = rng(702);
  for (let i = 0; i < 18; i++) {
    const x = L + rk() * (R - L);
    g.fillStyle = rk() < 0.5 ? '#b8ae9e' : '#9e9484';
    g.beginPath();
    g.ellipse(x, HORIZON + 18 + rk() * 4, 6 + rk() * 10, 3 + rk() * 3, 0, 0, Math.PI * 2);
    g.fill();
  }
  // 高粱田（底色，穗每幀再畫）
  const field = g.createLinearGradient(0, HORIZON + 16, 0, SHORE + 2);
  field.addColorStop(0, '#9a8a3a');
  field.addColorStop(1, '#7a6a2a');
  g.fillStyle = field;
  g.fillRect(L, HORIZON + 18, R - L, SHORE + 2 - HORIZON - 18);
  // 古厝聚落
  house(g, 18, HORIZON + 26, 54, 20, 0);
  house(g, 84, HORIZON + 22, 40, 16, 1);
  house(g, 132, HORIZON + 24, 34, 14, 0);
  // 地面：紅磚埕
  ground(g, L, R, B, '#b86a50', '#c87a5c', '#a85a40', 707);
  brickLines(g, L, R, B, 'rgba(110,40,30,0.35)');
  windLion(g, LION.x, LION.y);
}

export function drawKinmen(ctx: G, time: number, L: number, R: number) {
  sparkles(ctx, time, L, R, 300, '255,255,240', 30, 0.7);
  // 隨風搖曳的高粱穗
  for (let i = 0; i < (R - L) / 2.6; i++) {
    const x = L + ((i * 29.7) % (R - L));
    if (x > 10 && x < 175 && i % 3) continue; // 古厝前少一點
    if (Math.abs(x - LION.x) < 14) continue;
    const baseY = HORIZON + 24 + ((i * 11) % (SHORE - HORIZON - 26));
    const h = 8 + ((i * 7) % 5) + (baseY - HORIZON) * 0.12;
    const sway = Math.sin(time * 0.0016 + x * 0.05) * 2.4;
    ctx.strokeStyle = 'rgba(110,120,50,0.8)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.quadraticCurveTo(x + sway * 0.4, baseY - h * 0.6, x + sway, baseY - h);
    ctx.stroke();
    ctx.fillStyle = i % 4 ? '#a8402a' : '#c8602e';
    ctx.beginPath();
    ctx.ellipse(x + sway, baseY - h - 1.6, 1.4, 2.6, sway * 0.08, 0, Math.PI * 2);
    ctx.fill();
  }
  birds(ctx, time, L, R, 40, 'rgba(50,60,80,0.7)', 4);
}

// ================================================================== 武陵

const STREAM_Y = 172;

export function paintWuling(g: G, L: number, T: number, R: number, B: number) {
  skyGradient(g, L, T, R, [[0, '#3a6ab0'], [0.5, '#9cc0e4'], [0.88, '#e8eef2'], [1, '#f0ece4']]);
  sunGlow(g, L, T, R, 330, 50, 150, '255,248,225', 0.6);
  // 雪山山脈：遠山＋白色山頂
  const far = g.createLinearGradient(0, 30, 0, HORIZON);
  far.addColorStop(0, '#7a8ab0');
  far.addColorStop(1, '#9aaac4');
  g.fillStyle = far;
  g.beginPath();
  g.moveTo(L, HORIZON);
  const peaks: [number, number][] = [[L, 104], [40, 88], [96, 52], [140, 74], [190, 60], [250, 92], [300, 70], [360, 96], [R, 84]];
  for (const [x, y] of peaks) g.lineTo(x, y);
  g.lineTo(R, HORIZON);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(250,252,255,0.9)';
  for (const [x, y] of [[96, 52], [190, 60], [300, 70]]) {
    g.beginPath();
    g.moveTo(x - 12, y + 10);
    g.lineTo(x, y);
    g.lineTo(x + 13, y + 11);
    g.lineTo(x + 5, y + 8);
    g.lineTo(x - 2, y + 12);
    g.closePath();
    g.fill();
  }
  ridge(g, L, R, HORIZON + 2, 30, 801, '#4f7a5c', 6);
  // 山腳到草地之間先鋪滿，避免上一個場景的畫面透出來
  g.fillStyle = '#4f7a5c';
  g.fillRect(L, HORIZON, R - L, SHORE + 2 - HORIZON);
  // 臺灣冷杉：一排深綠色的尖塔形樹
  const tr = rng(802);
  for (let i = 0; i < 46; i++) {
    const x = L + tr() * (R - L);
    const base = HORIZON + 4 + tr() * 6;
    const h = 14 + tr() * 16;
    g.fillStyle = tr() < 0.5 ? '#2f5a44' : '#3a6a4e';
    g.beginPath();
    g.moveTo(x, base - h);
    g.lineTo(x + h * 0.22, base);
    g.lineTo(x - h * 0.22, base);
    g.closePath();
    g.fill();
  }
  // 山櫻：粉紅色的花團
  const sk = rng(803);
  for (let i = 0; i < 14; i++) {
    const x = L + sk() * (R - L);
    const y = HORIZON + 4 + sk() * 12;
    g.fillStyle = '#5a3a2e';
    g.fillRect(x - 0.8, y, 1.6, 8);
    for (let k = 0; k < 6; k++) {
      g.fillStyle = sk() < 0.5 ? '#f4b4c8' : '#f8cede';
      g.beginPath();
      g.arc(x + (sk() - 0.5) * 12, y - sk() * 7, 3 + sk() * 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  // 草地與溪流
  const grass = g.createLinearGradient(0, HORIZON + 12, 0, SHORE + 2);
  grass.addColorStop(0, '#7aa05a');
  grass.addColorStop(1, '#5a8a48');
  g.fillStyle = grass;
  g.fillRect(L, HORIZON + 14, R - L, SHORE + 2 - HORIZON - 14);
  const water = g.createLinearGradient(0, STREAM_Y - 8, 0, STREAM_Y + 8);
  water.addColorStop(0, '#9ad0e0');
  water.addColorStop(1, '#5aa0c0');
  g.fillStyle = water;
  g.beginPath();
  g.moveTo(L, STREAM_Y - 4);
  for (let x = L; x <= R + 4; x += 8) g.lineTo(x, STREAM_Y - 5 + Math.sin(x * 0.03) * 2);
  for (let x = R + 4; x >= L; x -= 8) g.lineTo(x, STREAM_Y + 6 + Math.sin(x * 0.025 + 1) * 2);
  g.closePath();
  g.fill();
  // 溪邊的石頭
  const st = rng(804);
  for (let i = 0; i < 20; i++) {
    g.fillStyle = st() < 0.5 ? '#a8a49a' : '#8a867c';
    g.beginPath();
    g.ellipse(L + st() * (R - L), STREAM_Y + (st() < 0.5 ? -6 : 7), 2.5 + st() * 4, 1.6 + st() * 1.6, 0, 0, Math.PI * 2);
    g.fill();
  }
  // 地面：木棧道步道
  ground(g, L, R, B, '#7a5a3e', '#93704e', '#77573a', 807);
}

export function drawWuling(ctx: G, time: number, L: number, R: number) {
  // 溪面波光
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 40; i++) {
    const x = L + ((i * 47.3) % (R - L));
    const a = Math.sin(time * 0.003 + i * 1.7);
    if (a < 0.3) continue;
    ctx.fillStyle = `rgba(255,255,255,${(a - 0.3) * 0.7})`;
    ctx.fillRect(x, STREAM_Y - 3 + ((i * 5) % 8), 3, 0.6);
  }
  ctx.restore();
  // 偶爾躍出水面的櫻花鉤吻鮭
  const period = 5200;
  for (let k = 0; k < 2; k++) {
    const tt = (time + k * 2600) % period;
    if (tt > 900) continue;
    const p = tt / 900;
    const x0 = 120 + k * 150 + Math.floor((time + k * 2600) / period) % 3 * 30;
    const x = x0 + p * 22;
    const y = STREAM_Y - Math.sin(p * Math.PI) * 16;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-Math.cos(p * Math.PI) * 0.8);
    ctx.fillStyle = '#7a8a62';
    ctx.beginPath();
    ctx.ellipse(0, 0, 5, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e89aa8';
    ctx.fillRect(-3.5, -0.3, 7, 0.8);
    ctx.fillStyle = '#7a8a62';
    ctx.beginPath();
    ctx.moveTo(-4.5, 0);
    ctx.lineTo(-7.5, -2);
    ctx.lineTo(-7.5, 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    if (p > 0.85) {
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.ellipse(x, STREAM_Y, 4 + (p - 0.85) * 40, 1.4, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // 飄落的櫻花瓣
  for (let i = 0; i < 28; i++) {
    const span = R - L + 40;
    const fall = 200 + (i % 5) * 30;
    const tt = (time * 0.02 + i * 37) % fall;
    const x = L - 20 + ((((i * 53 + time * 0.01 + Math.sin(time * 0.001 + i) * 8) % span) + span) % span);
    const y = -10 + tt;
    if (y > SHORE) continue;
    ctx.fillStyle = i % 3 ? 'rgba(248,190,210,0.9)' : 'rgba(255,220,232,0.9)';
    ctx.beginPath();
    ctx.ellipse(x, y, 1.6, 0.9, time * 0.002 + i, 0, Math.PI * 2);
    ctx.fill();
  }
  birds(ctx, time, L, R, 36, 'rgba(40,50,70,0.6)', 2);
}
