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
  // 濾波用 Sub（左邊像素差）：對大片平滑上色與透明區最有效
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (stride + 1);
    raw[o] = 1;
    for (let i = 0; i < stride; i++) raw[o + 1 + i] = (px[y * stride + i] - (i >= 4 ? px[y * stride + i - 4] : 0)) & 0xff;
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * 256 色調色盤 PNG（color type 3）：用 median cut 把不透明顏色縮成 255 色，索引 0 是透明。
 * 角色圖一張只有一個角色，255 色就足夠，檔案約小 4～6 倍。
 */
function encodePng8(img) {
  const { w, h, px } = img;
  const counts = new Map();
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    const key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let boxes = [[...counts.entries()].map(([k, n]) => [(k >> 16) & 255, (k >> 8) & 255, k & 255, n])];
  while (boxes.length < 255) {
    // 挑像素最多、且還能切的盒子，沿最長的色彩軸從中位數切開
    let bi = -1, bestN = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      const n = b.reduce((t, c) => t + c[3], 0);
      if (n > bestN) { bestN = n; bi = i; }
    });
    if (bi < 0) break;
    const box = boxes[bi];
    const range = [0, 1, 2].map((ch) => Math.max(...box.map((c) => c[ch])) - Math.min(...box.map((c) => c[ch])));
    const ch = range.indexOf(Math.max(...range));
    box.sort((a, b) => a[ch] - b[ch]);
    let half = bestN / 2, acc = 0, cut = 1;
    for (let i = 0; i < box.length - 1; i++) { acc += box[i][3]; if (acc >= half) { cut = i + 1; break; } }
    boxes.splice(bi, 1, box.slice(0, cut), box.slice(cut));
  }
  const palette = boxes.map((b) => {
    const n = b.reduce((t, c) => t + c[3], 0) || 1;
    return [0, 1, 2].map((ch) => Math.round(b.reduce((t, c) => t + c[ch] * c[3], 0) / n));
  });
  const cache = new Map();
  const nearest = (r, g, b) => {
    const key = (r << 16) | (g << 8) | b;
    let v = cache.get(key);
    if (v !== undefined) return v;
    let best = 0, bd = Infinity;
    palette.forEach((c, i) => {
      const d = (c[0] - r) ** 2 * 2 + (c[1] - g) ** 2 * 3 + (c[2] - b) ** 2;
      if (d < bd) { bd = d; best = i; }
    });
    v = best + 1;
    cache.set(key, v);
    return v;
  };
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      raw[y * (w + 1) + 1 + x] = px[i + 3] < 128 ? 0 : nearest(px[i], px[i + 1], px[i + 2]);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 3; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const plte = Buffer.alloc((palette.length + 1) * 3);
  palette.forEach((c, i) => { plte[(i + 1) * 3] = c[0]; plte[(i + 1) * 3 + 1] = c[1]; plte[(i + 1) * 3 + 2] = c[2]; });
  const trns = Buffer.from([0]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    chunk('tRNS', trns),
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
        if (d2 <= 1) put(img, x, y, colorAt(nx, ny, d2, x, y));
      }
  };
  const P = {
    /** 自訂顏色的橢圓：colorAt(nx, ny, d2) 回傳 RGBA */
    raw(cx, cy, rx, ry, colorAt) {
      ellipseRaw(cx, cy, rx, ry, colorAt);
    },
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
    /** 自訂顏色的多邊形：colorAt(x, y)（64 單位座標）回傳 RGBA */
    polyFn(pts, colorAt) {
      const sp = pts.map(([x, y]) => [x * S, y * S]);
      const xs = sp.map((q) => q[0]), ys = sp.map((q) => q[1]);
      for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++)
        for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
          const px = x + 0.5, py = y + 0.5;
          let inside = false;
          for (let i = 0, j = sp.length - 1; i < sp.length; j = i++) {
            const [xi, yi] = sp[i], [xj, yj] = sp[j];
            if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
          }
          if (inside) put(img, x, y, colorAt(px / S, py / S, x, y));
        }
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

/**
 * 彩色線稿＋貼紙白邊：
 * 先往外長 2 像素的線，顏色取相鄰色塊加深並混一點角色的線稿色；再往外長 2 像素白邊。
 */
function outline(img, tint, line = 2, border = 2) {
  const T = hex(tint);
  const grow = (n, colorOf) => {
    for (let pass = 0; pass < n; pass++) {
      const src = Buffer.from(img.px);
      const at = (x, y) => (x < 0 || y < 0 || x >= img.w || y >= img.h ? -1 : (y * img.w + x) * 4);
      for (let y = 0; y < img.h; y++)
        for (let x = 0; x < img.w; x++) {
          const i = at(x, y);
          if (src[i + 3] > 40) continue;
          let best = -1;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
            const j = at(x + dx, y + dy);
            if (j >= 0 && src[j + 3] > 160) { best = j; break; }
          }
          if (best < 0) continue;
          const c = colorOf([src[best], src[best + 1], src[best + 2]]);
          img.px[i] = c[0]; img.px[i + 1] = c[1]; img.px[i + 2] = c[2]; img.px[i + 3] = 255;
        }
    }
  };
  grow(1, (n) => mix(mix(n, [40, 24, 18], 0.62), T, 0.3));
  if (line > 1) grow(line - 1, (n) => n); // 沿用線色，加粗線條
  if (border > 0) grow(border, () => [255, 255, 255, 255]);
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

