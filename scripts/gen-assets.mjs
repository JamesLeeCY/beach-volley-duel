// 產生內建角色的像素精靈圖、頭像、manifest 與 PWA 圖示。
// 全部由程式繪製（原創），執行：npm run gen:assets
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const F = 64; // frame size

// ---------- PNG 編碼 ----------
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(img) {
  const { w, h, px } = img;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- 點陣繪圖 ----------
function newImg(w, h) {
  return { w, h, px: Buffer.alloc(w * h * 4) };
}
function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}
function set(img, x, y, col) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
  const i = (y * img.w + x) * 4;
  img.px[i] = col[0]; img.px[i + 1] = col[1]; img.px[i + 2] = col[2]; img.px[i + 3] = col[3];
}
function get(img, x, y) {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return [0, 0, 0, 0];
  const i = (y * img.w + x) * 4;
  return [img.px[i], img.px[i + 1], img.px[i + 2], img.px[i + 3]];
}
function ellipse(img, cx, cy, rx, ry, c) {
  const col = hex(c);
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) set(img, x, y, col);
    }
}
function poly(img, pts, c) {
  const col = hex(c);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++)
    for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
      const px = x + 0.5, py = y + 0.5;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) set(img, x, y, col);
    }
}
function line(img, x0, y0, x1, y1, c) {
  const col = hex(c);
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) set(img, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, col);
}
/** 外框：透明像素若鄰接不透明像素就塗上外框色 */
function outline(img, c) {
  const col = hex(c);
  const src = Buffer.from(img.px);
  const alpha = (x, y) => (x < 0 || y < 0 || x >= img.w || y >= img.h ? 0 : src[(y * img.w + x) * 4 + 3]);
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++)
      if (!alpha(x, y) && (alpha(x - 1, y) || alpha(x + 1, y) || alpha(x, y - 1) || alpha(x, y + 1))) set(img, x, y, col);
}
/** 繞 (ox, oy) 旋轉 deg 度並平移，最近鄰取樣 */
function rotate(img, deg, ox, oy, tx = 0, ty = 0) {
  const out = newImg(img.w, img.h);
  const r = (deg * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const dx = x + 0.5 - ox - tx, dy = y + 0.5 - oy - ty;
      const sx = Math.floor(cos * dx + sin * dy + ox), sy = Math.floor(-sin * dx + cos * dy + oy);
      const p = get(img, sx, sy);
      if (p[3]) set(out, x, y, p);
    }
  return out;
}
function blit(dst, src, dx, dy, scale = 1) {
  for (let y = 0; y < src.h * scale; y++)
    for (let x = 0; x < src.w * scale; x++) {
      const p = get(src, Math.floor(x / scale), Math.floor(y / scale));
      if (p[3]) set(dst, dx + x, dy + y, p);
    }
}

// ---------- 角色 ----------
// pose: bob（上下位移）、sx/sy（壓扁拉長）、arm（手的位置，相對身體中心）、legs（腳步相位）、eyes、rot（旋轉角度）
function eye(img, x, y, kind) {
  if (kind === 'happy') {
    line(img, x - 2, y + 1, x, y - 1, '#2a1d1a');
    line(img, x, y - 1, x + 2, y + 1, '#2a1d1a');
  } else if (kind === 'sad') {
    line(img, x - 2, y - 1, x + 2, y + 1, '#2a1d1a');
    set(img, x, y + 2, hex('#7fc3ff'));
  } else if (kind === 'focus') {
    ellipse(img, x, y, 2, 2.5, '#2a1d1a');
    line(img, x - 3, y - 4, x + 2, y - 3, '#2a1d1a');
  } else {
    ellipse(img, x, y, 2.2, 2.8, '#2a1d1a');
    set(img, x + 0.6, y - 1.2, hex('#ffffff'));
  }
}

