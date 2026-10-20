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
          if (inside) put(img, x, y, colorAt(px / S, py / S));
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
  grow(1, (n) => mix(mix(n, [12, 8, 12], 0.7), T, 0.35));
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

// ---------- 3D 質感的原創動物角色（台灣主題） ----------
// 畫風：像 3D 遊戲裡的寵物怪獸——
// 1. 體積感上色：漫射光（左上前方）＋陰影偏冷色＋高光（鏡面反射）＋背光邊緣（rim light）＋底部環境遮蔽。
// 2. 眼睛：深色光滑的眼球、一個大高光＋一個小反光，沒有睫毛、沒有腮紅。
// 3. 體型：頭大但身體結實、四肢分明，站姿穩。
// 4. 線稿：細細的深色外框（不加白邊）。
const INK = '#20161a';

function hexMix(a, b, t) {
  const A = hex(a), B = hex(b);
  return '#' + [0, 1, 2].map((k) => Math.round(A[k] * (1 - t) + B[k] * t).toString(16).padStart(2, '0')).join('');
}

const LIGHT = (() => { const v = [-0.5, -0.7, 0.55]; const n = Math.hypot(...v); return v.map((x) => x / n); })();
const HALF = (() => { const v = [LIGHT[0], LIGHT[1], LIGHT[2] + 1]; const n = Math.hypot(...v); return v.map((x) => x / n); })();

/** 依法線算出 3D 光照後的顏色 */
function lit(base, nx, ny, nz, o = {}) {
  const B = hex(base);
  const diffuse = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
  const spec = Math.pow(Math.max(0, nx * HALF[0] + ny * HALF[1] + nz * HALF[2]), o.shine ?? 24) * (o.gloss ?? 0.16);
  const rim = Math.pow(1 - Math.max(0, nz), 3) * (o.rim ?? 0.28) * Math.max(0, 0.4 - ny * 0.6);
  const ao = 1 - 0.28 * Math.pow(Math.max(0, ny), 2);
  const k = (0.5 + 0.62 * diffuse) * ao;
  const shadow = hex(o.shadow ?? '#2c2a5a');
  const s = Math.max(0, 0.75 - diffuse) * 0.32; // 陰影偏冷色
  return [0, 1, 2].map((i) => {
    const v = B[i] * k * (1 - s) + shadow[i] * s + 255 * spec + 205 * rim;
    return Math.max(0, Math.min(255, Math.round(v)));
  }).concat([255]);
}

/** 3D 球體（橢球）上色 */
function ball(P, cx, cy, rx, ry, base, o = {}) {
  P.raw(cx, cy, rx, ry, (nx, ny, d2) => lit(base, nx, ny, Math.sqrt(Math.max(0, 1 - d2)), o));
}

/** 有體積感的多邊形（耳朵、喙、羽毛）：用位置估一個斜面法線 */
function slab(P, pts, base, o = {}) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const w = Math.max(1, (x1 - x0) / 2), h = Math.max(1, (y1 - y0) / 2);
  const col = (px, py) => {
    const nx = ((px - cx) / w) * 0.6, ny = ((py - cy) / h) * 0.6;
    return lit(base, nx, ny, Math.sqrt(Math.max(0.05, 1 - nx * nx - ny * ny)), o);
  };
  P.polyFn(pts, col);
}

/** 一串圓組成的管子（尾巴、脖子） */
function tube(P, pts, r0, r1, base, o = {}) {
  const n = pts.length;
  const samples = [];
  for (let i = 0; i < n - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const steps = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) * 1.5));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      samples.push([ax + (bx - ax) * t, ay + (by - ay) * t, (i + t) / (n - 1)]);
    }
  }
  samples.push([...pts[n - 1], 1]);
  for (const [x, y, t] of samples) {
    const r = r0 + (r1 - r0) * t;
    ball(P, x, y, r, r, base, o);
  }
}

