// 背景：新海誠式的夏日海邊——深藍到暖橘的天空、太陽光暈與光束、被陽光鑲邊的積雲、
// 閃閃發光的海面、遠方的島影，以及漂浮在空中的光點與鏡頭光斑。
// 靜態部分預先畫進離屏畫布（依裝置解析度），每幀只畫會動的雲、波光、光點。

const SUN = { x: 330, y: 58 };
const HORIZON = 150;
const SHORE = 196;

function rng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Cloud {
  img: HTMLCanvasElement;
  w: number;
  h: number;
  x: number;
  y: number;
  speed: number;
}

interface Mote {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  phase: number;
}

/** 在 g 上（邏輯座標）畫一朵積雲：陰影 → 中間調 → 受光面 → 暖色鑲邊，底部切平 */
function paintCumulus(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number, warm: number) {
  const rand = rng(seed);
  const puffs: { px: number; py: number; r: number }[] = [];
  const n = 9 + Math.floor(rand() * 7);
  for (let i = 0; i < n; i++) {
    const t = (i + rand() * 0.6) / n;
    const bell = Math.sin(t * Math.PI);
    const r = h * (0.22 + 0.42 * bell * (0.7 + rand() * 0.5));
    puffs.push({ px: x + t * w, py: y + h - r * (0.75 + rand() * 0.25) - bell * h * 0.25, r });
  }
  // 頂部的小雲團
  for (let i = 0; i < 4; i++) {
    const t = 0.3 + rand() * 0.4;
    puffs.push({ px: x + t * w, py: y + h * (0.25 + rand() * 0.2), r: h * (0.18 + rand() * 0.14) });
  }
  const circle = (px: number, py: number, r: number) => {
    g.beginPath();
    g.arc(px, py, Math.max(0.5, r), 0, Math.PI * 2);
    g.fill();
  };
  g.fillStyle = '#aebbe0';
  for (const p of puffs) circle(p.px, p.py, p.r);
  g.fillStyle = '#e6edf9';
  for (const p of puffs) circle(p.px - p.r * 0.1, p.py - p.r * 0.16, p.r * 0.88);
  g.fillStyle = '#ffffff';
  for (const p of puffs) circle(p.px - p.r * 0.2, p.py - p.r * 0.3, p.r * 0.6);
  // 朝太陽那側的暖色鑲邊
  g.globalCompositeOperation = 'source-atop';
  const rim = g.createLinearGradient(x + w, y, x, y + h);
  rim.addColorStop(0, `rgba(255,214,160,${0.45 * warm})`);
  rim.addColorStop(0.5, 'rgba(255,240,220,0)');
  g.fillStyle = rim;
  g.fillRect(x - h, y - h, w + 2 * h, h * 2.2);
  // 底部陰影
  const sh = g.createLinearGradient(0, y + h * 0.55, 0, y + h);
  sh.addColorStop(0, 'rgba(120,130,185,0)');
  sh.addColorStop(1, 'rgba(120,130,185,0.45)');
  g.fillStyle = sh;
  g.fillRect(x - h, y, w + 2 * h, h * 1.2);
  // 切平底部
  g.globalCompositeOperation = 'destination-out';
  g.fillRect(x - h, y + h, w + 2 * h, h);
  g.globalCompositeOperation = 'source-over';
}

/** 把一朵雲畫在獨立的畫布上（避免鑲邊、陰影的合成模式影響到底下的天空） */
function cloudCanvas(k: number, w: number, h: number, seed: number, warm: number) {
  const pad = h;
  const c = document.createElement('canvas');
  c.width = Math.ceil((w + pad * 2) * k);
  c.height = Math.ceil((h + pad) * k);
  const g = c.getContext('2d')!;
  g.setTransform(k, 0, 0, k, pad * k, pad * k);
  paintCumulus(g, 0, 0, w, h, seed, warm);
  return { img: c, pad };
}

export class Scenery {
  private layer: HTMLCanvasElement | null = null;
  private key = '';
  private clouds: Cloud[] = [];
  private motes: Mote[] = [];
  private sparkles: { x: number; y: number; w: number; phase: number; speed: number }[] = [];

