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
  grow(1, (n) => mix(mix(n, [20, 10, 10], 0.55), T, 0.4));
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

// ---------- 日系 Q 版（參考 CLIP STUDIO「デフォルメキャラの描き方」） ----------
// 規則：
// 1. 頭身比約 1.5（布偶風）：大頭、小而圓的身體、短短的手腳。
// 2. 五官放在頭部中線以下，額頭寬大、看起來更幼小。
// 3. 大眼睛：深色外框＋角色色的虹膜漸層＋圓形大高光＋菱形小亮點，上眼線加粗。
// 4. 上色：底色＋柔和漸層（上亮下暗）＋一種清楚的陰影色（賽璐璐分界）＋邊緣高光。
// 5. 彩色線稿：外框用各部位顏色加深，不用純黑；最外圈再加一圈白邊（貼紙風）。
const INK = '#3a2418';

function hexMix(a, b, t) {
  const A = hex(a), B = hex(b);
  return '#' + [0, 1, 2].map((k) => Math.round(A[k] * (1 - t) + B[k] * t).toString(16).padStart(2, '0')).join('');
}

/**
 * 賽璐璐上色：tones = [陰影, 底色, 亮色]。
 * soft = true 時（布偶風）不畫硬陰影，只用柔和漸層。
 */
function cel(P, cx, cy, rx, ry, [shadow, baseC, light], soft = false) {
  P.raw(cx, cy, rx, ry, (nx, ny, d2) => {
    const nz = Math.sqrt(Math.max(0, 1 - d2));
    const d = -0.45 * nx - 0.62 * ny + 0.64 * nz; // 光從左上前方
    const top = Math.max(0, Math.min(1, (0.6 - ny) / 1.4));
    let c = mix(hex(baseC), hex(light), top * 0.45); // 上亮下暗的漸層
    if (!soft && d < 0.28) c = hex(shadow); // 一種清楚的陰影色
    else if (soft && d < 0.2) c = mix(c, hex(shadow), 0.55);
    if (d > 0.86 && d2 > 0.42) c = hex(light); // 邊緣高光
    return c;
  });
}

/** 日系大眼睛 */
function eye(P, x, y, kind, iris = '#6b3b1f', s = 1) {
  const dark = '#2a1618';
  if (kind === 'happy') {
    P.curve(x - 3 * s, y + 1, x, y - 3 * s, x + 3 * s, y + 1, dark, 1.4);
    return;
  }
  if (kind === 'closed') {
    P.curve(x - 3 * s, y, x, y + 1.6 * s, x + 3 * s, y, dark, 1.3);
    return;
  }
  if (kind === 'sad') {
    P.curve(x - 2.8 * s, y - 0.4, x, y + 2 * s, x + 2.8 * s, y - 0.4, dark, 1.2);
    P.ellipse(x + 0.8, y + 3.6, 1, 1.5, '#8fd6ff', 230);
    P.dot(x + 0.5, y + 3.2, '#ffffff');
    return;
  }
  if (kind === 'surprised') {
    P.ellipse(x, y, 2 * s, 2.6 * s, dark);
    P.ellipse(x - 0.5, y - 0.8, 0.8 * s, 0.9 * s, '#ffffff');
    P.curve(x - 2.6, y - 5.2, x, y - 6.2, x + 2.4, y - 4.8, dark, 0.8);
    return;
  }
  // open / focus / sleepy：深色外框 → 虹膜漸層 → 瞳孔 → 高光
  const h = kind === 'sleepy' ? 0.62 : 1;
  const ey = y + (1 - h) * 2.4 * s;
  P.ellipse(x, ey, 2.8 * s, 3.9 * s * h, dark);
  P.ellipse(x, ey + 0.9 * s * h, 2.15 * s, 2.7 * s * h, iris);
  P.ellipse(x, ey + 2 * s * h, 1.6 * s, 1.2 * s * h, hexMix(iris, '#ffffff', 0.45));
  P.ellipse(x, ey + 0.2 * s * h, 1.1 * s, 1.5 * s * h, '#140a0a');
  P.ellipse(x - 1.05 * s, ey - 1.5 * s * h, 1.15 * s, 1.35 * s * h, '#ffffff');
  P.poly([[x + 1.2 * s, ey + 1 * s], [x + 1.75 * s, ey + 1.7 * s], [x + 1.2 * s, ey + 2.4 * s], [x + 0.65 * s, ey + 1.7 * s]], '#ffffff');
  // 加粗的上眼線＋眼尾
  const top = ey - 3.6 * s * h;
  P.curve(x - 3.1 * s, top + 1.2, x, top - 1, x + 3.1 * s, top + 0.9, dark, 1.3);
  P.line(x + 2.9 * s, top + 0.9, x + 3.9 * s, top + 0.1, dark, 0.9);
  if (kind === 'focus') P.line(x - 3.2 * s, top - 2.4, x + 2.4 * s, top - 0.8, dark, 1.1);
  if (kind === 'sleepy') P.line(x - 3 * s, top + 0.8, x + 3 * s, top + 0.8, dark, 1.4);
}