/** 遊戲角色式的眼睛：深色光滑眼球＋大高光＋小反光 */
function eye(P, x, y, kind, o = {}) {
  const s = o.size ?? 1;
  const dark = o.dark ?? '#17101a';
  if (kind === 'happy') {
    P.curve(x - 2.8 * s, y + 1.2, x, y - 2.6 * s, x + 2.8 * s, y + 1.2, dark, 1.6);
    return;
  }
  if (kind === 'closed') {
    P.line(x - 2.8 * s, y + 0.5, x + 2.8 * s, y + 0.5, dark, 1.4);
    return;
  }
  if (kind === 'surprised') {
    P.ellipse(x, y, 2.6 * s, 3.2 * s, '#ffffff');
    P.ellipse(x + 0.3, y + 0.2, 1.1 * s, 1.4 * s, dark);
    P.dot(x - 0.2, y - 0.5, '#ffffff');
    return;
  }
  const h = kind === 'sleepy' ? 0.55 : kind === 'sad' ? 0.85 : 1;
  const ey = y + (1 - h) * 2 * s;
  // 眼球：深色，下方帶一點虹膜色的反射
  P.raw(x, ey, 2.5 * s, 3.3 * s * h, (nx, ny) => {
    const t = Math.max(0, ny) * 0.7;
    return mix(hex(dark), hex(o.iris ?? '#4a3a5a'), t);
  });
  if (o.slit) {
    // 貓：彩色虹膜＋直立瞳孔
    P.ellipse(x, ey, 2.1 * s, 2.9 * s * h, o.iris);
    P.ellipse(x, ey, 0.7 * s, 2.5 * s * h, dark);
  }
  P.ellipse(x - 0.9 * s, ey - 1.3 * s * h, 1.15 * s, 1.25 * s * h, '#ffffff');
  P.ellipse(x + 1 * s, ey + 1.5 * s * h, 0.5 * s, 0.5 * s, '#ffffff', 200);
  if (kind === 'focus') {
    // 認真：斜斜的眉骨壓在眼睛上方
    P.polyFn([[x - 3.4 * s, ey - 3.8 * s], [x + 3.2 * s, ey - 1.6 * s], [x + 3.4 * s, ey - 3.6 * s], [x - 3.4 * s, ey - 5.2 * s]], () => hex(o.brow ?? '#3a2a20'));
  }
  if (kind === 'sad') {
    P.line(x - 3 * s, ey - 2.4 * s, x + 2.6 * s, ey - 4 * s, o.brow ?? '#3a2a20', 0.9);
    P.ellipse(x + 1.6, ey + 3.6, 0.9, 1.4, '#8fd6ff', 230);
  }
}

/** 嘴巴：平常一條小弧線；開心時張嘴露出舌頭 */
function mouth(P, x, y, eyes) {
  if (eyes === 'happy' || eyes === 'surprised') {
    P.raw(x, y + 0.8, 2.4, 2, (nx, ny) => (ny < -0.15 ? [0, 0, 0, 0] : hex(ny > 0.4 ? '#ff7f8a' : '#5a1a26')));
    return;
  }
  if (eyes === 'sad') {
    P.curve(x - 1.8, y + 1.2, x, y - 0.4, x + 1.8, y + 1.2, INK, 0.7);
    return;
  }
  P.curve(x - 1.8, y, x, y + 1.2, x + 1.8, y, INK, 0.7);
}

/**
 * 共用骨架：結實的身體＋大頭＋四肢。各角色用 o.* 加上自己的特徵。
 * 頭部中心 (hx, hy)、身體中心 (cx, by)；角色面向右（3/4 側面）。
 */