  constructor() {
    const r = rng(7);
    for (let i = 0; i < 26; i++) {
      this.motes.push({ x: r() * 600 - 80, y: r() * 260, r: 0.6 + r() * 1.6, vx: 0.004 + r() * 0.01, vy: -0.004 - r() * 0.008, phase: r() * 6.28 });
    }
    for (let i = 0; i < 90; i++) {
      // 越靠近太陽倒影的位置，波光越密
      const nearSun = r() < 0.45;
      const x = nearSun ? SUN.x + (r() - 0.5) * 70 : r() * 640 - 100;
      const y = HORIZON + 2 + Math.pow(r(), 1.4) * (SHORE - HORIZON - 6);
      this.sparkles.push({ x, y, w: 1.5 + r() * (y - HORIZON) * 0.12, phase: r() * 6.28, speed: 0.002 + r() * 0.004 });
    }
  }

  /** 依目前畫面（邏輯座標可見範圍、裝置倍率）重建靜態圖層 */
  private ensure(k: number, L: number, T: number, R: number, B: number) {
    const key = `${k.toFixed(3)}|${L.toFixed(1)}|${T.toFixed(1)}|${R.toFixed(1)}|${B.toFixed(1)}`;
    if (key === this.key && this.layer) return;
    this.key = key;
    const c = this.layer ?? document.createElement('canvas');
    c.width = Math.max(1, Math.round((R - L) * k));
    c.height = Math.max(1, Math.round((B - T) * k));
    const g = c.getContext('2d')!;
    g.setTransform(k, 0, 0, k, -L * k, -T * k);
    this.paintStatic(g, L, T, R, B);
    this.layer = c;
    this.buildClouds(k);
  }