/** 腮紅：柔和的粉紅＋日系的三條斜線 */
function blush(P, x, y, r = 3) {
  P.glow(x, y, r, '#ff8fa3', 190);
  for (let i = -1; i <= 1; i++) P.line(x + i * 1.3 - 0.6, y + 0.9, x + i * 1.3 + 0.6, y - 0.9, '#ee6b86', 0.45);
}

/** 嘴巴：ω（動物系）或小小的微笑；開心時張開 */
function mouth(P, x, y, kind, eyes) {
  if (eyes === 'happy' || eyes === 'surprised') {
    P.raw(x, y + 0.6, 2.2, 1.8, (nx, ny) => (ny < -0.1 ? [0, 0, 0, 0] : hex(ny > 0.45 ? '#ff8a9a' : '#8a2a3a')));
    return;
  }
  if (eyes === 'sad') {
    P.curve(x - 1.6, y + 1, x, y - 0.4, x + 1.6, y + 1, INK, 0.6);
    return;
  }
  if (kind === 'w') {
    P.curve(x - 2, y - 0.4, x - 1, y + 1.3, x, y - 0.1, INK, 0.6);
    P.curve(x, y - 0.1, x + 1, y + 1.3, x + 2, y - 0.4, INK, 0.6);
  } else {
    P.curve(x - 1.6, y - 0.2, x, y + 1.3, x + 1.6, y - 0.2, INK, 0.6);
  }
}

/** 共用骨架：大頭＋小身體＋短手短腳。回傳頭部中心，讓各角色畫自己的特徵 */
function chibi(P, p, o) {
  const cx = 31 + p.dx;
  const bodyY = 51 + p.bob * 0.7;
  const hx = cx + 1.5;
  // 頭的位置往下放、跳躍時的位移打折，避免耳朵、髮飾被畫框切掉
  const hy = 31.5 + p.bob * 0.65;
  // 腳
  if (o.feet !== false) {
    cel(P, cx - 6 + p.legs * 0.8, 60, 5, 3, o.limb);
    cel(P, cx + 6 - p.legs * 0.8, 60, 5, 3, o.limb);
  }
  // 頭後面的東西（尾巴、耳朵…）
  o.behind?.(hx, hy, cx, bodyY);
  // 身體：小而圓（A 字形）
  cel(P, cx, bodyY, 11.5 * p.sx, 9.5 * p.sy, o.body, o.soft);
  o.belly?.(cx, bodyY);
  // 後面那隻手
  cel(P, cx + p.arm2[0] * 0.8, 45 + p.bob * 0.7 + p.arm2[1] * 0.8, 3.4, 3.4, o.limb);
  // 大頭
  o.head(hx, hy);
  // 臉：五官在頭部中線以下
  const ey = hy + 3.5 * p.sy;
  const iris = o.iris;
  const ek = o.eyeMap?.(p.eyes) ?? p.eyes;
  eye(P, hx + 2, ey, ek, iris, o.eyeSize ?? 1);
  eye(P, hx + 12.5, ey - 0.6, ek, iris, (o.eyeSize ?? 1) * 0.92);
  blush(P, hx - 1, ey + 5.5, 3.2);
  blush(P, hx + 16, ey + 5, 2.6);
  mouth(P, hx + 7.6, ey + 6.2, o.mouth ?? 'smile', p.eyes);
  o.front?.(hx, hy);
  // 前面那隻手
  cel(P, cx + p.arm[0] * 0.85, 45 + p.bob * 0.7 + p.arm[1] * 0.8, 3.6, 3.6, o.limb);
}