function creature(P, p, o) {
  const cx = 31 + p.dx;
  const by = 47 + p.bob * 0.7;
  const hx = cx + 2;
  const hy = 26 + p.bob * 0.65;
  const fur = o.fur;
  const shade = o.shade ?? {};
  // 腳
  if (o.legs !== false) {
    for (const [lx, sgn] of [[-6, 1], [6, -1]]) {
      const x = cx + lx + sgn * p.legs * 0.8;
      tube(P, [[x, by + 6], [x, 58]], 3.6, 3.4, o.legColor ?? fur, shade);
      ball(P, x + 1.5, 60, 5, 2.8, o.footColor ?? o.legColor ?? fur, shade);
    }
  }
  o.behind?.(hx, hy, cx, by);
  // 後面那隻手
  const arm2 = [cx + p.arm2[0] * 0.8, 42 + p.bob * 0.7 + p.arm2[1] * 0.8];
  tube(P, [[cx - 4, by - 5], arm2], 3.2, 3.4, o.armColor ?? fur, shade);
  // 身體
  ball(P, cx, by, 12.5 * p.sx, 12 * p.sy, fur, shade);
  o.belly?.(cx, by);
  // 舉高的前手（扣殺、歡呼）畫在頭後面，避免手臂橫過臉
  const arm = [cx + p.arm[0] * 0.85, 42 + p.bob * 0.7 + p.arm[1] * 0.8];
  const raised = p.arm[1] < -10;
  if (raised) {
    tube(P, [[cx + 3, by - 5], arm], 3, 3.6, o.armColor ?? fur, shade);
    o.hand?.(arm[0], arm[1]);
  }
  // 頭
  o.headBack?.(hx, hy);
  ball(P, hx, hy, (o.headR ?? 16.5) * p.sx, (o.headRy ?? 15.5) * p.sy, o.headColor ?? fur, shade);
  o.head?.(hx, hy);
  // 臉
  const ey = hy + (o.eyeY ?? 0) * p.sy;
  const eo = { size: o.eyeSize ?? 1, iris: o.iris, slit: o.slit, brow: o.brow, dark: o.eyeDark };
  eye(P, hx + (o.eyeX1 ?? 3), ey, p.eyes, eo);
  eye(P, hx + (o.eyeX2 ?? 12), ey - 0.5, p.eyes, { ...eo, size: (o.eyeSize ?? 1) * 0.9 });
  if (o.mouth !== false) mouth(P, hx + (o.mouthX ?? 9), ey + (o.mouthY ?? 7), p.eyes);
  o.front?.(hx, hy);
  // 前面那隻手
  if (!raised) {
    tube(P, [[cx + 3, by - 5], arm], 3.2, 3.8, o.armColor ?? fur, shade);
    o.hand?.(arm[0], arm[1]);
  }
}