// ---------- 吉卜力風的原創台灣動物角色 ----------
// 畫風重點（原創角色，只取手繪動畫的感覺）：
// 1. 像水彩／賽璐璐手繪：底色＋一種柔和的陰影色（偏冷的紫褐，邊界柔軟）＋暖色受光。
// 2. 紙張與筆刷質感：細微的顆粒與橫向筆觸；靠近輪廓處顏色稍深（水彩積色）。
// 3. 自然、偏低彩度的配色。
// 4. 眼睛：小小的黑色豆豆眼＋一點高光（貓科、猛禽則是有顏色的虹膜）。
// 5. 線條：細細的暖褐色線，取相鄰顏色加深。
const INK = '#2a1e1a';

function hexMix(a, b, t) {
  const A = hex(a), B = hex(b);
  return '#' + [0, 1, 2].map((k) => Math.round(A[k] * (1 - t) + B[k] * t).toString(16).padStart(2, '0')).join('');
}

function hash2(x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

const LIGHT = (() => { const v = [-0.55, -0.65, 0.5]; const n = Math.hypot(...v); return v.map((x) => x / n); })();

/** 手繪上色：一種柔和陰影＋暖色受光＋筆刷顆粒；px/py 是像素座標（做質感用） */
function paint(base, nx, ny, nz, px, py, o = {}) {
  const B = hex(base);
  const d = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
  const S = mix(mix(B, [0, 0, 0], 0.3), hex(o.shadow ?? '#5a4a7a'), 0.24);
  let c = mix(S, B, smooth(0.16, 0.36, d));
  c = mix(c, hex(o.light ?? '#fff1d6'), smooth(0.72, 0.98, d) * 0.3);
  // 筆刷質感：只保留橫向的筆觸（每 2×5 像素一塊），顏色取 4 的倍數，讓 PNG 壓得小
  const g = (hash2(Math.floor(px * 0.25), Math.floor(py * 0.14)) - 0.5) * 0.08;
  return [0, 1, 2].map((i) => Math.max(0, Math.min(252, Math.round((c[i] * (1 + g)) / 4) * 4))).concat([255]);
}

/** 圓形部位（頭、身體、手腳） */
function ball(P, cx, cy, rx, ry, base, o = {}) {
  P.raw(cx, cy, rx, ry, (nx, ny, d2, px, py) => {
    const c = paint(base, nx, ny, Math.sqrt(Math.max(0, 1 - d2)), px, py, o);
    // 水彩積色：靠近輪廓稍深
    const edge = d2 > 0.84 ? 0.93 : 1;
    return [c[0] * edge, c[1] * edge, c[2] * edge, 255].map(Math.round);
  });
}

/** 平面部位（耳朵、喙、羽毛、角）：依位置估一個斜面 */
function slab(P, pts, base, o = {}) {
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const w = Math.max(1, (x1 - x0) / 2), h = Math.max(1, (y1 - y0) / 2);
  P.polyFn(pts, (lx, ly, px, py) => {
    const nx = ((lx - cx) / w) * 0.55, ny = ((ly - cy) / h) * 0.55;
    return paint(base, nx, ny, Math.sqrt(Math.max(0.05, 1 - nx * nx - ny * ny)), px, py, o);
  });
}

/** 由一串圓組成的管子（尾巴、脖子、四肢） */
function tube(P, pts, r0, r1, base, o = {}) {
  const n = pts.length;
  const samples = [];
  for (let i = 0; i < n - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const steps = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) * 1.5));
    for (let k = 0; k < steps; k++) samples.push([ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps, (i + k / steps) / (n - 1)]);
  }
  samples.push([...pts[n - 1], 1]);
  for (const [x, y, t] of samples) {
    const r = r0 + (r1 - r0) * t;
    ball(P, x, y, r, r, base, o);
  }
}

/** 吉卜力式的豆豆眼（貓科、猛禽有顏色的虹膜） */
function eye(P, x, y, kind, o = {}) {
  const s = o.size ?? 1;
  const dark = '#1a1416';
  if (kind === 'happy') {
    P.curve(x - 2.2 * s, y + 0.8, x, y - 1.8 * s, x + 2.2 * s, y + 0.8, dark, 1);
    return;
  }
  if (kind === 'closed') {
    P.curve(x - 2.2 * s, y, x, y + 1.2 * s, x + 2.2 * s, y, dark, 1);
    return;
  }
  if (kind === 'surprised') {
    P.ellipse(x, y, 2.1 * s, 2.4 * s, '#fffaf0');
    P.ellipse(x, y, 0.9 * s, 1.1 * s, dark);
    return;
  }
  if (o.iris) {
    P.ellipse(x, y, 2.5 * s, 2.8 * s, dark);
    P.ellipse(x, y, 2 * s, 2.3 * s, o.iris);
    if (o.slit) P.ellipse(x + 0.2, y, 0.65 * s, 1.9 * s, dark);
    else P.ellipse(x + 0.2, y, 1 * s, 1.1 * s, dark);
  } else {
    P.ellipse(x, y, 1.75 * s, 2.15 * s, dark);
  }
  P.ellipse(x - 0.6 * s, y - 0.8 * s, 0.6 * s, 0.65 * s, '#ffffff');
  const brow = o.brow ?? '#3a2a22';
  if (kind === 'focus') P.line(x - 2.6 * s, y - 3.4 * s, x + 2.2 * s, y - 2.3 * s, brow, 0.9);
  if (kind === 'sad') {
    P.line(x - 2.4 * s, y - 2.6 * s, x + 2.2 * s, y - 3.6 * s, brow, 0.8);
    P.ellipse(x + 1.4, y + 3, 0.8, 1.2, '#8fcfee', 220);
  }
  if (kind === 'sleepy' && o.skin) {
    P.line(x - 2.6 * s, y - 1.4 * s, x + 2.6 * s, y - 1.4 * s, o.skin, 2.2);
    P.line(x - 2.4 * s, y - 0.4 * s, x + 2.4 * s, y - 0.4 * s, dark, 0.8);
  }
}

