// 產生內建角色的精靈圖、頭像、manifest 與 PWA 圖示。
// 全部由程式繪製（原創角色），畫風走溫暖手繪感：三階柔和光影、暖色描邊、閃亮眼睛與腮紅。
// 執行：npm run gen:assets
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const S = 2; // 解析度倍率：以 64 單位設計、輸出 128×128 像素
const F = 64 * S;

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

// ---------- 點陣繪圖（像素座標） ----------
function newImg(w, h) {
  return { w, h, px: Buffer.alloc(w * h * 4) };
}
function hex(c, a = 255) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}
function get(img, x, y) {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return [0, 0, 0, 0];
  const i = (y * img.w + x) * 4;
  return [img.px[i], img.px[i + 1], img.px[i + 2], img.px[i + 3]];
}
/** 寫入像素；alpha < 255 時與底色混合 */
function put(img, x, y, col) {
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
  const i = (y * img.w + x) * 4;
  const a = col[3] / 255;
  if (a >= 1 || img.px[i + 3] === 0) {
    img.px[i] = col[0]; img.px[i + 1] = col[1]; img.px[i + 2] = col[2];
    img.px[i + 3] = img.px[i + 3] === 0 ? col[3] : Math.max(img.px[i + 3], col[3]);
    return;
  }
  for (let k = 0; k < 3; k++) img.px[i + k] = Math.round(img.px[i + k] * (1 - a) + col[k] * a);
}
function mix(c1, c2, t) {
  return [0, 1, 2].map((k) => Math.round(c1[k] * (1 - t) + c2[k] * t)).concat([255]);
}

/**
 * 以 64 單位座標作畫的畫筆（內部乘上 S）。
 * shaded：把橢圓當成球體，依光源（左上前方）分成 亮／中／暗 三階，底部再加一點環境遮蔽。
 */
function pen(img) {
  const L = (() => { const v = [-0.45, -0.65, 0.62]; const n = Math.hypot(...v); return v.map((x) => x / n); })();
  const ellipseRaw = (cx, cy, rx, ry, colorAt) => {
    cx *= S; cy *= S; rx *= S; ry *= S;
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
        const d2 = nx * nx + ny * ny;
        if (d2 <= 1) put(img, x, y, colorAt(nx, ny, d2));
      }
  };
  const P = {
    ellipse(cx, cy, rx, ry, c, a = 255) {
      const col = hex(c, a);
      ellipseRaw(cx, cy, rx, ry, () => col);
    },
    /** tones: [暗, 中, 亮] */
    shaded(cx, cy, rx, ry, [dark, mid, light]) {
      const D = hex(dark), M = hex(mid), Li = hex(light);
      ellipseRaw(cx, cy, rx, ry, (nx, ny, d2) => {
        const nz = Math.sqrt(Math.max(0, 1 - d2));
        const d = nx * L[0] + ny * L[1] + nz * L[2];
        if (ny > 0.78 && d < 0.45) return mix(D, [60, 40, 50], 0.12);
        if (d > 0.78) return Li;
        if (d > 0.3) return M;
        if (d > 0.12) return mix(M, D, 0.5);
        return D;
      });
    },
    /** 柔和光暈（中心 alpha 最高，往外淡出） */
    glow(cx, cy, r, c, a) {
      const col = hex(c);
      ellipseRaw(cx, cy, r, r, (nx, ny, d2) => [col[0], col[1], col[2], Math.round(a * (1 - Math.sqrt(d2)) ** 1.6)]);
    },
    poly(pts, c, a = 255) {
      const col = hex(c, a);
      const sp = pts.map(([x, y]) => [x * S, y * S]);
      const xs = sp.map((p) => p[0]), ys = sp.map((p) => p[1]);
      for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++)
        for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
          const px = x + 0.5, py = y + 0.5;
          let inside = false;
          for (let i = 0, j = sp.length - 1; i < sp.length; j = i++) {
            const [xi, yi] = sp[i], [xj, yj] = sp[j];
            if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
          }
          if (inside) put(img, x, y, col);
        }
    },
    line(x0, y0, x1, y1, c, w = 1, a = 255) {
      const col = hex(c, a);
      x0 *= S; y0 *= S; x1 *= S; y1 *= S;
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1) * 2;
      const r = (w * S) / 2;
      for (let i = 0; i <= n; i++) {
        const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
        for (let oy = -Math.floor(r); oy < Math.ceil(r) || oy === 0; oy++)
          for (let ox = -Math.floor(r); ox < Math.ceil(r) || ox === 0; ox++) put(img, x + ox, y + oy, col);
      }
    },
    /** 二次曲線 */
    curve(x0, y0, cx, cy, x1, y1, c, w = 1) {
      let px = x0, py = y0;
      for (let i = 1; i <= 16; i++) {
        const t = i / 16;
        const x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t * t * x1;
        const y = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t * t * y1;
        P.line(px, py, x, y, c, w);
        px = x; py = y;
      }
    },
    dot(x, y, c, a = 255) {
      put(img, x * S, y * S, hex(c, a));
    },
  };
  return P;
}