const CHARS = {
  kiki: {
    name: { 'zh-TW': '橘子', en: 'Kiki' },
    stats: { speed: 1, jump: 1, power: -1 },
    themeColor: '#F08A3C',
    outline: '#3a1a08',
    draw(P, p) {
      // 橘色虎斑貓：尖耳朵、額頭條紋、白色口鼻與胸口、長尾巴、綠色直瞳
      const fur = '#f08a3c', white = '#fbf3e8', stripe = '#b8551c';
      creature(P, p, {
        fur, iris: '#6ccf4a', slit: true, brow: '#a24a18',
        belly: (cx, by) => ball(P, cx + 3, by + 1, 7.5 * p.sx, 8 * p.sy, white),
        behind: (hx, hy, cx, by) => {
          const tw = p.tail;
          tube(P, [[cx - 9, by + 4], [cx - 18, by - 2 + tw * 0.5], [cx - 21, by - 14 + tw], [cx - 17, by - 22 + tw]], 3, 2.6, fur);
          for (const t of [[cx - 15, by + 1], [cx - 20, by - 8 + tw * 0.7]]) P.line(t[0] - 2, t[1], t[0] + 2, t[1] - 1, stripe, 1);
          // 尖耳朵
          slab(P, [[hx - 14, hy - 4], [hx - 12, hy - 21], [hx - 3, hy - 12]], fur);
          slab(P, [[hx + 3, hy - 13], [hx + 9, hy - 23], [hx + 14, hy - 5]], fur);
          slab(P, [[hx - 11.5, hy - 7], [hx - 11, hy - 16.5], [hx - 6, hy - 12]], '#f2a0a8');
          slab(P, [[hx + 5.5, hy - 12], [hx + 9, hy - 19], [hx + 11.5, hy - 7]], '#f2a0a8');
        },
        head: (hx, hy) => {
          // 額頭的虎斑
          for (const dx of [-3, 1, 5]) P.line(hx + dx, hy - 14, hx + dx + 0.6, hy - 9, stripe, 1.1);
          P.line(hx - 13, hy - 2, hx - 9, hy - 1, stripe, 1);
          // 白色口鼻
          ball(P, hx + 8, hy + 7 * p.sy, 8, 5.2, white);
          ball(P, hx + 9, hy + 3.6 * p.sy, 1.6, 1.1, '#e8707a', { gloss: 0.6 });
          // 鬍鬚
          for (const dy of [-0.5, 1.5]) P.line(hx + 15, hy + 6 + dy, hx + 21, hy + 5 + dy * 1.6, '#ffffff', 0.4);
        },
        eyeY: 0, mouthX: 9, mouthY: 7.5,
      });
    },
  },
  goldie: {
    name: { 'zh-TW': '金金', en: 'Goldie' },
    stats: { speed: 0, jump: 0, power: 0 },
    themeColor: '#E2A93B',
    outline: '#3a2408',
    draw(P, p) {
      // 黃金獵犬：垂耳、突出的口鼻、亮黑色鼻頭、蓬鬆胸毛與羽狀尾巴
      const fur = '#e8b04a', deep = '#c98a2a', cream = '#f8e2b0';
      creature(P, p, {
        fur, iris: '#6a3a1a', brow: '#9a6420',
        belly: (cx, by) => {
          ball(P, cx + 3, by - 1, 8 * p.sx, 8.5 * p.sy, cream);
        },
        behind: (hx, hy, cx, by) => {
          const tw = p.tail;
          tube(P, [[cx - 10, by + 2], [cx - 17, by - 3 + tw * 0.6], [cx - 21, by - 11 + tw]], 4, 3.4, fur);
          ball(P, cx - 22, by - 14 + tw, 3.6, 3.6, cream);
        },
        headBack: (hx, hy) => {
          // 垂耳（頭的後面那隻）
          ball(P, hx - 13, hy + 2, 5, 9, deep);
        },
        head: (hx, hy) => {
          // 口鼻
          ball(P, hx + 12, hy + 6 * p.sy, 8.5, 6, cream);
          ball(P, hx + 19, hy + 3.5 * p.sy, 2.6, 2, '#1e1416', { gloss: 0.8, shine: 40 });
          // 前面那隻垂耳（在眼睛後方，不擋臉）
          ball(P, hx - 9, hy + 3, 4.6, 8.5, deep);
        },
        eyeX1: 5, eyeX2: 13, eyeY: -1.5, mouthX: 14, mouthY: 9.5,
      });
    },
  },
  glidey: {
    name: { 'zh-TW': '滑滑', en: 'Glidey' },
    stats: { speed: -1, jump: 2, power: -1 },
    themeColor: '#9A7A5A',
    outline: '#241a10',
    draw(P, p) {
      // 白面鼯鼠：灰褐色毛、白色臉頰、超大的夜行性眼睛、手腳之間的滑翔膜、扁平大尾巴
      const fur = '#9a7a5a', white = '#f4ece0', membrane = '#7a5e44';
      creature(P, p, {
        fur, iris: '#3a2a4a', eyeSize: 1.35, brow: '#5a4430',
        belly: (cx, by) => ball(P, cx + 2, by + 1, 8 * p.sx, 8.5 * p.sy, white),
        behind: (hx, hy, cx, by) => {
          const tw = p.tail;
          // 扁平蓬鬆的尾巴
          ball(P, cx - 16, by - 4 + tw * 0.6, 6, 13, '#8a6a4a');
          ball(P, cx - 16, by - 12 + tw, 4.5, 6, '#6a5038');
          // 滑翔膜：從後手拉到腳
          const ax = cx + p.arm2[0] * 0.8, ay = 42 + p.bob * 0.7 + p.arm2[1] * 0.8;
          slab(P, [[ax, ay], [cx - 14, by - 2], [cx - 12, by + 9], [cx - 4, by + 10]], membrane);
          // 圓耳朵
          ball(P, hx - 9, hy - 13, 4.2, 4.6, fur);
          ball(P, hx + 6, hy - 14, 4.2, 4.6, fur);
        },
        head: (hx, hy) => {
          ball(P, hx + 6, hy + 4 * p.sy, 9.5, 7.5, white);
          ball(P, hx + 13, hy + 4 * p.sy, 1.6, 1.2, '#e8909a', { gloss: 0.6 });
          // 眼周深色毛
          P.ellipse(hx + 3.5, hy - 0.5, 4.2, 4.6, '#5a4430', 150);
          P.ellipse(hx + 13.5, hy - 1, 3.8, 4.2, '#5a4430', 150);
        },
        front: (hx, hy) => {
          // 前面那隻手的滑翔膜
          const cx = 31 + p.dx, by = 47 + p.bob * 0.7;
          const ax = cx + p.arm[0] * 0.85, ay = 42 + p.bob * 0.7 + p.arm[1] * 0.8;
          slab(P, [[ax, ay], [cx + 13, by + 2], [cx + 8, by + 10]], membrane);
          void hx; void hy;
        },
        eyeX1: 3.5, eyeX2: 13.5, eyeY: -0.5, mouthX: 11, mouthY: 7,
      });
    },
  },
  lanlan: {
    name: { 'zh-TW': '藍藍', en: 'Lanlan' },
    stats: { speed: 2, jump: 0, power: -1 },
    themeColor: '#2E6FD8',
    outline: '#0a1430',
    draw(P, p) {
      // 台灣藍鵲：黑頭、紅喙、黃色眼圈、寶藍色身體、長長的藍尾巴帶白色尖端、紅腳
      const blue = '#2e6fd8', black = '#1c1c28', red = '#e0302a';
      creature(P, p, {
        fur: blue, headColor: black, legColor: red, footColor: red, armColor: blue,
        iris: '#e8c840', eyeSize: 0.95, brow: '#0a0a12',
        shade: { gloss: 0.45, shine: 34 },
        belly: (cx, by) => ball(P, cx + 2, by + 2, 7 * p.sx, 7.5 * p.sy, '#6ea0ec'),
        behind: (hx, hy, cx, by) => {
          const tw = p.tail;
          // 長尾羽：兩根往後下方延伸，白色尖端
          for (const [dy, len] of [[0, 24], [4, 20]]) {
            const ex = cx - 10 - len, ey = by + 8 + dy + tw * 0.5;
            slab(P, [[cx - 8, by + 4 + dy * 0.5], [ex, ey - 2.4], [ex, ey + 2.4], [cx - 6, by + 8 + dy * 0.5]], blue);
            slab(P, [[ex + 5, ey - 2.2], [ex - 2, ey - 2.4], [ex - 2, ey + 2.4], [ex + 5, ey + 2.2]], '#ffffff');
          }
        },
        head: (hx, hy) => {
          // 紅色的喙
          slab(P, [[hx + 14, hy - 1 * p.sy], [hx + 24, hy + 2.5 * p.sy], [hx + 14, hy + 5 * p.sy]], red, { gloss: 0.5 });
          // 黃色眼圈
          P.ellipse(hx + 6, hy - 1, 3.6, 4.2, '#e8c840');
        },
        hand: (x, y) => {
          // 翅膀尖端的黑白斑
          ball(P, x + 1, y + 1, 3.6, 3, '#ffffff');
        },
        eyeX1: 6, eyeX2: 13.5, eyeY: -1, mouth: false,
      });
    },
  },
  yueyue: {
    name: { 'zh-TW': '月月', en: 'Yueyue' },
    stats: { speed: -2, jump: -1, power: 2 },
    themeColor: '#C8A07A',
    outline: '#000000',
    draw(P, p) {
      // 台灣黑熊：黑色毛（靠高光與背光呈現立體）、胸前白色 V 字月牙、淺褐色口鼻、圓耳
      const black = '#2a2a34';
      creature(P, p, {
        fur: black, iris: '#5a3a2a', brow: '#101016', eyeDark: '#08060a',
        shade: { gloss: 0.3, rim: 0.42, shadow: '#14142a' },
        headR: 17.5, headRy: 16,
        belly: (cx, by) => {
          // 白色 V 字月牙
          slab(P, [[cx - 7, by - 9], [cx + 1, by - 1], [cx + 10, by - 10], [cx + 10, by - 6.5], [cx + 1, by + 3], [cx - 7, by - 5.5]], '#f4f0e6');
        },
        behind: (hx, hy) => {
          ball(P, hx - 11, hy - 12, 5, 5, black, { rim: 0.42 });
          ball(P, hx + 7, hy - 14, 5, 5, black, { rim: 0.42 });
        },
        head: (hx, hy) => {
          ball(P, hx + 10, hy + 6 * p.sy, 8, 6, '#c8a07a');
          ball(P, hx + 16, hy + 3 * p.sy, 2.6, 2, '#120e10', { gloss: 0.8, shine: 40 });
        },
        eyeX1: 4, eyeX2: 12.5, eyeY: -2, mouthX: 13, mouthY: 9.5,
      });
    },
  },
  mikado: {
    name: { 'zh-TW': '帝帝', en: 'Mikado' },
    stats: { speed: 0, jump: 1, power: 1 },
    themeColor: '#6A7AE0',
    outline: '#080a18',
    draw(P, p) {
      // 帝雉（雄鳥）：深藍紫帶金屬光澤的羽毛、紅色臉部肉垂、白色翼斑、長尾羽上的白色橫斑、灰色腳
      const navy = '#24306a', red = '#d82a2a';
      creature(P, p, {
        fur: navy, legColor: '#8a8a96', footColor: '#8a8a96', armColor: navy,
        iris: '#5a3a1a', eyeSize: 0.95, brow: '#06060e',
        shade: { gloss: 0.6, shine: 22, rim: 0.4, shadow: '#120a2a' },
        belly: (cx, by) => ball(P, cx + 2, by + 1, 7 * p.sx, 8 * p.sy, '#3a4a9a', { gloss: 0.6, shine: 22 }),
        behind: (hx, hy, cx, by) => {
          const tw = p.tail;
          // 長尾羽：深藍底＋白色橫斑
          const ex = cx - 34, ey = by + 4 + tw * 0.6;
          slab(P, [[cx - 8, by - 2], [ex, ey - 3], [ex - 2, ey + 1], [cx - 7, by + 6]], navy, { gloss: 0.6 });
          for (let i = 1; i <= 4; i++) {
            const t = i / 5;
            const x = cx - 8 + (ex - (cx - 8)) * t, y = by + 2 + (ey - (by + 2)) * t;
            P.line(x, y - 3.2 + t, x - 1, y + 3 - t, '#f2f2f6', 1.1);
          }
          // 頭頂短冠羽
          slab(P, [[hx - 4, hy - 13], [hx - 9, hy - 21], [hx + 1, hy - 15]], navy, { gloss: 0.6 });
        },
        head: (hx, hy) => {
          // 紅色臉部肉垂（眼睛周圍）
          ball(P, hx + 6, hy - 0.5, 5.5, 5.8, red, { gloss: 0.4 });
          // 小喙
          slab(P, [[hx + 14, hy + 1 * p.sy], [hx + 21, hy + 3.5 * p.sy], [hx + 14, hy + 6 * p.sy]], '#c8c8b0', { gloss: 0.5 });
        },
        hand: (x, y) => {
          // 白色翼斑
          P.line(x - 3, y - 1, x + 2, y - 2, '#f2f2f6', 1);
        },
        eyeX1: 6, eyeX2: 13.5, eyeY: -1, mouth: false,
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