/** 嘴巴：小小的弧線；開心時張開 */
function mouth(P, x, y, eyes) {
  if (eyes === 'happy' || eyes === 'surprised') {
    P.raw(x, y + 0.6, 1.9, 1.6, (nx, ny) => (ny < -0.15 ? [0, 0, 0, 0] : hex(ny > 0.4 ? '#e88a8a' : '#5a2228')));
    return;
  }
  if (eyes === 'sad') {
    P.curve(x - 1.5, y + 1, x, y - 0.3, x + 1.5, y + 1, INK, 0.6);
    return;
  }
  P.curve(x - 1.5, y, x, y + 1, x + 1.5, y, INK, 0.6);
}

/**
 * 共用骨架：身體＋頭＋四肢（比 Q 版更接近自然比例）。
 * o.wing：手臂畫成翅膀（鳥類）；o.legs === false：不畫腳。
 */
function creature(P, p, o) {
  const cx = 31 + p.dx;
  const by = 47 + p.bob * 0.7;
  const hx = cx + 2 + (o.headDx ?? 0);
  const hy = (o.headY ?? 27) + p.bob * 0.65;
  const fur = o.fur;
  const sh = o.shade ?? {};
  const limb = (from, to, r0, r1) => {
    if (o.wing) slab(P, [[from[0] - 1, from[1] - 4], [to[0] + 2, to[1]], [to[0] - 2, to[1] + 3], [from[0] + 1, from[1] + 4]], o.armColor ?? fur, sh);
    else tube(P, [from, to], r0, r1, o.armColor ?? fur, sh);
  };
  if (o.legs !== false) {
    for (const [lx, sgn] of [[-5.5, 1], [5.5, -1]]) {
      const x = cx + lx + sgn * p.legs * 0.8;
      tube(P, [[x, by + 6], [x, 58]], o.legR ?? 3.2, (o.legR ?? 3.2) - 0.3, o.legColor ?? fur, sh);
      ball(P, x + 1.5, 60, o.footRx ?? 4.6, 2.6, o.footColor ?? o.legColor ?? fur, sh);
    }
  }
  o.behind?.(hx, hy, cx, by);
  const arm2 = [cx + p.arm2[0] * 0.8, 42 + p.bob * 0.7 + p.arm2[1] * 0.8];
  limb([cx - 4, by - 5], arm2, 3, 3.2);
  ball(P, cx, by, (o.bodyRx ?? 12.5) * p.sx, (o.bodyRy ?? 12) * p.sy, fur, sh);
  o.belly?.(cx, by);
  const arm = [cx + p.arm[0] * 0.85, 42 + p.bob * 0.7 + p.arm[1] * 0.8];
  const raised = p.arm[1] < -10;
  if (raised) {
    limb([cx + 3, by - 5], arm, 2.9, 3.4);
    o.hand?.(arm[0], arm[1]);
  }
  o.headBack?.(hx, hy);
  ball(P, hx, hy, (o.headR ?? 15) * p.sx, (o.headRy ?? 14) * p.sy, o.headColor ?? fur, sh);
  o.head?.(hx, hy);
  const ey = hy + (o.eyeY ?? 0) * p.sy;
  const eo = { size: o.eyeSize ?? 1, iris: o.iris, slit: o.slit, brow: o.brow, skin: o.skin ?? o.headColor ?? fur };
  eye(P, hx + (o.eyeX1 ?? 3), ey, p.eyes, eo);
  eye(P, hx + (o.eyeX2 ?? 11.5), ey - 0.4, p.eyes, { ...eo, size: (o.eyeSize ?? 1) * 0.9 });
  if (o.mouth !== false) mouth(P, hx + (o.mouthX ?? 8.5), ey + (o.mouthY ?? 6.5), p.eyes);
  o.front?.(hx, hy, cx, by);
  if (!raised) {
    limb([cx + 3, by - 5], arm, 3, 3.6);
    o.hand?.(arm[0], arm[1]);
  }
}