const CHARS = {
  momo: {
    name: { 'zh-TW': '桃桃', en: 'Momo' },
    stats: { speed: 0, jump: 0, power: 0 },
    themeColor: '#F29B38',
    outline: '#5a2e0c',
    draw(img, p) {
      const cx = 31 + p.dx, cy = 42 + p.bob;
      const body = '#F29B38', dark = '#D97A1E', belly = '#FBE3B8';
      // 腳
      ellipse(img, cx - 9 + p.legs, 60 + Math.min(p.bob, 0) * 0.3, 6, 3, dark);
      ellipse(img, cx + 9 - p.legs, 60 + Math.min(p.bob, 0) * 0.3, 6, 3, dark);
      // 耳朵
      ellipse(img, cx - 12 * p.sx, cy - 19 * p.sy, 5.5, 5.5, body);
      ellipse(img, cx - 12 * p.sx, cy - 19 * p.sy, 3, 3, '#F7A8B8');
      ellipse(img, cx + 9 * p.sx, cy - 21 * p.sy, 5.5, 5.5, body);
      ellipse(img, cx + 9 * p.sx, cy - 21 * p.sy, 3, 3, '#F7A8B8');
      // 身體
      ellipse(img, cx, cy, 23 * p.sx, 21 * p.sy, body);
      ellipse(img, cx + 4, cy + 6 * p.sy, 14 * p.sx, 12 * p.sy, belly);
      // 臉
      eye(img, cx + 9, cy - 7 * p.sy, p.eyes);
      eye(img, cx + 18, cy - 8 * p.sy, p.eyes);
      ellipse(img, cx + 6, cy - 1 * p.sy, 3, 2, '#F57F9A');
      ellipse(img, cx + 21, cy - 2 * p.sy, 2.5, 2, '#F57F9A');
      ellipse(img, cx + 15, cy - 3 * p.sy, 1.5, 1.2, '#8a3b2a');
      // 手
      ellipse(img, cx + p.arm[0], cy + p.arm[1], 4.5, 4.5, dark);
      ellipse(img, cx + p.arm2[0], cy + p.arm2[1], 4, 4, dark);
    },
  },
  yunyun: {
    name: { 'zh-TW': '雲雲', en: 'Yunyun' },
    stats: { speed: -1, jump: 2, power: -1 },
    themeColor: '#9FD3F5',
    outline: '#3b5f86',
    draw(img, p) {
      const cx = 32 + p.dx, cy = 42 + p.bob;
      const body = '#BFE3F7', shade = '#93C6EA', pink = '#F6B6D2';
      // 小腳（雲朵）
      ellipse(img, cx - 9 + p.legs, 60, 5, 3, shade);
      ellipse(img, cx + 9 - p.legs, 60, 5, 3, shade);
      // 雲朵身體
      const s = (x, y, r) => ellipse(img, cx + x * p.sx, cy + y * p.sy, r * p.sx, r * p.sy, body);
      s(-13, 4, 11); s(13, 4, 11); s(-6, -9, 12); s(7, -11, 13); s(0, 6, 15); s(-15, -2, 8); s(17, -3, 8);
      // 頭頂小捲
      ellipse(img, cx + 4 * p.sx, cy - 23 * p.sy, 3, 3, pink);
      // 臉
      eye(img, cx + 6, cy - 3 * p.sy, p.eyes);
      eye(img, cx + 16, cy - 4 * p.sy, p.eyes);
      ellipse(img, cx + 3, cy + 3 * p.sy, 3, 2, pink);
      ellipse(img, cx + 20, cy + 2 * p.sy, 2.5, 2, pink);
      line(img, cx + 10, cy + 3 * p.sy, cx + 12, cy + 4 * p.sy, '#3b5f86');
      // 手
      ellipse(img, cx + p.arm[0], cy + p.arm[1], 4.5, 4, shade);
      ellipse(img, cx + p.arm2[0], cy + p.arm2[1], 4, 3.5, shade);
    },
  },
  kit: {
    name: { 'zh-TW': '小葉', en: 'Kit' },
    stats: { speed: 2, jump: -1, power: -1 },
    themeColor: '#5DBB63',
    outline: '#3a1f12',
    draw(img, p) {
      const cx = 30 + p.dx, cy = 44 + p.bob;
      const fur = '#E2683A', dark = '#B8482090', white = '#FFF4E6', leaf = '#5DBB63', vein = '#2F7D3A';
      const darkC = '#B84820';
      // 葉子尾巴（在身後＝左側）
      const tw = p.tail;
      poly(img, [[cx - 8, cy + 4], [cx - 22, cy - 6 + tw], [cx - 28, cy - 20 + tw], [cx - 16, cy - 14 + tw], [cx - 6, cy - 2]], leaf);
      line(img, cx - 8, cy + 2, cx - 25, cy - 17 + tw, vein);
      // 腳
      ellipse(img, cx - 7 + p.legs, 60, 4.5, 3, darkC);
      ellipse(img, cx + 8 - p.legs, 60, 4.5, 3, darkC);
      // 身體
      ellipse(img, cx, cy + 4 * p.sy, 14 * p.sx, 13 * p.sy, fur);
      ellipse(img, cx + 3, cy + 7 * p.sy, 8 * p.sx, 8 * p.sy, white);
      // 頭與耳朵
      const hx = cx + 5, hy = cy - 14 * p.sy;
      poly(img, [[hx - 12, hy - 6], [hx - 10, hy - 22], [hx - 2, hy - 10]], fur);
      poly(img, [[hx + 2, hy - 10], [hx + 9, hy - 23], [hx + 12, hy - 6]], fur);
      poly(img, [[hx - 10, hy - 9], [hx - 9, hy - 18], [hx - 5, hy - 11]], '#3a1f12');
      poly(img, [[hx + 5, hy - 11], [hx + 9, hy - 19], [hx + 10, hy - 9]], '#3a1f12');
      ellipse(img, hx, hy, 14, 12, fur);
      // 吻部
      ellipse(img, hx + 9, hy + 4, 8, 5.5, white);
      ellipse(img, hx + 16, hy + 2, 2, 1.6, '#2a1d1a');
      eye(img, hx + 1, hy - 3, p.eyes);
      eye(img, hx + 10, hy - 4, p.eyes);
      ellipse(img, hx - 3, hy + 4, 2.5, 1.8, '#F57F9A');
      // 手
      ellipse(img, cx + p.arm[0], cy + p.arm[1], 4, 4, darkC);
      ellipse(img, cx + p.arm2[0], cy + p.arm2[1], 3.5, 3.5, darkC);
      void dark;
    },
  },
};