/** 選擇性描邊：透明像素若鄰接角色，塗上鄰色加深後的暖色線條 */
function outline(img, tint) {
  const src = Buffer.from(img.px);
  const T = hex(tint);
  const at = (x, y) => (x < 0 || y < 0 || x >= img.w || y >= img.h ? null : (y * img.w + x) * 4);
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const i = at(x, y);
      if (src[i + 3] > 40) continue;
      let best = null;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = at(x + dx, y + dy);
        if (j !== null && src[j + 3] > 160) { best = j; break; }
      }
      if (best === null) continue;
      const n = [src[best], src[best + 1], src[best + 2]];
      const c = mix(mix(n, [0, 0, 0], 0.55), T, 0.45);
      img.px[i] = c[0]; img.px[i + 1] = c[1]; img.px[i + 2] = c[2]; img.px[i + 3] = 255;
    }
}

/** 繞 (ox, oy)（64 單位）旋轉 deg 度並平移，最近鄰取樣 */
function rotate(img, deg, ox, oy, tx = 0, ty = 0) {
  ox *= S; oy *= S; tx *= S; ty *= S;
  const out = newImg(img.w, img.h);
  const r = (deg * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const dx = x + 0.5 - ox - tx, dy = y + 0.5 - oy - ty;
      const sx = Math.floor(cos * dx + sin * dy + ox), sy = Math.floor(-sin * dx + cos * dy + oy);
      const p = get(img, sx, sy);
      if (p[3]) { const i = (y * out.w + x) * 4; out.px[i] = p[0]; out.px[i + 1] = p[1]; out.px[i + 2] = p[2]; out.px[i + 3] = p[3]; }
    }
  return out;
}
function blit(dst, src, dx, dy, scale = 1) {
  for (let y = 0; y < src.h * scale; y++)
    for (let x = 0; x < src.w * scale; x++) {
      const p = get(src, Math.floor(x / scale), Math.floor(y / scale));
      if (p[3]) put(dst, dx + x, dy + y, p);
    }
}

// ---------- 共用的臉部 ----------
const INK = '#3a2418';
/** 閃亮的大眼睛：深褐色、上方大高光、下方小高光 */
function eye(P, x, y, kind, size = 1) {
  if (kind === 'happy') {
    P.curve(x - 2.6 * size, y + 0.8, x, y - 2.2 * size, x + 2.6 * size, y + 0.8, INK, 1.1);
  } else if (kind === 'sad') {
    P.curve(x - 2.4, y - 0.6, x, y + 1.6, x + 2.4, y - 0.6, INK, 1);
    P.ellipse(x + 0.5, y + 3.2, 0.9, 1.3, '#8fd0ff', 220);
  } else if (kind === 'closed') {
    P.line(x - 2.2, y, x + 2.2, y, INK, 1);
  } else if (kind === 'surprised') {
    P.ellipse(x, y, 1.5 * size, 1.9 * size, '#2b1a14');
    P.curve(x - 2.6, y - 4.6, x, y - 5.6, x + 2.4, y - 4.2, INK, 0.8);
  } else if (kind === 'sleepy') {
    P.ellipse(x, y + 0.6, 2.2 * size, 1.6 * size, '#2b1a14');
    P.line(x - 2.6 * size, y - 0.6, x + 2.6 * size, y - 0.6, INK, 1);
    P.dot(x - 0.6, y + 0.4, '#ffffff');
  } else {
    P.ellipse(x, y, 2.5 * size, 3.1 * size, '#2b1a14');
    P.ellipse(x, y + 1.1 * size, 1.9 * size, 1.6 * size, '#5a3a2c');
    P.ellipse(x - 0.8 * size, y - 1.2 * size, 1.0 * size, 1.1 * size, '#ffffff');
    P.dot(x + 1 * size, y + 1.3 * size, '#ffffff');
    if (kind === 'focus') P.line(x - 3, y - 4.4, x + 2.4, y - 3.4, INK, 1.1);
  }
}
function blush(P, x, y, r = 3) {
  P.glow(x, y, r, '#ff8fa3', 170);
}