  private paintStatic(g: CanvasRenderingContext2D, L: number, T: number, R: number, B: number) {
    const W = R - L;
    // 天空：上方深藍、往地平線漸亮，貼近海面帶一點暖色
    const sky = g.createLinearGradient(0, Math.min(T, -40), 0, HORIZON + 2);
    sky.addColorStop(0, '#0a3a8c');
    sky.addColorStop(0.35, '#1f68c9');
    sky.addColorStop(0.7, '#6fb3ee');
    sky.addColorStop(0.9, '#bfe0f7');
    sky.addColorStop(1, '#ffe2c4');
    g.fillStyle = sky;
    g.fillRect(L, T, W, HORIZON + 2 - T);

    // 太陽光暈
    const glow = g.createRadialGradient(SUN.x, SUN.y, 0, SUN.x, SUN.y, 190);
    glow.addColorStop(0, 'rgba(255,253,240,1)');
    glow.addColorStop(0.08, 'rgba(255,248,225,0.9)');
    glow.addColorStop(0.25, 'rgba(255,232,190,0.35)');
    glow.addColorStop(1, 'rgba(255,220,180,0)');
    g.fillStyle = glow;
    g.fillRect(L, T, W, HORIZON + 2 - T);

    // 光束
    g.save();
    g.globalCompositeOperation = 'lighter';
    const rays = rng(3);
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * (0.15 + rays() * 0.95);
      const spread = 0.03 + rays() * 0.06;
      const len = 260 + rays() * 120;
      const grad = g.createRadialGradient(SUN.x, SUN.y, 10, SUN.x, SUN.y, len);
      grad.addColorStop(0, 'rgba(255,245,220,0.1)');
      grad.addColorStop(1, 'rgba(255,245,220,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(SUN.x, SUN.y);
      g.lineTo(SUN.x + Math.cos(a - spread) * len, SUN.y + Math.sin(a - spread) * len);
      g.lineTo(SUN.x + Math.cos(a + spread) * len, SUN.y + Math.sin(a + spread) * len);
      g.closePath();
      g.fill();
    }
    g.restore();

    // 地平線上的雲堤
    const k = g.getTransform().a;
    for (let i = 0; i < 7; i++) {
      const cw = 70 + (i % 3) * 30;
      const ch = 16 + (i % 2) * 8;
      const cx = L - 30 + ((W + 60) / 7) * i + ((i * 37) % 24);
      const warm = 1 - Math.min(1, Math.abs(cx + cw / 2 - SUN.x) / 300);
      const { img, pad } = cloudCanvas(k, cw, ch, 100 + i, warm);
      g.drawImage(img, cx - pad, HORIZON - ch - 2 - pad, cw + pad * 2, ch + pad);
    }
    // 雲堤前的地平線霧氣
    const haze = g.createLinearGradient(0, HORIZON - 30, 0, HORIZON + 2);
    haze.addColorStop(0, 'rgba(255,236,214,0)');
    haze.addColorStop(1, 'rgba(255,236,214,0.75)');
    g.fillStyle = haze;
    g.fillRect(L, HORIZON - 30, W, 32);

    // 遠方島影
    const island = (x: number, w: number, h: number) => {
      g.fillStyle = 'rgba(86,122,170,0.75)';
      g.beginPath();
      g.moveTo(x, HORIZON + 1);
      g.quadraticCurveTo(x + w * 0.25, HORIZON - h, x + w * 0.5, HORIZON - h * 0.85);
      g.quadraticCurveTo(x + w * 0.75, HORIZON - h * 0.7, x + w, HORIZON + 1);
      g.fill();
      g.fillStyle = 'rgba(200,220,240,0.35)';
      g.fillRect(x + w * 0.15, HORIZON - 1, w * 0.7, 1);
    };
    island(L + 20, 70, 9);
    island(150, 46, 6);
    island(R - 120, 90, 12);

    // 海：近地平線偏亮、近岸轉為透明的青綠
    const sea = g.createLinearGradient(0, HORIZON, 0, SHORE + 2);
    sea.addColorStop(0, '#5fa7e0');
    sea.addColorStop(0.15, '#2777c4');
    sea.addColorStop(0.6, '#1993bd');
    sea.addColorStop(1, '#58d2cf');
    g.fillStyle = sea;
    g.fillRect(L, HORIZON, W, SHORE + 2 - HORIZON);
    // 太陽在海面的倒影
    const refl = g.createLinearGradient(SUN.x - 40, 0, SUN.x + 40, 0);
    refl.addColorStop(0, 'rgba(255,240,210,0)');
    refl.addColorStop(0.5, 'rgba(255,240,210,0.45)');
    refl.addColorStop(1, 'rgba(255,240,210,0)');
    g.fillStyle = refl;
    g.fillRect(SUN.x - 40, HORIZON, 80, SHORE - HORIZON);

    // 沙灘：暖色漸層＋細沙質感，靠海處是濕沙
    const sand = g.createLinearGradient(0, SHORE, 0, B);
    sand.addColorStop(0, '#d8b98d');
    sand.addColorStop(0.06, '#f7e1ae');
    sand.addColorStop(0.5, '#efcf92');
    sand.addColorStop(1, '#ddb172');
    g.fillStyle = sand;
    g.fillRect(L, SHORE, W, B - SHORE);
    const grain = rng(11);
    for (let i = 0; i < W * 2.2; i++) {
      const x = L + grain() * W;
      const y = SHORE + 6 + grain() * (B - SHORE - 6);
      g.fillStyle = grain() < 0.5 ? 'rgba(170,120,60,0.22)' : 'rgba(255,250,235,0.35)';
      g.fillRect(x, y, 0.8, 0.8);
    }
    // 貝殼與小石頭
    for (let i = 0; i < 10; i++) {
      const x = L + grain() * W;
      const y = 262 + grain() * 36;
      g.fillStyle = i % 3 ? 'rgba(255,240,230,0.9)' : 'rgba(240,170,170,0.9)';
      g.beginPath();
      g.ellipse(x, y, 1.6, 1.1, 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  private buildClouds(k: number) {
    const specs = [
      { x: 10, y: 14, w: 100, h: 36, speed: 0.0016, seed: 1 },
      { x: 200, y: 62, w: 64, h: 22, speed: 0.0011, seed: 2 },
      { x: 400, y: 8, w: 120, h: 42, speed: 0.002, seed: 3 },
      { x: 120, y: 96, w: 46, h: 14, speed: 0.0008, seed: 4 },
    ];
    this.clouds = specs.map((s) => {
      const { img, pad } = cloudCanvas(k, s.w, s.h, s.seed * 31, 0.7);
      return { img, w: s.w + pad * 2, h: s.h + pad, x: s.x - pad, y: s.y - pad, speed: s.speed };
    });
  }

  /** 天空到沙灘（在角色之前畫） */
  draw(ctx: CanvasRenderingContext2D, time: number, k: number, L: number, T: number, R: number, B: number) {
    this.ensure(k, L, T, R, B);
    const smooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.layer!, L, T, R - L, B - T);

    // 飄動的雲
    const span = R - L;
    for (const c of this.clouds) {
      const total = span + c.w;
      const x = L - c.w + ((((c.x - L + c.w + time * c.speed) % total) + total) % total);
      ctx.drawImage(c.img, x, c.y, c.w, c.h);
    }

    // 波光
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.sparkles) {
      if (s.x < L - 10 || s.x > R + 10) continue;
      const a = Math.sin(time * s.speed + s.phase);
      if (a <= 0.2) continue;
      ctx.fillStyle = `rgba(255,250,235,${(a - 0.2) * 0.9})`;
      ctx.fillRect(s.x - s.w / 2, s.y, s.w, 0.8);
    }
    ctx.restore();

    // 浪花：兩層起伏的白色泡沫線
    for (let layer = 0; layer < 2; layer++) {
      const base = SHORE - 1 + layer * 3;
      ctx.fillStyle = layer ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.moveTo(L, base + 6);
      for (let x = Math.floor(L); x <= R + 4; x += 4) {
        const y = base + Math.sin(x * 0.08 + time * (layer ? 0.0017 : 0.0024)) * 1.2 + Math.sin(x * 0.021 - time * 0.001) * 1.4;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(R + 4, base + 6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(120,200,210,0.25)';
    ctx.fillRect(L, SHORE + 4, R - L, 2);
    ctx.imageSmoothingEnabled = smooth;
  }

  /** 最上層：漂浮光點與鏡頭光斑（在所有東西之後畫） */
  drawOverlay(ctx: CanvasRenderingContext2D, time: number, L: number, T: number, R: number, B: number) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const w = R - L;
    const h = B - T;
    for (const m of this.motes) {
      const x = L + ((((m.x + time * m.vx) - L) % w) + w) % w;
      const y = T + ((((m.y + time * m.vy) - T) % h) + h) % h;
      const a = 0.25 + 0.25 * Math.sin(time * 0.002 + m.phase);
      const g = ctx.createRadialGradient(x, y, 0, x, y, m.r * 3);
      g.addColorStop(0, `rgba(255,248,220,${a})`);
      g.addColorStop(1, 'rgba(255,248,220,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - m.r * 3, y - m.r * 3, m.r * 6, m.r * 6);
    }
    // 鏡頭光斑：沿著太陽到畫面中心的連線
    const cx = 216, cy = 170;
    const flares = [
      { t: 0.35, r: 7, c: '255,230,180', a: 0.12 },
      { t: 0.6, r: 14, c: '180,220,255', a: 0.08 },
      { t: 0.95, r: 5, c: '255,200,160', a: 0.14 },
      { t: 1.3, r: 22, c: '170,210,255', a: 0.06 },
    ];
    const pulse = 0.85 + 0.15 * Math.sin(time * 0.0012);
    for (const f of flares) {
      const x = SUN.x + (cx - SUN.x) * f.t;
      const y = SUN.y + (cy - SUN.y) * f.t;
      const g = ctx.createRadialGradient(x, y, f.r * 0.2, x, y, f.r);
      g.addColorStop(0, `rgba(${f.c},${f.a * pulse})`);
      g.addColorStop(0.8, `rgba(${f.c},${f.a * 0.6 * pulse})`);
      g.addColorStop(1, `rgba(${f.c},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, f.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