const base = { bob: 0, dx: 0, sx: 1, sy: 1, arm: [14, 4], arm2: [-14, 6], legs: 0, eyes: 'open', rot: 0, tail: 0 };
const ROWS = [
  // 0 idle / run
  [0, 1, 2, 1, 0].map((b, i) => ({ ...base, bob: b, legs: [0, 3, 0, -3, 0][i], arm: [14, 4 + b], arm2: [-14, 6 - b], tail: [0, 2, 3, 2, 0][i] })),
  // 1 jump
  [
    { ...base, bob: 3, sx: 1.08, sy: 0.92, arm: [14, 8], arm2: [-14, 8] },
    { ...base, bob: -2, sx: 0.94, sy: 1.06, arm: [12, -14], arm2: [-12, -12], tail: -3 },
    { ...base, bob: -3, sx: 0.92, sy: 1.08, arm: [10, -22], arm2: [-10, -20], tail: -4 },
    { ...base, bob: -2, arm: [16, -10], arm2: [-16, -8], tail: -2 },
    { ...base, bob: 0, arm: [18, 0], arm2: [-18, 2] },
  ],
  // 2 spike（揮臂）
  [
    { ...base, eyes: 'focus', arm: [-6, -26], arm2: [-16, -6], sx: 0.96, sy: 1.04, tail: -4 },
    { ...base, eyes: 'focus', arm: [4, -28], arm2: [-16, -4], tail: -3 },
    { ...base, eyes: 'focus', arm: [16, -22], arm2: [-14, 0], dx: 1 },
    { ...base, eyes: 'focus', arm: [24, -8], arm2: [-12, 4], dx: 2, sx: 1.04, sy: 0.96, tail: 2 },
    { ...base, eyes: 'focus', arm: [22, 6], arm2: [-12, 6], dx: 1, tail: 3 },
  ],
  // 3 dive（魚躍，旋轉身體）
  [
    { ...base, eyes: 'focus', arm: [20, -10], arm2: [16, -4], rot: 35 },
    { ...base, eyes: 'focus', arm: [22, -16], arm2: [18, -10], rot: 70 },
    { ...base, eyes: 'closed', arm: [22, -16], arm2: [18, -10], rot: 80, eyesX: true },
  ],
  // 4 win
  [0, -4, -7, -4, 0].map((b, i) => ({ ...base, bob: b, eyes: 'happy', arm: [12, -22 - (i % 2) * 3], arm2: [-12, -20 - (i % 2) * 3], tail: [0, 3, 5, 3, 0][i] })),
  // 5 lose
  [0, 1, 1, 1, 0].map((b, i) => ({ ...base, bob: 2 + b, sx: 1.05, sy: 0.9, eyes: 'sad', arm: [12, 10], arm2: [-12, 10], tail: [4, 5, 6, 5, 4][i] })),
];