// ---------- 角色 ----------
// pose: bob（上下）、dx、sx/sy（壓扁拉長）、arm/arm2（手的位置，相對身體中心）、legs、eyes、rot、tail
const CHARS = {
  momo: {
    name: { 'zh-TW': '桃桃', en: 'Momo' },
    stats: { speed: 0, jump: 0, power: 0 },
    themeColor: '#F4A259',
    outline: '#6b3416',
    draw(P, p) {
      const cx = 31 + p.dx, cy = 42 + p.bob;
      const fur = ['#D9803A', '#F4A259', '#FFC98B'], cream = ['#EBCB9C', '#FFF1D6', '#FFFBF2'], paw = ['#B9652B', '#D98A4E', '#F0AE77'];
      P.shaded(cx - 9 + p.legs, 60, 6, 3.2, paw);
      P.shaded(cx + 9 - p.legs, 60, 6, 3.2, paw);
      for (const [ex, ey] of [[-12, -19], [9, -21]]) {
        P.shaded(cx + ex * p.sx, cy + ey * p.sy, 5.8, 5.8, fur);
        P.ellipse(cx + ex * p.sx + 0.4, cy + ey * p.sy + 0.4, 3, 3, '#F7AFBF');
      }
      P.shaded(cx, cy, 23 * p.sx, 21 * p.sy, fur);
      P.shaded(cx + 5, cy + 6 * p.sy, 14 * p.sx, 12.5 * p.sy, cream);
      // 臉頰白毛與毛流
      P.ellipse(cx + 14, cy - 1 * p.sy, 8, 6, '#FFF1D6');
      for (let i = 0; i < 3; i++) P.line(cx - 16 + i * 3, cy - 12 + i, cx - 14 + i * 3, cy - 9 + i, '#D9803A', 0.6);
      eye(P, cx + 9, cy - 7 * p.sy, p.eyes);
      eye(P, cx + 18.5, cy - 8 * p.sy, p.eyes);
      blush(P, cx + 6, cy - 1 * p.sy, 3.2);
      blush(P, cx + 22, cy - 2 * p.sy, 2.6);
      P.ellipse(cx + 15, cy - 3 * p.sy, 1.4, 1.1, '#9b4a3a');
      P.curve(cx + 13.5, cy - 1 * p.sy, cx + 15, cy + 0.6 * p.sy, cx + 16.5, cy - 1 * p.sy, INK, 0.6);
      P.shaded(cx + p.arm[0], cy + p.arm[1], 4.6, 4.6, paw);
      P.shaded(cx + p.arm2[0], cy + p.arm2[1], 4.2, 4.2, paw);
    },
  },
  yunyun: {
    name: { 'zh-TW': '雲雲', en: 'Yunyun' },
    stats: { speed: -1, jump: 2, power: -1 },
    themeColor: '#9FD3F5',
    outline: '#3f5f8f',
    draw(P, p) {
      const cx = 32 + p.dx, cy = 42 + p.bob;
      const cloud = ['#A9C7EA', '#DDEFFF', '#FFFFFF'], puff = ['#94B6DE', '#BFDAF4', '#E9F5FF'];
      P.shaded(cx - 9 + p.legs, 60, 5, 3, puff);
      P.shaded(cx + 9 - p.legs, 60, 5, 3, puff);
      const s = (x, y, r) => P.shaded(cx + x * p.sx, cy + y * p.sy, r * p.sx, r * p.sy, cloud);
      s(-15, -2, 8); s(17, -3, 8); s(-13, 5, 11); s(13, 5, 11); s(-6, -9, 12); s(7, -11, 13); s(0, 6, 15);
      // 頭頂的小雨滴髮飾
      P.poly([[cx + 4, cy - 30 * p.sy], [cx + 1.5, cy - 25 * p.sy], [cx + 6.5, cy - 25 * p.sy]], '#7cc4f2');
      P.shaded(cx + 4, cy - 24 * p.sy, 2.6, 2.6, ['#5aa9e0', '#7cc4f2', '#d9f1ff']);
      eye(P, cx + 6, cy - 3 * p.sy, p.eyes);
      eye(P, cx + 16, cy - 4 * p.sy, p.eyes);
      blush(P, cx + 2.5, cy + 3 * p.sy, 3.2);
      blush(P, cx + 20.5, cy + 2 * p.sy, 2.8);
      P.curve(cx + 9.5, cy + 2.5 * p.sy, cx + 11, cy + 4.5 * p.sy, cx + 12.5, cy + 2.5 * p.sy, INK, 0.6);
      P.shaded(cx + p.arm[0], cy + p.arm[1], 4.6, 4, puff);
      P.shaded(cx + p.arm2[0], cy + p.arm2[1], 4.2, 3.6, puff);
    },
  },
  kit: {
    name: { 'zh-TW': '小葉', en: 'Kit' },
    stats: { speed: 2, jump: -1, power: -1 },
    themeColor: '#7CC26B',
    outline: '#4a2412',
    draw(P, p) {
      const cx = 30 + p.dx, cy = 44 + p.bob;
      const fur = ['#B9552B', '#E07A45', '#F6A36F'], white = ['#EAD9C6', '#FFF6EA', '#FFFFFF'], paw = ['#6b3418', '#8a4524', '#a8603a'];
      const tw = p.tail;
      // 葉子尾巴
      P.poly([[cx - 8, cy + 4], [cx - 22, cy - 6 + tw], [cx - 29, cy - 21 + tw], [cx - 16, cy - 15 + tw], [cx - 6, cy - 2]], '#7CC26B');
      P.poly([[cx - 8, cy + 3], [cx - 22, cy - 6 + tw], [cx - 29, cy - 21 + tw], [cx - 19, cy - 9 + tw]], '#5A9E4F');
      P.line(cx - 8, cy + 2, cx - 26, cy - 18 + tw, '#3d7a37', 0.7);
      for (const k of [0.35, 0.6]) {
        const bx = cx - 8 + (-18 * k), by = cy + 2 + (-20 + tw) * k;
        P.line(bx, by, bx - 4, by + 1.5, '#3d7a37', 0.5);
        P.line(bx, by, bx + 1, by - 4, '#3d7a37', 0.5);
      }
      P.shaded(cx - 7 + p.legs, 60, 4.6, 3, paw);
      P.shaded(cx + 8 - p.legs, 60, 4.6, 3, paw);
      P.shaded(cx, cy + 4 * p.sy, 14 * p.sx, 13 * p.sy, fur);
      P.shaded(cx + 3, cy + 7 * p.sy, 8 * p.sx, 8 * p.sy, white);
      const hx = cx + 5, hy = cy - 14 * p.sy;
      P.poly([[hx - 12, hy - 6], [hx - 10, hy - 23], [hx - 2, hy - 10]], '#E07A45');
      P.poly([[hx + 2, hy - 10], [hx + 9, hy - 24], [hx + 12, hy - 6]], '#E07A45');
      P.poly([[hx - 10, hy - 9], [hx - 9.5, hy - 19], [hx - 5, hy - 11]], '#5a2a16');
      P.poly([[hx + 5, hy - 11], [hx + 9, hy - 20], [hx + 10, hy - 9]], '#5a2a16');
      P.shaded(hx, hy, 14, 12, fur);
      P.shaded(hx + 9, hy + 4, 8, 5.5, white);
      // 額頭的小葉片
      P.poly([[hx - 2, hy - 9], [hx + 2, hy - 13], [hx + 4, hy - 9]], '#7CC26B');
      P.ellipse(hx + 16.5, hy + 2, 2, 1.6, '#2b1a14');
      P.dot(hx + 16, hy + 1.3, '#ffffff');
      eye(P, hx + 1, hy - 3, p.eyes);
      eye(P, hx + 10, hy - 4, p.eyes);
      blush(P, hx - 3, hy + 4, 2.6);
      P.shaded(cx + p.arm[0], cy + p.arm[1], 4, 4, paw);
      P.shaded(cx + p.arm2[0], cy + p.arm2[1], 3.6, 3.6, paw);
    },
  },
  taitai: {
    name: { 'zh-TW': '苔苔', en: 'Taitai' },
    stats: { speed: -2, jump: 0, power: 2 },
    themeColor: '#7FA36B',
    outline: '#2f3f24',
    draw(P, p) {
      // 森林裡睡眼惺忪的苔蘚精靈：圓滾滾的身體、頭頂一株嫩芽、肚子上三片幸運草紋
      const cx = 32 + p.dx, cy = 40 + p.bob;
      const moss = ['#56794A', '#7FA36B', '#A9CA8E'], belly = ['#CFC7A6', '#EDE6CB', '#FBF7E8'], foot = ['#4a5f3c', '#62804f', '#86a670'];
      P.shaded(cx - 10 + p.legs, 60, 7, 3.4, foot);
      P.shaded(cx + 10 - p.legs, 60, 7, 3.4, foot);
      P.shaded(cx, cy, 25 * p.sx, 22 * p.sy, moss);
      // 苔蘚的毛茸質感
      for (const [x, y] of [[-17, -8], [-12, -15], [-19, 2], [16, -12], [-6, -18], [19, 4]]) {
        P.line(cx + x * p.sx, cy + y * p.sy, cx + (x + 1.5) * p.sx, cy + (y - 2) * p.sy, '#56794A', 0.6);
      }
      P.shaded(cx + 4, cy + 7 * p.sy, 15 * p.sx, 12 * p.sy, belly);
      // 肚子上一片淡淡的葉子印記
      const lx = cx + 5, ly = cy + 6 * p.sy;
      P.poly([[lx - 4, ly + 3], [lx - 1, ly - 3], [lx + 4, ly - 4], [lx + 2, ly + 1]], '#b9d39f');
      P.line(lx - 3.5, ly + 2.5, lx + 3, ly - 3.5, '#8fb27a', 0.5);
      // 頭頂嫩芽
      const top = cy - 22 * p.sy;
      P.line(cx + 2, top + 2, cx + 3, top - 5, '#5a8a3e', 0.9);
      P.poly([[cx + 3, top - 4], [cx - 4, top - 9], [cx - 6, top - 5], [cx + 1, top - 2]], '#8cc66a');
      P.poly([[cx + 3, top - 4], [cx + 10, top - 10], [cx + 12, top - 6], [cx + 5, top - 2]], '#a6d97f');
      // 側邊的小蘑菇
      P.shaded(cx - 21 * p.sx, cy + 2 * p.sy, 3.8, 2.6, ['#a8432f', '#d9604a', '#f08a74']);
      P.dot(cx - 22 * p.sx, cy + 1.4 * p.sy, '#ffffff');
      P.line(cx - 21 * p.sx, cy + 4 * p.sy, cx - 21 * p.sx, cy + 6 * p.sy, '#f3ead6', 1);
      const ek = p.eyes === 'open' ? 'sleepy' : p.eyes;
      eye(P, cx + 9, cy - 7 * p.sy, ek, 1.1);
      eye(P, cx + 19, cy - 8 * p.sy, ek, 1.1);
      blush(P, cx + 6, cy - 1 * p.sy, 3);
      blush(P, cx + 22, cy - 2 * p.sy, 2.6);
      P.curve(cx + 12.5, cy - 2 * p.sy, cx + 14.5, cy + 0.6 * p.sy, cx + 16.5, cy - 2 * p.sy, INK, 0.6);
      P.shaded(cx + p.arm[0] + 2, cy + p.arm[1], 5, 5, foot);
      P.shaded(cx + p.arm2[0] - 2, cy + p.arm2[1], 4.6, 4.6, foot);
    },
  },
  tomo: {
    name: { 'zh-TW': '燈燈', en: 'Tomo' },
    stats: { speed: 1, jump: 1, power: -2 },
    themeColor: '#FFC86B',
    outline: '#5b3a29',
    draw(P, p) {
      // 夏日祭典的紙燈籠精靈：暖暖發光，腳下是藍色的小火苗
      const cx = 32 + p.dx, cy = 40 + p.bob;
      const paper = ['#F0B45E', '#FFE3A8', '#FFF8E6'], wood = ['#3f2618', '#5B3A29', '#7a523c'];
      P.glow(cx, cy, 30, '#ffd27a', 110);
      // 火苗尾巴（取代腳）
      const fl = p.legs * 0.6;
      P.poly([[cx - 8, 54], [cx - 4 + fl, 63], [cx - 1, 56]], '#6aa8ff', 220);
      P.poly([[cx + 1, 56], [cx + 5 - fl, 63], [cx + 8, 54]], '#6aa8ff', 220);
      P.poly([[cx - 4, 55], [cx + fl * 0.5, 62], [cx + 4, 55]], '#bfe0ff', 230);
      P.shaded(cx, cy, 19 * p.sx, 21 * p.sy, paper);
      // 竹骨
      for (const k of [-0.62, -0.25, 0.12, 0.48]) {
        const y = cy + k * 21 * p.sy;
        const half = 19 * p.sx * Math.sqrt(1 - k * k);
        P.curve(cx - half, y, cx, y + 1.4, cx + half, y, '#e0a050', 0.55);
      }
      // 上下木蓋與提把
      P.shaded(cx, cy - 20.5 * p.sy, 10, 3, wood);
      P.shaded(cx, cy + 20.5 * p.sy, 9, 3, wood);
      P.curve(cx - 5, cy - 22 * p.sy, cx, cy - 31 * p.sy, cx + 5, cy - 22 * p.sy, '#5B3A29', 0.9);
      // 紅流蘇
      P.line(cx - 2, cy + 23 * p.sy, cx - 3, cy + 28 * p.sy, '#d9463b', 0.9);
      P.line(cx + 2, cy + 23 * p.sy, cx + 3, cy + 28 * p.sy, '#d9463b', 0.9);
      // 用墨畫在紙上的臉
      eye(P, cx + 2, cy - 3 * p.sy, p.eyes);
      eye(P, cx + 12, cy - 4 * p.sy, p.eyes);
      blush(P, cx - 1, cy + 3 * p.sy, 3);
      blush(P, cx + 15, cy + 2 * p.sy, 3);
      P.curve(cx + 5.5, cy + 2.5 * p.sy, cx + 7, cy + 5 * p.sy, cx + 8.5, cy + 2.5 * p.sy, INK, 0.7);
      // 小手（兩團光）
      P.glow(cx + p.arm[0], cy + p.arm[1], 6, '#fff1b8', 200);
      P.shaded(cx + p.arm[0], cy + p.arm[1], 3.4, 3.4, paper);
      P.shaded(cx + p.arm2[0], cy + p.arm2[1], 3, 3, paper);
    },
  },
  mochi: {
    name: { 'zh-TW': '麻糬', en: 'Mochi' },
    stats: { speed: 1, jump: 1, power: -1 },
    themeColor: '#F7B7C8',
    outline: '#6b4250',
    draw(P, p) {
      // 軟綿綿的白麻糬兔：長長垂耳、額頭一朵櫻花
      const cx = 32 + p.dx, cy = 43 + p.bob;
      const white = ['#E2DCEA', '#FFFFFF', '#FFFFFF'], earIn = '#F7C6D0', foot = ['#E2DCEA', '#F6F2FA', '#FFFFFF'];
      P.shaded(cx - 8 + p.legs, 60.5, 5.4, 2.8, foot);
      P.shaded(cx + 8 - p.legs, 60.5, 5.4, 2.8, foot);
      // 垂耳（往後飄）
      const ew = p.tail * 0.6;
      for (const [x0, w] of [[-6, 6], [2, 5.5]]) {
        P.shaded(cx + x0 - 8 + ew * 0.3, cy - 14 * p.sy + ew, w, 13, white);
        P.ellipse(cx + x0 - 7 + ew * 0.3, cy - 13 * p.sy + ew, w * 0.45, 9, earIn);
      }
      P.shaded(cx, cy, 21 * p.sx, 19 * p.sy, white);
      // 額頭櫻花
      const fx = cx + 9, fy = cy - 14 * p.sy;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        P.ellipse(fx + Math.cos(a) * 1.8, fy + Math.sin(a) * 1.8, 1.4, 1.4, '#f59ab3');
      }
      P.dot(fx, fy, '#ffe28a');
      eye(P, cx + 7, cy - 4 * p.sy, p.eyes, 1.1);
      eye(P, cx + 17, cy - 5 * p.sy, p.eyes, 1.1);
      blush(P, cx + 3.5, cy + 2 * p.sy, 3.4);
      blush(P, cx + 20.5, cy + 1 * p.sy, 3);
      P.curve(cx + 10.5, cy + 0.6 * p.sy, cx + 12, cy + 2.4 * p.sy, cx + 13.5, cy + 0.6 * p.sy, INK, 0.6);
      P.shaded(cx + p.arm[0], cy + p.arm[1], 4.2, 4.2, foot);
      P.shaded(cx + p.arm2[0], cy + p.arm2[1], 3.8, 3.8, foot);
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
  // 3 dive
  [
    { ...base, eyes: 'focus', arm: [20, -10], arm2: [16, -4], rot: 35 },
    { ...base, eyes: 'focus', arm: [22, -16], arm2: [18, -10], rot: 70 },
    { ...base, eyes: 'closed', arm: [22, -16], arm2: [18, -10], rot: 80 },
  ],
  // 4 win
  [0, -4, -7, -4, 0].map((b, i) => ({ ...base, bob: b, eyes: 'happy', arm: [12, -22 - (i % 2) * 3], arm2: [-12, -20 - (i % 2) * 3], tail: [0, 3, 5, 3, 0][i] })),
  // 5 lose
  [0, 1, 1, 1, 0].map((b, i) => ({ ...base, bob: 2 + b, sx: 1.05, sy: 0.9, eyes: 'sad', arm: [12, 10], arm2: [-12, 10], tail: [4, 5, 6, 5, 4][i] })),
  // 6 run：身體前傾、腳步與手臂擺幅加大
  [0, -2, 0, -2, 0].map((b, i) => ({
    ...base, bob: b, dx: 1.5, sx: 1.03, sy: 0.97,
    legs: [5, 0, -5, 0, 5][i], arm: [16, [0, 4, 8, 4, 0][i]], arm2: [-12, [8, 4, 0, 4, 8][i]], tail: [-2, 1, 3, 1, -2][i],
  })),
  // 7 bump（接球）：屈膝、雙手併攏往前下方 → 擊球後往上送
  [
    { ...base, eyes: 'focus', bob: 3, sy: 0.93, sx: 1.05, arm: [16, 10], arm2: [12, 12] },
    { ...base, eyes: 'focus', bob: 3, sy: 0.92, sx: 1.06, arm: [18, 8], arm2: [15, 10] },
    { ...base, eyes: 'focus', bob: 1, arm: [18, 0], arm2: [15, 2] },
    { ...base, eyes: 'open', bob: -1, arm: [16, -8], arm2: [13, -6] },
    { ...base, eyes: 'open', bob: 0, arm: [14, -2], arm2: [-12, 4] },
  ],
  // 8 cheer（得分）：跳起來、雙手高舉、閃閃發亮
  [-2, -6, -8, -6, -2].map((b, i) => ({
    ...base, bob: b, eyes: 'happy', sparkle: i, arm: [11, -24 - (i % 2) * 3], arm2: [-11, -22 - ((i + 1) % 2) * 3], tail: [1, 3, 5, 3, 1][i],
  })),
  // 9 oops（失分）：嚇一跳、往後縮、冒汗
  [0, 1, 0, 1, 0].map((b, i) => ({
    ...base, bob: b, dx: [-1, -2, -1, -2, -1][i], eyes: 'surprised', sweat: i, arm: [16, 0], arm2: [-16, 0], tail: [2, 3, 2, 3, 2][i],
  })),
];

/** 得分時頭上的小星星 */
function sparkles(P, phase) {
  for (const [x, y, s] of [[14, 10, 1], [50, 6, 0.8], [56, 22, 0.6]]) {
    const r = (2.2 + ((phase + x) % 3) * 0.5) * s;
    P.poly([[x, y - r * 2], [x + r * 0.5, y - r * 0.5], [x + r * 2, y], [x + r * 0.5, y + r * 0.5], [x, y + r * 2], [x - r * 0.5, y + r * 0.5], [x - r * 2, y], [x - r * 0.5, y - r * 0.5]], '#ffe27a');
    P.dot(x, y, '#ffffff');
  }
}

/** 失分時的冷汗 */
function sweat(P, phase) {
  const y = 16 + phase * 0.8;
  P.poly([[50, y - 4], [47.5, y + 1], [52.5, y + 1]], '#9fdcff');
  P.ellipse(50, y + 1.5, 2.6, 2.6, '#9fdcff');
  P.dot(49, y + 0.5, '#ffffff');
}

function drawFrame(ch, pose) {
  let img = newImg(F, F);
  const P = pen(img);
  ch.draw(P, pose);
  if (pose.sparkle !== undefined) sparkles(P, pose.sparkle);
  if (pose.sweat !== undefined) sweat(P, pose.sweat);
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
  writeFile(join(dir, 'portrait.png'), encodePng(drawFrame(ch, { ...base, eyes: 'happy', arm: [16, -6], arm2: [-14, 6] })));
  const manifest = {
    id,
    name: ch.name,
    sprite: 'sprite.png',
    frameSize: [F, F],
    animations: {
      idle: { row: 0, frames: 5, fps: 8 },
      run: { row: 6, frames: 5, fps: 14 },
      jump: { row: 1, frames: 5, fps: 10 },
      spike: { row: 2, frames: 5, fps: 15 },
      dive: { row: 3, frames: 3, fps: 10 },
      win: { row: 4, frames: 5, fps: 6 },
      lose: { row: 5, frames: 5, fps: 6 },
      bump: { row: 7, frames: 5, fps: 20 },
      cheer: { row: 8, frames: 5, fps: 10 },
      oops: { row: 9, frames: 5, fps: 8 },
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

// ---------- PWA 圖示：夏日天空下的排球 ----------
function icon(size) {
  const img = newImg(size, size);
  const k = size / 64;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const t = y / size;
    const sky = mix(hex('#2f7fd8'), hex('#ffe2b8'), Math.min(1, t * 1.3));
    put(img, x, y, t > 0.74 ? mix(hex('#f6dca4'), hex('#e6bd7c'), (t - 0.74) * 4) : sky);
  }
  // 以 64 單位畫，換算到實際尺寸
  const s = k / S;
  const E = (cx, cy, rx, ry, tones) => pen(img).shaded(cx * s, cy * s, rx * s, ry * s, tones);
  pen(img).glow(46 * s, 16 * s, 14 * s, '#fff6d8', 200);
  E(32, 50, 14, 3, ['#cfa868', '#d8b56f', '#e2c483']);
  E(32, 30, 15, 15, ['#c9d6ea', '#ffffff', '#ffffff']);
  pen(img).ellipse(26 * s, 25 * s, 7 * s, 10 * s, '#3A86FF', 230);
  pen(img).ellipse(39 * s, 37 * s, 9 * s, 6 * s, '#FFBE0B', 230);
  outline(img, '#1d3557');
  return img;
}
for (const size of [64, 192, 512]) writeFile(join(ROOT, 'icons', `icon-${size}.png`), encodePng(icon(size)));
console.log('assets generated:', index.join(', '));