const CHARS = {
  yunyun: {
    name: { 'zh-TW': '雲雲', en: 'Yunyun' },
    stats: { speed: -1, jump: 2, power: -1 },
    themeColor: '#8FC2EC',
    outline: '#4a6688',
    draw(P, p) {
      // 雲朵精靈：蓬鬆的雲身、頭頂一滴雨
      const cloud = '#eef4fb';
      const soft = { shadow: '#7a8ec0', light: '#ffffff' };
      creature(P, p, {
        fur: cloud, shade: soft, legColor: '#e2ecf8', armColor: '#e6eff9', bodyRx: 13, bodyRy: 11, headY: 28,
        head: (hx, hy) => {
          const s = (x, y, r) => ball(P, hx + x * p.sx, hy + y * p.sy, r * p.sx, r * p.sy, cloud, soft);
          s(-13, 3, 8); s(13, 3, 8); s(-7, -9, 9); s(6, -10, 10); s(0, 2, 14);
          const tx = hx + 4, ty = hy - 21 * p.sy;
          slab(P, [[tx, ty - 5], [tx - 3.4, ty + 2], [tx + 3.4, ty + 2]], '#7cb8e6');
          ball(P, tx, ty + 2.2, 3.4, 3.4, '#7cb8e6');
        },
        eyeX1: 4, eyeX2: 12, eyeY: 1, mouthX: 8.5, mouthY: 6.5,
      });
    },
  },
  kiki: {
    name: { 'zh-TW': '橘子', en: 'Kiki' },
    stats: { speed: 1, jump: 1, power: -1 },
    themeColor: '#E0904A',
    outline: '#4a2412',
    draw(P, p) {
      // 橘色虎斑貓：尖耳朵、額頭條紋、白色口鼻與胸口、長尾巴、金色貓眼
      const fur = '#e0904a', white = '#f6eedf', stripe = '#a8602e';
      creature(P, p, {
        fur, iris: '#e8c040', slit: true, brow: '#8a4a20',
        belly: (cx, by) => ball(P, cx + 3, by + 1, 7.5 * p.sx, 8 * p.sy, white),
        behind: (hx, hy, cx, by) => {
          const tw = p.tail;
          tube(P, [[cx - 9, by + 4], [cx - 17, by - 2 + tw * 0.5], [cx - 20, by - 13 + tw], [cx - 16, by - 21 + tw]], 2.8, 2.4, fur);
          for (const q of [[cx - 15, by + 1], [cx - 19, by - 8 + tw * 0.7]]) P.line(q[0] - 2, q[1], q[0] + 2, q[1] - 1, stripe, 1);
          slab(P, [[hx - 13, hy - 4], [hx - 11, hy - 20], [hx - 3, hy - 11]], fur);
          slab(P, [[hx + 3, hy - 12], [hx + 9, hy - 21], [hx + 13, hy - 5]], fur);
          slab(P, [[hx - 10.5, hy - 7], [hx - 10, hy - 15.5], [hx - 6, hy - 11]], '#e8a8a0');
          slab(P, [[hx + 5.5, hy - 11], [hx + 9, hy - 17.5], [hx + 10.5, hy - 7]], '#e8a8a0');
        },
        head: (hx, hy) => {
          for (const dx of [-3, 1, 5]) P.line(hx + dx, hy - 13, hx + dx + 0.6, hy - 8.5, stripe, 1);
          ball(P, hx + 7.5, hy + 6.5 * p.sy, 7, 4.8, white);
          ball(P, hx + 8.5, hy + 3.4 * p.sy, 1.4, 1, '#d8787a');
          for (const dy of [-0.5, 1.5]) P.line(hx + 14, hy + 5.5 + dy, hx + 20, hy + 4.5 + dy * 1.6, '#fffaf0', 0.4);
        },
        eyeY: 0, mouthX: 8.5, mouthY: 7,
      });
    },
  },
  goldie: {
    name: { 'zh-TW': '金金', en: 'Goldie' },
    stats: { speed: 0, jump: 0, power: 0 },
    themeColor: '#D9A85A',
    outline: '#4a3010',
    draw(P, p) {
      // 黃金獵犬：垂耳、突出的口鼻、黑鼻頭、奶油色胸毛、蓬鬆尾巴
      const fur = '#d9a85a', deep = '#b07e3a', cream = '#f2dfb4';
      creature(P, p, {
        fur, brow: '#8a5a20',
        belly: (cx, by) => ball(P, cx + 3, by - 1, 8 * p.sx, 8.5 * p.sy, cream),
        behind: (hx, hy, cx, by) => {
          const tw = p.tail;
          tube(P, [[cx - 10, by + 2], [cx - 17, by - 3 + tw * 0.6], [cx - 21, by - 11 + tw]], 3.8, 3.2, fur);
          ball(P, cx - 22, by - 14 + tw, 3.4, 3.4, cream);
        },
        headBack: (hx, hy) => ball(P, hx - 12, hy + 2, 4.6, 8.5, deep),
        head: (hx, hy) => {
          ball(P, hx + 11, hy + 6 * p.sy, 8, 5.6, cream);
          ball(P, hx + 18, hy + 3.5 * p.sy, 2.4, 1.9, '#2a2224');
          ball(P, hx - 8, hy + 3, 4.4, 8, deep);
        },
        eyeX1: 4.5, eyeX2: 12, eyeY: -1.5, mouthX: 13, mouthY: 9,
      });
    },
  },
  glidey: {
    name: { 'zh-TW': '滑滑', en: 'Glidey' },
    stats: { speed: -1, jump: 2, power: -1 },
    themeColor: '#A08868',
    outline: '#3a2a1a',
    draw(P, p) {
      // 白面鼯鼠：灰褐毛、白色臉頰、大眼睛、滑翔膜、扁平大尾巴
      const fur = '#8e7458', white = '#efe6d6', membrane = '#76604a';
      creature(P, p, {
        fur, eyeSize: 1.35, brow: '#5a4430',
        belly: (cx, by) => ball(P, cx + 2, by + 1, 8 * p.sx, 8.5 * p.sy, white),
        behind: (hx, hy, cx, by) => {
          const tw = p.tail;
          ball(P, cx - 16, by - 4 + tw * 0.6, 5.6, 12, '#806448');
          ball(P, cx - 16, by - 12 + tw, 4.2, 5.4, '#66503a');
          const ax = cx + p.arm2[0] * 0.8, ay = 42 + p.bob * 0.7 + p.arm2[1] * 0.8;
          slab(P, [[ax, ay], [cx - 14, by - 2], [cx - 12, by + 9], [cx - 4, by + 10]], membrane);
          ball(P, hx - 8, hy - 12, 4, 4.4, fur);
          ball(P, hx + 6, hy - 13, 4, 4.4, fur);
        },
        head: (hx, hy) => {
          ball(P, hx + 6, hy + 4 * p.sy, 9, 7, white);
          ball(P, hx + 12.5, hy + 4 * p.sy, 1.4, 1.1, '#d8888a');
          P.ellipse(hx + 3.5, hy - 0.5, 3.8, 4.2, '#5a4430', 120);
          P.ellipse(hx + 12.5, hy - 1, 3.4, 3.8, '#5a4430', 120);
        },
        front: (hx, hy, cx, by) => {
          const ax = cx + p.arm[0] * 0.85, ay = 42 + p.bob * 0.7 + p.arm[1] * 0.8;
          slab(P, [[ax, ay], [cx + 13, by + 2], [cx + 8, by + 10]], membrane);
        },
        eyeX1: 3.5, eyeX2: 12.5, eyeY: -0.5, mouthX: 10.5, mouthY: 6.5,
      });
    },
  },
  lanlan: {
    name: { 'zh-TW': '藍藍', en: 'Lanlan' },
    stats: { speed: 2, jump: 0, power: -1 },
    themeColor: '#4A82D0',
    outline: '#14223a',
    draw(P, p) {
      // 台灣藍鵲：黑頭、紅喙、黃色眼圈、藍色身體、白色尖端的長尾羽、紅腳
      const blue = '#3a72c0', black = '#2a2a30', red = '#cf3b30';
      creature(P, p, {
        fur: blue, headColor: black, legColor: red, footColor: red, armColor: blue, wing: true,
        legR: 2, footRx: 3.6, iris: '#e8c840', eyeSize: 0.9, brow: '#0a0a12', headR: 13.5, headRy: 12.5,
        belly: (cx, by) => ball(P, cx + 2, by + 2, 7 * p.sx, 7.5 * p.sy, '#7aa4dc'),
        behind: (hx, hy, cx, by) => {
          const tw = p.tail;
          for (const [dy, len] of [[0, 24], [4, 20]]) {
            const ex = cx - 10 - len, ey = by + 8 + dy + tw * 0.5;
            slab(P, [[cx - 8, by + 4 + dy * 0.5], [ex, ey - 2.4], [ex, ey + 2.4], [cx - 6, by + 8 + dy * 0.5]], blue);
            slab(P, [[ex + 5, ey - 2.2], [ex - 2, ey - 2.4], [ex - 2, ey + 2.4], [ex + 5, ey + 2.2]], '#f6f2ea');
          }
        },
        head: (hx, hy) => {
          slab(P, [[hx + 12, hy - 1 * p.sy], [hx + 21, hy + 2.5 * p.sy], [hx + 12, hy + 4.5 * p.sy]], red);
          P.ellipse(hx + 5, hy - 1, 3.4, 3.9, '#e8c840');
        },
        hand: (x, y) => ball(P, x + 1, y + 1, 3, 2.6, '#f6f2ea'),
        eyeX1: 5, eyeX2: 12, eyeY: -1, mouth: false,
      });
    },
  },
  yueyue: {
    name: { 'zh-TW': '月月', en: 'Yueyue' },
    stats: { speed: -2, jump: -1, power: 2 },
    themeColor: '#C8A07A',
    outline: '#0a0808',
    draw(P, p) {
      // 台灣黑熊：黑色毛、胸前白色 V 字月牙、淺褐色口鼻、圓耳
      const black = '#3a3638';
      const sh = { shadow: '#20182a', light: '#8a8090' };
      creature(P, p, {
        fur: black, shade: sh, brow: '#101016', headR: 16, headRy: 15, bodyRx: 13.5, bodyRy: 12.5,
        belly: (cx, by) => slab(P, [[cx - 7, by - 9], [cx + 1, by - 1], [cx + 10, by - 10], [cx + 10, by - 6.5], [cx + 1, by + 3], [cx - 7, by - 5.5]], '#ece6d6'),
        behind: (hx, hy) => {
          ball(P, hx - 10, hy - 11, 4.8, 4.8, black, sh);
          ball(P, hx + 7, hy - 13, 4.8, 4.8, black, sh);
        },
        head: (hx, hy) => {
          ball(P, hx + 9.5, hy + 6 * p.sy, 7.5, 5.6, '#b89470');
          ball(P, hx + 15, hy + 3 * p.sy, 2.4, 1.9, '#141012');
        },
        eyeX1: 4, eyeX2: 12, eyeY: -2, mouthX: 12.5, mouthY: 9,
      });
    },
  },
  mikado: {
    name: { 'zh-TW': '帝帝', en: 'Mikado' },
    stats: { speed: 0, jump: 1, power: 1 },
    themeColor: '#7080D0',
    outline: '#0e1028',
    draw(P, p) {
      // 帝雉：深藍紫羽毛、紅色臉部肉垂、白色翼斑、長尾羽上的白色橫斑
      const navy = '#2c3566', red = '#c83a30';
      creature(P, p, {
        fur: navy, legColor: '#8a8a92', footColor: '#8a8a92', armColor: navy, wing: true,
        legR: 2, footRx: 3.6, brow: '#06060e', headR: 13, headRy: 12.5,
        shade: { shadow: '#140e2a', light: '#8a9ae0' },
        belly: (cx, by) => ball(P, cx + 2, by + 1, 7 * p.sx, 8 * p.sy, '#3a4888'),
        behind: (hx, hy, cx, by) => {
          const tw = p.tail;
          const ex = cx - 34, ey = by + 4 + tw * 0.6;
          slab(P, [[cx - 8, by - 2], [ex, ey - 3], [ex - 2, ey + 1], [cx - 7, by + 6]], navy);
          for (let i = 1; i <= 4; i++) {
            const t = i / 5;
            const x = cx - 8 + (ex - (cx - 8)) * t, y = by + 2 + (ey - (by + 2)) * t;
            P.line(x, y - 3.2 + t, x - 1, y + 3 - t, '#f2f0ea', 1.1);
          }
          slab(P, [[hx - 4, hy - 11], [hx - 9, hy - 19], [hx + 1, hy - 13]], navy);
        },
        head: (hx, hy) => {
          ball(P, hx + 5.5, hy - 0.5, 5, 5.3, red);
          slab(P, [[hx + 12, hy + 1 * p.sy], [hx + 19, hy + 3.5 * p.sy], [hx + 12, hy + 6 * p.sy]], '#c8c0a8');
        },
        hand: (x, y) => P.line(x - 3, y - 1, x + 2, y - 2, '#f2f0ea', 1),
        eyeX1: 5.5, eyeX2: 12, eyeY: -1, mouth: false,
      });
    },
  },
  ying: {
    name: { 'zh-TW': '鷹鷹', en: 'Ying' },
    stats: { speed: -1, jump: 1, power: 2 },
    themeColor: '#B08458',
    outline: '#2a1a0e',
    draw(P, p) {
      // 熊鷹（赫氏角鷹）：深褐色羽毛、白色胸口上的褐色橫斑、短冠羽、彎鉤喙、黃色眼睛、黃色爪子
      const brown = '#8a6440', chest = '#efe6d2', bar = '#6a4a2c';
      creature(P, p, {
        fur: brown, armColor: '#7a5636', legColor: chest, footColor: '#e0b840', wing: true,
        legR: 3, iris: '#e8b830', brow: '#3a2414', headR: 14, headRy: 13,
        belly: (cx, by) => {
          ball(P, cx + 3, by + 1, 8 * p.sx, 9 * p.sy, chest);
          for (let i = 0; i < 4; i++) P.line(cx - 2, by - 4 + i * 3.2, cx + 8, by - 3 + i * 3.2, bar, 0.9);
        },
        behind: (hx, hy, cx, by) => {
          const tw = p.tail;
          slab(P, [[cx - 9, by + 2], [cx - 19, by + 10 + tw * 0.4], [cx - 16, by + 14 + tw * 0.4], [cx - 6, by + 8]], '#7a5636');
          // 短冠羽
          slab(P, [[hx - 6, hy - 9], [hx - 14, hy - 16], [hx - 2, hy - 12]], '#5a3c22');
        },
        head: (hx, hy) => {
          ball(P, hx + 4, hy + 4 * p.sy, 7, 5, '#a88460');
          // 彎鉤喙
          slab(P, [[hx + 11, hy - 1 * p.sy], [hx + 18, hy + 1 * p.sy], [hx + 17, hy + 6 * p.sy], [hx + 12, hy + 4 * p.sy]], '#3a3434');
          ball(P, hx + 11.5, hy, 2.2, 2, '#e0c040');
        },
        eyeX1: 4, eyeX2: 10.5, eyeY: -2, mouth: false,
      });
    },
  },
  meimei: {
    name: { 'zh-TW': '梅梅', en: 'Meimei' },
    stats: { speed: 2, jump: 1, power: -2 },
    themeColor: '#C8844A',
    outline: '#3a2010',
    draw(P, p) {
      // 台灣梅花鹿：栗色身體上的白色梅花斑、小鹿角、大耳朵、溫柔的大眼睛、黑鼻頭、白色臀斑
      const coat = '#b8743e', spot = '#f4ecd8', cream = '#efe2c8';
      creature(P, p, {
        fur: coat, legColor: '#a8683a', footColor: '#4a3428', legR: 2.4, footRx: 3.2, eyeSize: 1.25, brow: '#5a3a1a',
        headR: 13.5, headRy: 13, headY: 25,
        belly: (cx, by) => {
          ball(P, cx + 3, by + 3, 7 * p.sx, 7 * p.sy, cream);
          for (const [dx, dy] of [[-7, -5], [-3, -8], [1, -6], [-8, 0], [5, -8], [-4, -2]]) ball(P, cx + dx, by + dy, 1.3, 1.1, spot);
        },
        behind: (hx, hy, cx, by) => {
          ball(P, cx - 11, by + 2, 3.6, 4, '#f6f0e4');
          // 小鹿角
          for (const [x0, lean] of [[-4, -1], [4, 1]]) {
            const bx = hx + x0, byy = hy - 12;
            P.line(bx, byy, bx + lean * 2, byy - 9, '#8a6a48', 1.3);
            P.line(bx + lean * 1.2, byy - 5, bx + lean * 5, byy - 8, '#8a6a48', 1.1);
          }
          // 大耳朵
          slab(P, [[hx - 10, hy - 6], [hx - 19, hy - 9], [hx - 12, hy - 2]], coat);
          slab(P, [[hx - 11.5, hy - 5.5], [hx - 17, hy - 7.5], [hx - 12.5, hy - 3.5]], '#e8c8b0');
        },
        head: (hx, hy) => {
          ball(P, hx + 9, hy + 5 * p.sy, 7, 5, cream);
          ball(P, hx + 15, hy + 3.5 * p.sy, 2, 1.6, '#2a2224');
        },
        eyeX1: 3.5, eyeX2: 11, eyeY: -1, mouthX: 12, mouthY: 8,
      });
    },
  },
  pipi: {
    name: { 'zh-TW': '琵琵', en: 'Pipi' },
    stats: { speed: 0, jump: 1, power: -1 },
    themeColor: '#E8D890',
    outline: '#2a2a2a',
    draw(P, p) {
      // 黑面琵鷺：白色羽毛、黑色的臉、長長的黑色琵琶嘴、黑腳、頭後淡黃色飾羽
      const white = '#f4f2ec', black = '#26262a';
      creature(P, p, {
        fur: white, legColor: black, footColor: black, armColor: '#ecebe4', wing: true, legR: 1.8, footRx: 3.4,
        headR: 12, headRy: 11.5, headY: 26, eyeSize: 0.9, brow: '#0a0a0a', iris: '#b83a34',
        shade: { shadow: '#7a7aa0' },
        behind: (hx, hy, cx, by) => {
          // 淡黃色飾羽
          slab(P, [[hx - 8, hy - 6], [hx - 18, hy - 2], [hx - 15, hy + 2], [hx - 7, hy - 1]], '#f0d890');
          slab(P, [[cx - 9, by - 2], [cx - 16, by + 4], [cx - 9, by + 6]], '#ecebe4');
        },
        head: (hx, hy) => {
          // 黑臉：從嘴基部延伸到眼睛周圍
          slab(P, [[hx + 4, hy - 2], [hx + 11, hy - 1.5], [hx + 11, hy + 4], [hx + 5, hy + 3.5]], black);
          // 琵琶嘴：細長、末端扁圓
          slab(P, [[hx + 10, hy - 0.5], [hx + 23, hy + 1.5], [hx + 23, hy + 3.5], [hx + 10, hy + 3]], black);
          ball(P, hx + 24.5, hy + 2.5, 3, 2.4, black);
        },
        eyeX1: 4, eyeX2: 9.5, eyeY: 0, mouth: false,
      });
    },
  },
  hoho: {
    name: { 'zh-TW': '猴猴', en: 'Hoho' },
    stats: { speed: 1, jump: 2, power: -2 },
    themeColor: '#B0A090',
    outline: '#2a2420',
    draw(P, p) {
      // 台灣獼猴：灰褐色毛、粉色的臉、圓耳、長尾巴
      const fur = '#8a8070', face = '#e2b0a0';
      creature(P, p, {
        fur, brow: '#4a3a30', eyeSize: 1.05, skin: face,
        belly: (cx, by) => ball(P, cx + 2, by + 1, 7 * p.sx, 8 * p.sy, '#a89c8a'),
        behind: (hx, hy, cx, by) => {
          const tw = p.tail;
          tube(P, [[cx - 9, by + 5], [cx - 17, by + 2 + tw * 0.4], [cx - 22, by - 8 + tw], [cx - 19, by - 16 + tw]], 2.2, 1.8, fur);
          ball(P, hx - 13, hy + 1, 3.6, 4, face);
        },
        head: (hx, hy) => {
          // 粉色臉盤（心形）
          ball(P, hx + 5, hy + 1, 8.5, 9, face);
          ball(P, hx + 8, hy + 6, 6, 4.6, '#d89e90');
          P.line(hx - 3, hy - 9, hx + 10, hy - 10, '#6a5e50', 1.6);
        },
        eyeX1: 2.5, eyeX2: 9.5, eyeY: 0, mouthX: 8, mouthY: 7.5,
      });
    },
  },
  shishi: {
    name: { 'zh-TW': '石石', en: 'Shishi' },
    stats: { speed: 2, jump: 0, power: 0 },
    themeColor: '#C8A878',
    outline: '#2a1e12',
    draw(P, p) {
      // 石虎：灰黃褐底色上的黑色斑點、額頭兩條白線、耳背黑色帶白斑、尾巴有環紋、金色眼睛
      const fur = '#b0946a', spot = '#3a2e24', white = '#f2ece0';
      creature(P, p, {
        fur, iris: '#d8a83a', brow: '#3a2a1a',
        belly: (cx, by) => {
          ball(P, cx + 3, by + 1, 7.5 * p.sx, 8 * p.sy, white);
          for (const [dx, dy] of [[-8, -4], [-5, 2], [-9, 5], [6, 6], [-3, -8]]) ball(P, cx + dx, by + dy, 1.4, 1.2, spot);
        },
        behind: (hx, hy, cx, by) => {
          const tw = p.tail;
          tube(P, [[cx - 9, by + 4], [cx - 18, by + 2 + tw * 0.5], [cx - 22, by - 8 + tw]], 2.8, 2.6, fur);
          for (const t of [[cx - 15, by + 3], [cx - 19, by + 0 + tw * 0.4], [cx - 21.5, by - 5 + tw * 0.8]]) P.line(t[0], t[1] - 2.5, t[0] + 0.5, t[1] + 2.5, spot, 1.2);
          // 圓圓的耳朵，耳背黑色帶白斑
          ball(P, hx - 9, hy - 12, 4.6, 4.8, '#2e2620');
          ball(P, hx - 9, hy - 12, 1.6, 1.6, white);
          ball(P, hx + 6, hy - 13, 4.6, 4.8, '#2e2620');
          ball(P, hx + 6, hy - 13, 1.6, 1.6, white);
        },
        head: (hx, hy) => {
          // 額頭的兩條白線＋黑線
          P.line(hx + 2, hy - 2, hx + 1, hy - 12, white, 1.1);
          P.line(hx + 8, hy - 2, hx + 7, hy - 12, white, 1.1);
          P.line(hx + 5, hy - 4, hx + 4, hy - 13, spot, 1);
          ball(P, hx + 8, hy + 6.5 * p.sy, 6.5, 4.5, white);
          ball(P, hx + 9, hy + 3.4 * p.sy, 1.3, 1, '#c87868');
          for (const [dx, dy] of [[-10, 2], [-7, 7], [13, -3]]) ball(P, hx + dx, hy + dy, 1.2, 1, spot);
        },
        eyeY: 0, mouthX: 9, mouthY: 7,
      });
    },
  },
  caicai: {
    name: { 'zh-TW': '彩彩', en: 'Caicai' },
    stats: { speed: 1, jump: 0, power: 0 },
    themeColor: '#5AA848',
    outline: '#16281a',
    draw(P, p) {
      // 五色鳥（台灣擬啄木）：綠色身體、藍色頭頂與臉、黃色喉嚨、紅色斑點、黑色眼線、粗粗的喙
      const green = '#5aa848', blue = '#4a8ad8', yellow = '#f0d040', red = '#d8382c';
      creature(P, p, {
        fur: green, headColor: blue, armColor: '#4a9840', legColor: '#8a8a7a', footColor: '#8a8a7a', wing: true,
        legR: 2, footRx: 3.4, headR: 13.5, headRy: 13, eyeSize: 0.95, brow: '#0a0a12',
        belly: (cx, by) => ball(P, cx + 3, by + 2, 7 * p.sx, 7.5 * p.sy, '#8ac860'),
        behind: (hx, hy, cx, by) => slab(P, [[cx - 9, by + 2], [cx - 17, by + 8], [cx - 15, by + 11], [cx - 7, by + 7]], '#4a9840'),
        head: (hx, hy) => {
          ball(P, hx + 7, hy + 7, 6, 4.4, yellow);
          ball(P, hx + 2, hy - 9, 3.6, 2.6, red);
          ball(P, hx + 12, hy + 9, 2, 1.6, red);
          P.line(hx + 1, hy + 2.6, hx + 12, hy + 1.6, '#1a1a20', 0.8);
          slab(P, [[hx + 12, hy - 1], [hx + 20, hy + 2], [hx + 12, hy + 5]], '#d8d0b8');
        },
        eyeX1: 5, eyeX2: 11.5, eyeY: -1, mouth: false,
      });
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
  outline(img, ch.outline, 2, 0);
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
  writeFile(join(dir, 'sprite.png'), encodePng8(sheet));
  writeFile(join(dir, 'portrait.png'), encodePng8(drawFrame(ch, { ...base, eyes: 'happy', arm: [16, -6], arm2: [-14, 6] })));
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