function drawFrame(ch, pose) {
  let img = newImg(F, F);
  ch.draw(img, pose);
  if (pose.rot) img = rotate(img, pose.rot, 32, 40, 0, 2);
  outline(img, ch.outline);
  return img;
}

function writeFile(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

const index = [];
for (const [id, ch] of Object.entries(CHARS)) {
  const sheet = newImg(F * 5, F * ROWS.length);
  ROWS.forEach((row, r) => row.forEach((pose, c) => blit(sheet, drawFrame(ch, pose), c * F, r * F)));
  const dir = join(ROOT, 'characters', id);
  writeFile(join(dir, 'sprite.png'), encodePng(sheet));
  const portrait = newImg(F, F);
  blit(portrait, drawFrame(ch, { ...base, eyes: 'happy', arm: [16, -6], arm2: [-14, 6] }), 0, 0);
  writeFile(join(dir, 'portrait.png'), encodePng(portrait));
  const manifest = {
    id,
    name: ch.name,
    sprite: 'sprite.png',
    frameSize: [F, F],
    animations: {
      idle: { row: 0, frames: 5, fps: 8 },
      run: { row: 0, frames: 5, fps: 12 },
      jump: { row: 1, frames: 5, fps: 10 },
      spike: { row: 2, frames: 5, fps: 15 },
      dive: { row: 3, frames: 3, fps: 10 },
      win: { row: 4, frames: 5, fps: 6 },
      lose: { row: 5, frames: 5, fps: 6 },
    },
    hitbox: { w: 64, h: 64 },
    stats: ch.stats,
    sfx: {},
    portrait: 'portrait.png',
    themeColor: ch.themeColor,
  };
  writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  index.push(id);
}
writeFile(join(ROOT, 'characters', 'index.json'), JSON.stringify(index) + '\n');

// ---------- PWA 圖示：沙灘上的排球 ----------
function icon() {
  const img = newImg(64, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const t = y / 64;
    set(img, x, y, y > 46 ? hex('#F2D38B') : [Math.round(80 + 90 * t), Math.round(170 + 50 * t), 245, 255]);
  }
  ellipse(img, 32, 49, 14, 3, '#d8b56a');
  ellipse(img, 32, 30, 15, 15, '#ffffff');
  ellipse(img, 26, 25, 7, 10, '#3A86FF');
  ellipse(img, 39, 37, 9, 6, '#FFBE0B');
  for (let a = 0; a < 360; a += 2) {
    const r = (a * Math.PI) / 180;
    set(img, 32 + Math.cos(r) * 15.5, 30 + Math.sin(r) * 15.5, hex('#1d3557'));
  }
  return img;
}
for (const size of [192, 512]) {
  const scale = size / 64;
  const out = newImg(size, size);
  blit(out, icon(), 0, 0, scale);
  writeFile(join(ROOT, 'icons', `icon-${size}.png`), encodePng(out));
}
const fav = icon();
writeFile(join(ROOT, 'icons', 'icon-64.png'), encodePng(fav));
console.log('assets generated:', index.join(', '));