const CHARS = {
  momo: {
    name: { 'zh-TW': '桃桃', en: 'Momo' },
    stats: { speed: 0, jump: 0, power: 0 },
    themeColor: '#F4A259',
    outline: '#7a3a14',
    draw(P, p) {
      const fur = ['#e08a4a', '#f6a865', '#ffd3a1'];
      const cream = ['#f0d2a8', '#fff3dd', '#ffffff'];
      chibi(P, p, {
        iris: '#7a4321',
        mouth: 'w',
        limb: ['#c9773d', '#e9965a', '#ffc58f'],
        body: fur,
        belly: (cx, by) => cel(P, cx + 2, by + 1.5, 7.5 * p.sx, 6.5 * p.sy, cream),
        head: (hx, hy) => {
          // 大大的圓耳朵（強調角色特徵）
          for (const [ex, ey] of [[-12, -13], [10, -15]]) {
            cel(P, hx + ex * p.sx, hy + ey * p.sy, 6, 6, fur);
            P.ellipse(hx + ex * p.sx + 0.6, hy + ey * p.sy + 0.6, 3.4, 3.4, '#ffb1c1');
          }
          cel(P, hx, hy, 19.5 * p.sx, 17 * p.sy, fur);
          // 下半臉的奶油色口鼻
          cel(P, hx + 7, hy + 9 * p.sy, 12 * p.sx, 7 * p.sy, cream);
          // 額頭一撮毛
          P.poly([[hx - 3, hy - 16 * p.sy], [hx + 1, hy - 21 * p.sy], [hx + 3, hy - 15 * p.sy]], '#f6a865');
          P.ellipse(hx + 7.6, hy + 7.4 * p.sy, 1.3, 1, '#a24b3a');
        },
      });
    },
  },
  yunyun: {
    name: { 'zh-TW': '雲雲', en: 'Yunyun' },
    stats: { speed: -1, jump: 2, power: -1 },
    themeColor: '#9FD3F5',
    outline: '#3f5f8f',
    draw(P, p) {
      const cloud = ['#b4cdea', '#e8f4ff', '#ffffff'];
      chibi(P, p, {
        iris: '#3c82d6',
        soft: true,
        limb: ['#a3c0e3', '#d4e8fb', '#ffffff'],
        body: cloud,
        head: (hx, hy) => {
          const s = (x, y, r) => cel(P, hx + x * p.sx, hy + y * p.sy, r * p.sx, r * p.sy, cloud, true);
          s(-14, 3, 9); s(14, 3, 9); s(-8, -9, 10); s(7, -11, 11); s(0, 2, 17);
          // 放大的雨滴髮飾（角色特徵）
          const tx = hx + 5, ty = hy - 22 * p.sy;
          P.poly([[tx, ty - 6], [tx - 4, ty + 2], [tx + 4, ty + 2]], '#6ab9ef');
          cel(P, tx, ty + 2.5, 4, 4, ['#4f9fdc', '#7cc8f4', '#e2f5ff']);
          P.dot(tx - 1.2, ty + 1.4, '#ffffff');
        },
      });
    },
  },
  kit: {
    name: { 'zh-TW': '小葉', en: 'Kit' },
    stats: { speed: 2, jump: -1, power: -1 },
    themeColor: '#7CC26B',
    outline: '#5a2410',
    draw(P, p) {
      const fur = ['#c45a2c', '#ec8048', '#ffb07a'];
      const white = ['#ead8c6', '#fff8ee', '#ffffff'];
      chibi(P, p, {
        iris: '#2f8f4e',
        mouth: 'w',
        limb: ['#6a3016', '#8c4622', '#b86a42'],
        body: fur,
        belly: (cx, by) => cel(P, cx + 2, by + 1.5, 6.5 * p.sx, 6 * p.sy, white),
        behind: (hx, hy, cx, by) => {
          // 大片的葉子尾巴
          const tw = p.tail;
          P.poly([[cx - 8, by + 2], [cx - 22, by - 8 + tw], [cx - 29, by - 24 + tw], [cx - 15, by - 17 + tw], [cx - 6, by - 3]], '#86cc6f');
          P.poly([[cx - 8, by + 1], [cx - 22, by - 8 + tw], [cx - 29, by - 24 + tw], [cx - 19, by - 11 + tw]], '#5fa652');
          P.line(cx - 8, by, cx - 27, by - 21 + tw, '#3f7d3a', 0.7);
          // 尖尖的大耳朵
          P.poly([[hx - 15, hy - 6], [hx - 13, hy - 25], [hx - 3, hy - 13]], '#ec8048');
          P.poly([[hx + 3, hy - 13], [hx + 10, hy - 26], [hx + 15, hy - 6]], '#ec8048');
          P.poly([[hx - 12.5, hy - 9], [hx - 12, hy - 20.5], [hx - 6, hy - 13]], '#4a2214');
          P.poly([[hx + 5.5, hy - 13], [hx + 10, hy - 21.5], [hx + 12.5, hy - 9]], '#4a2214');
        },
        head: (hx, hy) => {
          cel(P, hx, hy, 19 * p.sx, 16.5 * p.sy, fur);
          // 臉頰兩側的白毛
          cel(P, hx + 6, hy + 9 * p.sy, 13 * p.sx, 6.5 * p.sy, white);
          P.poly([[hx - 8, hy + 6], [hx - 18, hy + 9], [hx - 9, hy + 12]], '#fff8ee');
          // 額頭放大的葉片
          P.poly([[hx - 2, hy - 13], [hx + 3, hy - 21], [hx + 7, hy - 13], [hx + 2.5, hy - 10]], '#86cc6f');
          P.line(hx + 2.5, hy - 11, hx + 3, hy - 19, '#3f7d3a', 0.5);
          P.ellipse(hx + 7.6, hy + 7.2 * p.sy, 1.4, 1.1, '#2b1a14');
        },
      });
    },
  },
  taitai: {
    name: { 'zh-TW': '苔苔', en: 'Taitai' },
    stats: { speed: -2, jump: 0, power: 2 },
    themeColor: '#7FA36B',
    outline: '#2f4024',
    draw(P, p) {
      // 布偶風：不畫硬陰影，只用柔和漸層
      const moss = ['#5d8150', '#86ab70', '#b8d79c'];
      const belly = ['#d9d1b0', '#f2ecd3', '#fffdf0'];
      chibi(P, p, {
        iris: '#5a6f3a',
        soft: true,
        eyeMap: (e) => (e === 'open' ? 'sleepy' : e),
        eyeSize: 1.05,
        limb: ['#4f6a42', '#6d8e5a', '#93b27c'],
        body: moss,
        belly: (cx, by) => {
          cel(P, cx + 2, by + 1.5, 7.5 * p.sx, 6.5 * p.sy, belly, true);
          P.poly([[cx - 1, by + 4], [cx + 1.5, by - 1], [cx + 5, by - 1.5], [cx + 3.5, by + 2]], '#a9c88e');
        },
        head: (hx, hy) => {
          cel(P, hx, hy, 21 * p.sx, 18 * p.sy, moss, true);
          // 苔蘚的毛茸感
          for (const [x, y] of [[-15, -6], [-10, -13], [13, -11], [-4, -16], [17, 1]]) {
            P.line(hx + x * p.sx, hy + y * p.sy, hx + (x + 1.6) * p.sx, hy + (y - 2) * p.sy, '#5d8150', 0.6);
          }
          // 放大的頭頂嫩芽
          const top = hy - 17 * p.sy;
          P.line(hx + 1, top + 2, hx + 2, top - 5, '#5a8a3e', 1);
          P.poly([[hx + 2, top - 5], [hx - 7, top - 11], [hx - 9, top - 5], [hx, top - 2]], '#9bd27a');
          P.poly([[hx + 2, top - 5], [hx + 11, top - 12], [hx + 13, top - 6], [hx + 4, top - 2]], '#b5e48f');
          // 頭側的小紅菇
          cel(P, hx - 18 * p.sx, hy + 3 * p.sy, 4.4, 3, ['#b5402e', '#e0604a', '#ff9a84']);
          P.dot(hx - 19 * p.sx, hy + 2 * p.sy, '#ffffff');
          P.line(hx - 18 * p.sx, hy + 5 * p.sy, hx - 18 * p.sx, hy + 7 * p.sy, '#f3ead6', 1);
        },
      });
    },
  },
  tomo: {
    name: { 'zh-TW': '燈燈', en: 'Tomo' },
    stats: { speed: 1, jump: 1, power: -2 },
    themeColor: '#FFC86B',
    outline: '#6b4028',
    draw(P, p) {
      // 祭典紙燈籠精靈：燈籠就是大頭，身體是一團藍色小火焰
      const paper = ['#f0b45e', '#ffe6b0', '#fffaf0'];
      const flame = ['#4f7fe0', '#7fb0ff', '#d8ecff'];
      chibi(P, p, {
        iris: '#c0612b',
        feet: false,
        limb: ['#ffd27a', '#fff1c4', '#ffffff'],
        body: flame,
        behind: (hx, hy, cx) => {
          P.glow(hx, hy, 30, '#ffd27a', 110);
          const fl = p.legs * 0.6;
          P.poly([[cx - 7, 56], [cx - 3 + fl, 63], [cx, 57]], '#7fb0ff');
          P.poly([[cx, 57], [cx + 4 - fl, 63], [cx + 7, 56]], '#7fb0ff');
        },
        head: (hx, hy) => {
          cel(P, hx, hy, 18 * p.sx, 19 * p.sy, paper);
          for (const k of [-0.6, -0.22, 0.16, 0.52]) {
            const y = hy + k * 19 * p.sy;
            const half = 18 * p.sx * Math.sqrt(1 - k * k);
            P.curve(hx - half, y, hx, y + 1.4, hx + half, y, '#e2a456', 0.55);
          }
          cel(P, hx, hy - 18.5 * p.sy, 9.5, 3, ['#3f2618', '#5b3a29', '#8a5a40']);
          cel(P, hx, hy + 18.5 * p.sy, 8.5, 3, ['#3f2618', '#5b3a29', '#8a5a40']);
          P.curve(hx - 5, hy - 20 * p.sy, hx, hy - 29 * p.sy, hx + 5, hy - 20 * p.sy, '#5b3a29', 1);
          // 放大的紅流蘇
          P.line(hx - 2, hy + 21 * p.sy, hx - 3.5, hy + 27 * p.sy, '#e04a3e', 1.2);
          P.line(hx + 2, hy + 21 * p.sy, hx + 3.5, hy + 27 * p.sy, '#e04a3e', 1.2);
        },
      });
    },
  },
  mochi: {
    name: { 'zh-TW': '麻糬', en: 'Mochi' },
    stats: { speed: 1, jump: 1, power: -1 },
    themeColor: '#F7B7C8',
    outline: '#7a4a5a',
    draw(P, p) {
      const white = ['#e4dcef', '#ffffff', '#ffffff'];
      chibi(P, p, {
        iris: '#d0577a',
        mouth: 'w',
        eyeSize: 1.08,
        limb: ['#e4dcef', '#faf7ff', '#ffffff'],
        body: white,
        behind: (hx, hy) => {
          // 放大的長耳朵，往後飄
          const ew = p.tail * 0.6;
          for (const [x0, w] of [[-9, 6], [-1, 5.6]]) {
            cel(P, hx + x0 + ew * 0.3, hy - 17 * p.sy + ew * 0.6, w, 11, white);
            P.ellipse(hx + x0 + 1 + ew * 0.3, hy - 16 * p.sy + ew * 0.6, w * 0.45, 7.5, '#f8c5d2');
          }
        },
        head: (hx, hy) => {
          cel(P, hx, hy, 19.5 * p.sx, 17.5 * p.sy, white);
          // 放大的櫻花髮飾
          const fx = hx + 11, fy = hy - 13 * p.sy;
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
            P.ellipse(fx + Math.cos(a) * 2.6, fy + Math.sin(a) * 2.6, 2.1, 2.1, '#f59ab3');
          }
          P.ellipse(fx, fy, 1.2, 1.2, '#ffe28a');
          P.ellipse(hx + 7.6, hy + 7.2 * p.sy, 1.1, 0.9, '#e57b96');
        },
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
