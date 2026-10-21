// 背景場景（可在設定中選擇）：
// - beach 夏日海灘：深藍到暖橘的天空、太陽光暈與光束、受光積雲、閃亮海面、島影、漂浮光點與鏡頭光斑。
// - lake  黃昏湖畔：群山環抱的湖、山稜後的夕陽、粉橘色的雲、對岸亮起的燈火、湖面倒影。
// - comet 彗星之夜：滿天星斗與銀河、拖著兩道尾巴並分裂出碎片的彗星、流星、倒映星光的山中湖泊。
// - taipei 信義夜景、zoo 木柵動物園：見 cityzoo.ts。
// - ntu 台大椰林大道、songshan 松菸大巨蛋、expo 圓山花博、yangming 陽明山溫泉、tamsui 淡水夕陽：見 landmarks.ts。
// - kinmen 金門、wuling 武陵：見 islands.ts。
// 靜態部分預先畫進離屏畫布（依裝置解析度），每幀只畫會動的雲、波光、星星、流星與光點。


export type SceneId = 'beach' | 'lake' | 'comet' | 'taipei' | 'zoo' | 'ntu' | 'songshan' | 'expo' | 'yangming' | 'tamsui' | 'kinmen' | 'wuling';
export const SCENES: SceneId[] = ['beach', 'lake', 'comet', 'taipei', 'zoo', 'ntu', 'songshan', 'expo', 'yangming', 'tamsui', 'kinmen', 'wuling'];

type Painter = (g: CanvasRenderingContext2D, L: number, T: number, R: number, B: number) => void;
type Animator = (ctx: CanvasRenderingContext2D, time: number, L: number, R: number) => void;

/** 景點場景（台北系列）：第一次用到時才下載，減少首次載入的大小 */
const LANDMARK_IDS = new Set<SceneId>(['taipei', 'zoo', 'ntu', 'songshan', 'expo', 'yangming', 'tamsui', 'kinmen', 'wuling']);
let LANDMARKS: Partial<Record<SceneId, { paint: Painter; draw: Animator }>> | null = null;
let landmarksLoading: Promise<void> | null = null;

export function loadLandmarks(): Promise<void> {
  landmarksLoading ??= Promise.all([import('./cityzoo'), import('./landmarks'), import('./islands')]).then(([c, l, i]) => {
    LANDMARKS = {
      taipei: { paint: c.paintTaipei, draw: c.drawTaipei },
      zoo: { paint: c.paintZoo, draw: c.drawZoo },
      ntu: { paint: l.paintNtu, draw: l.drawNtu },
      songshan: { paint: l.paintSongshan, draw: l.drawSongshan },
      expo: { paint: l.paintExpo, draw: l.drawExpo },
      yangming: { paint: l.paintYangming, draw: l.drawYangming },
      tamsui: { paint: l.paintTamsui, draw: l.drawTamsui },
      kinmen: { paint: i.paintKinmen, draw: i.drawKinmen },
      wuling: { paint: i.paintWuling, draw: i.drawWuling },
    };
  });
  return landmarksLoading;
}

/** 景點場景還在下載時的暫代畫面：簡單的天空與地面 */
function paintPlaceholder(g: CanvasRenderingContext2D, L: number, T: number, R: number, B: number) {
  const sky = g.createLinearGradient(0, T, 0, B);
  sky.addColorStop(0, '#3f6fb0');
  sky.addColorStop(0.5, '#a9c8e6');
  sky.addColorStop(0.65, '#d8c4a0');
  sky.addColorStop(1, '#b89a74');
  g.fillStyle = sky;
  g.fillRect(L, T, R - L, B - T);
}

/** 白天場景用光點＋鏡頭光斑；其他場景用色調（multiply）＋光點顏色（null = 不放光點） */
const DAY_SCENES = new Set<SceneId>(['beach', 'zoo', 'ntu', 'expo', 'kinmen', 'wuling']);
const TINTS: Partial<Record<SceneId, { tint: string; motes: string | null }>> = {
  lake: { tint: 'rgb(255,226,214)', motes: '255,220,150' },
  comet: { tint: 'rgb(178,186,236)', motes: '190,255,170' },
  taipei: { tint: 'rgb(206,196,236)', motes: null },
  tamsui: { tint: 'rgb(255,214,190)', motes: '255,220,150' },
  yangming: { tint: 'rgb(255,242,230)', motes: '255,240,210' },
  songshan: { tint: 'rgb(255,238,222)', motes: '255,225,170' },
};

const SUN = { x: 330, y: 58 };
/** 黃昏湖畔：夕陽貼近山稜 */
const DUSK_SUN = { x: 300, y: 122 };
/** 彗星之夜：彗星頭的位置 */
const COMET = { x: 318, y: 46 };
export const HORIZON = 150;
export const SHORE = 196;

export function rng(seed: number) {
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

type Sparkle = { x: number; y: number; w: number; phase: number; speed: number };

/** 雲的配色：陰影、中間調、受光、鑲邊（r,g,b）、底部陰影（r,g,b） */
interface CloudPal {
  shadow: string;
  mid: string;
  light: string;
  rim: string;
  under: string;
}
const DAY: CloudPal = { shadow: '#aebbe0', mid: '#e6edf9', light: '#ffffff', rim: '255,214,160', under: '120,130,185' };
const DUSK: CloudPal = { shadow: '#8a6f9e', mid: '#e7a3a8', light: '#ffd2a1', rim: '255,170,110', under: '90,70,130' };

/** 在 g 上（邏輯座標）畫一朵積雲：陰影 → 中間調 → 受光面 → 暖色鑲邊，底部切平 */
function paintCumulus(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number, warm: number, pal: CloudPal) {
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
  g.fillStyle = pal.shadow;
  for (const p of puffs) circle(p.px, p.py, p.r);
  g.fillStyle = pal.mid;
  for (const p of puffs) circle(p.px - p.r * 0.1, p.py - p.r * 0.16, p.r * 0.88);
  g.fillStyle = pal.light;
  for (const p of puffs) circle(p.px - p.r * 0.2, p.py - p.r * 0.3, p.r * 0.6);
  // 朝太陽那側的暖色鑲邊
  g.globalCompositeOperation = 'source-atop';
  const rim = g.createLinearGradient(x + w, y, x, y + h);
  rim.addColorStop(0, `rgba(${pal.rim},${0.45 * warm})`);
  rim.addColorStop(0.5, 'rgba(255,240,220,0)');
  g.fillStyle = rim;
  g.fillRect(x - h, y - h, w + 2 * h, h * 2.2);
  // 底部陰影
  const sh = g.createLinearGradient(0, y + h * 0.55, 0, y + h);
  sh.addColorStop(0, `rgba(${pal.under},0)`);
  sh.addColorStop(1, `rgba(${pal.under},0.45)`);
  g.fillStyle = sh;
  g.fillRect(x - h, y, w + 2 * h, h * 1.2);
  // 切平底部
  g.globalCompositeOperation = 'destination-out';
  g.fillRect(x - h, y + h, w + 2 * h, h);
  g.globalCompositeOperation = 'source-over';
}

/** 把一朵雲畫在獨立的畫布上（避免鑲邊、陰影的合成模式影響到底下的天空） */
function cloudCanvas(k: number, w: number, h: number, seed: number, warm: number, pal: CloudPal = DAY) {
  const pad = h;
  const c = document.createElement('canvas');
  c.width = Math.ceil((w + pad * 2) * k);
  c.height = Math.ceil((h + pad) * k);
  const g = c.getContext('2d')!;
  g.setTransform(k, 0, 0, k, pad * k, pad * k);
  paintCumulus(g, 0, 0, w, h, seed, warm, pal);
  return { img: c, pad };
}

function makeSparkles(seed: number, cx: number, count: number, near: number): Sparkle[] {
  const r = rng(seed);
  const out: Sparkle[] = [];
  for (let i = 0; i < count; i++) {
    // 越靠近太陽（或彗星）倒影的位置，波光越密
    const nearSun = r() < near;
    const x = nearSun ? cx + (r() - 0.5) * 70 : r() * 640 - 100;
    const y = HORIZON + 2 + Math.pow(r(), 1.4) * (SHORE - HORIZON - 6);
    out.push({ x, y, w: 1.5 + r() * (y - HORIZON) * 0.12, phase: r() * 6.28, speed: 0.002 + r() * 0.004 });
  }
  return out;
}

/** 山稜線：由 baseY 往上、以多個正弦疊出起伏；basin > 0 時兩側拉高，形成盆地 */
export function ridge(
  g: CanvasRenderingContext2D, L: number, R: number, baseY: number, height: number, seed: number,
  fill: string | CanvasGradient, basin = 0,
) {
  const r = rng(seed);
  const ph = [r() * 6, r() * 6, r() * 6];
  g.fillStyle = fill;
  g.beginPath();
  g.moveTo(L, baseY);
  for (let x = L; x <= R + 4; x += 4) {
    const t = (x - L) / (R - L);
    const edge = basin * Math.pow(Math.abs(t - 0.5) * 2, 3);
    const wave = 0.55 + 0.25 * Math.sin(x * 0.018 + ph[0]) + 0.14 * Math.sin(x * 0.047 + ph[1]) + 0.06 * Math.sin(x * 0.13 + ph[2]);
    g.lineTo(x, baseY - height * wave - edge);
  }
  g.lineTo(R + 4, baseY);
  g.closePath();
  g.fill();
}

/** 遠岸小鎮的燈火 */
function townLights(g: CanvasRenderingContext2D, L: number, R: number, seed: number, count: number, alpha: number) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = L + r() * (R - L);
    const y = HORIZON - 1 - Math.pow(r(), 2) * 9;
    const c = r() < 0.7 ? '255,214,140' : '255,240,220';
    const glow = g.createRadialGradient(x, y, 0, x, y, 2.4);
    glow.addColorStop(0, `rgba(${c},${alpha})`);
    glow.addColorStop(1, `rgba(${c},0)`);
    g.fillStyle = glow;
    g.fillRect(x - 2.4, y - 2.4, 4.8, 4.8);
  }
}

/** 湖畔的地面（沙地＋畫面下緣的草）；night = 夜晚色調 */
function paintShore(g: CanvasRenderingContext2D, L: number, R: number, B: number, night: boolean) {
  const W = R - L;
  const ground = g.createLinearGradient(0, SHORE, 0, B);
  if (night) {
    ground.addColorStop(0, '#3b4466');
    ground.addColorStop(0.08, '#5a6185');
    ground.addColorStop(1, '#353a5a');
  } else {
    ground.addColorStop(0, '#9c7d6a');
    ground.addColorStop(0.07, '#e8c79c');
    ground.addColorStop(0.5, '#ddb488');
    ground.addColorStop(1, '#bf9070');
  }
  g.fillStyle = ground;
  g.fillRect(L, SHORE, W, B - SHORE);
  const grain = rng(23);
  for (let i = 0; i < W * 1.8; i++) {
    const x = L + grain() * W;
    const y = SHORE + 6 + grain() * (B - SHORE - 6);
    const dark = grain() < 0.5;
    g.fillStyle = night
      ? (dark ? 'rgba(20,24,50,0.3)' : 'rgba(170,180,230,0.18)')
      : (dark ? 'rgba(120,80,50,0.2)' : 'rgba(255,240,220,0.3)');
    g.fillRect(x, y, 0.8, 0.8);
  }
  for (let i = 0; i < W / 3; i++) {
    const x = L + grain() * W;
    const h = 3 + grain() * 5;
    g.strokeStyle = night ? 'rgba(40,70,70,0.8)' : 'rgba(90,130,60,0.75)';
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(x, B);
    g.quadraticCurveTo(x + 1, B - h * 0.6, x + (grain() - 0.5) * 4, B - h);
    g.stroke();
  }
}

export class Scenery {
  private theme: SceneId = 'beach';
  private layer: HTMLCanvasElement | null = null;
  private key = '';
  private clouds: Cloud[] = [];
  private motes: Mote[] = [];
  private sparkles: Sparkle[] = makeSparkles(7, SUN.x, 90, 0.45);
  private duskSparkles: Sparkle[] = makeSparkles(8, DUSK_SUN.x, 70, 0.7);
  private nightSparkles: Sparkle[] = makeSparkles(9, COMET.x, 60, 0.5);
  private stars: { x: number; y: number; r: number; phase: number }[] = [];

  constructor() {
    const r = rng(7);
    for (let i = 0; i < 26; i++) {
      this.motes.push({ x: r() * 600 - 80, y: r() * 260, r: 0.6 + r() * 1.6, vx: 0.004 + r() * 0.01, vy: -0.004 - r() * 0.008, phase: r() * 6.28 });
    }
    // 會閃爍的亮星
    for (let i = 0; i < 60; i++) this.stars.push({ x: r() * 640 - 100, y: -40 + r() * 170, r: 0.5 + r() * 0.9, phase: r() * 6.28 });
  }

  setTheme(t: SceneId) {
    if (t !== this.theme) {
      this.theme = t;
      this.key = '';
    }
  }

  /** 依目前畫面（邏輯座標可見範圍、裝置倍率）重建靜態圖層 */
  private ensure(k: number, L: number, T: number, R: number, B: number) {
    const key = `${this.theme}|${k.toFixed(3)}|${L.toFixed(1)}|${T.toFixed(1)}|${R.toFixed(1)}|${B.toFixed(1)}`;
    if (key === this.key && this.layer) return;
    this.key = key;
    const c = this.layer ?? document.createElement('canvas');
    c.width = Math.max(1, Math.round((R - L) * k));
    c.height = Math.max(1, Math.round((B - T) * k));
    const g = c.getContext('2d')!;
    g.setTransform(k, 0, 0, k, -L * k, -T * k);
    g.clearRect(L, T, R - L, B - T);
    if (this.theme === 'lake') this.paintLake(g, L, T, R, B);
    else if (this.theme === 'comet') this.paintComet(g, L, T, R, B);
    else if (LANDMARK_IDS.has(this.theme)) {
      const lm = LANDMARKS?.[this.theme];
      if (lm) lm.paint(g, L, T, R, B);
      else {
        paintPlaceholder(g, L, T, R, B);
        // 下載完成後清掉快取，下一幀重畫
        const theme = this.theme;
        void loadLandmarks().then(() => {
          if (this.theme === theme) this.key = '';
        });
      }
    }
    else this.paintBeach(g, L, T, R, B);
    this.layer = c;
    this.buildClouds(k);
  }

  private paintBeach(g: CanvasRenderingContext2D, L: number, T: number, R: number, B: number) {
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

  /** 黃昏湖畔：被群山環抱的湖、山稜後的夕陽、粉橘色的雲、對岸亮起的燈火 */
  private paintLake(g: CanvasRenderingContext2D, L: number, T: number, R: number, B: number) {
    const W = R - L;
    const sky = g.createLinearGradient(0, Math.min(T, -40), 0, HORIZON + 2);
    sky.addColorStop(0, '#1d2a5e');
    sky.addColorStop(0.35, '#4b4b8f');
    sky.addColorStop(0.62, '#c76a8a');
    sky.addColorStop(0.82, '#f39a6b');
    sky.addColorStop(1, '#ffd29a');
    g.fillStyle = sky;
    g.fillRect(L, T, W, HORIZON + 2 - T);
    // 夕陽
    const glow = g.createRadialGradient(DUSK_SUN.x, DUSK_SUN.y, 0, DUSK_SUN.x, DUSK_SUN.y, 170);
    glow.addColorStop(0, 'rgba(255,244,210,1)');
    glow.addColorStop(0.07, 'rgba(255,214,150,0.9)');
    glow.addColorStop(0.3, 'rgba(255,150,100,0.3)');
    glow.addColorStop(1, 'rgba(255,120,90,0)');
    g.fillStyle = glow;
    g.fillRect(L, T, W, HORIZON + 2 - T);
    // 高空的卷雲（細長的粉色雲絲）
    const wisp = rng(41);
    for (let i = 0; i < 14; i++) {
      const x = L + wisp() * W;
      const y = 10 + wisp() * 70;
      const len = 40 + wisp() * 90;
      const grad = g.createLinearGradient(x, 0, x + len, 0);
      grad.addColorStop(0, 'rgba(255,190,200,0)');
      grad.addColorStop(0.5, `rgba(255,${180 + Math.floor(wisp() * 40)},190,${0.25 + wisp() * 0.25})`);
      grad.addColorStop(1, 'rgba(255,190,200,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.ellipse(x + len / 2, y, len / 2, 1.2 + wisp() * 1.6, -0.06, 0, Math.PI * 2);
      g.fill();
    }
    // 群山：遠山偏紫、近山偏深，兩側較高形成盆地
    const far = g.createLinearGradient(0, 90, 0, HORIZON);
    far.addColorStop(0, '#8a6aa3');
    far.addColorStop(1, '#c48aa0');
    ridge(g, L, R, HORIZON + 1, 34, 5, far, 18);
    const mid = g.createLinearGradient(0, 100, 0, HORIZON);
    mid.addColorStop(0, '#5a4a7e');
    mid.addColorStop(1, '#7a5f8c');
    ridge(g, L, R, HORIZON + 1, 20, 9, mid, 40);
    // 山腳的薄霧
    const haze = g.createLinearGradient(0, HORIZON - 16, 0, HORIZON + 1);
    haze.addColorStop(0, 'rgba(255,190,170,0)');
    haze.addColorStop(1, 'rgba(255,190,170,0.45)');
    g.fillStyle = haze;
    g.fillRect(L, HORIZON - 16, W, 17);
    townLights(g, L, R, 3, 40, 0.75);

    // 湖面：倒映天空與山
    const water = g.createLinearGradient(0, HORIZON, 0, SHORE + 2);
    water.addColorStop(0, '#f2a27a');
    water.addColorStop(0.25, '#b56a8e');
    water.addColorStop(0.7, '#4f4d8a');
    water.addColorStop(1, '#3a4479');
    g.fillStyle = water;
    g.fillRect(L, HORIZON, W, SHORE + 2 - HORIZON);
    this.reflectRidges(g, L, R, '#4a3a6e', 0.35);
    const refl = g.createLinearGradient(DUSK_SUN.x - 34, 0, DUSK_SUN.x + 34, 0);
    refl.addColorStop(0, 'rgba(255,200,140,0)');
    refl.addColorStop(0.5, 'rgba(255,214,160,0.55)');
    refl.addColorStop(1, 'rgba(255,200,140,0)');
    g.fillStyle = refl;
    g.fillRect(DUSK_SUN.x - 34, HORIZON, 68, SHORE - HORIZON);
    paintShore(g, L, R, B, false);
  }

  /** 彗星之夜：滿天星斗、銀河、拖著兩道尾巴的彗星，倒映在山中的湖面上 */
  private paintComet(g: CanvasRenderingContext2D, L: number, T: number, R: number, B: number) {
    const W = R - L;
    const sky = g.createLinearGradient(0, Math.min(T, -40), 0, HORIZON + 2);
    sky.addColorStop(0, '#050a24');
    sky.addColorStop(0.45, '#121c4e');
    sky.addColorStop(0.8, '#2b3a7a');
    sky.addColorStop(1, '#4a6aa0');
    g.fillStyle = sky;
    g.fillRect(L, T, W, HORIZON + 2 - T);
    // 銀河：斜斜的一條霧狀光帶，加上密集的小星
    g.save();
    g.translate(150, 40);
    g.rotate(-0.42);
    const band = g.createLinearGradient(0, -40, 0, 40);
    band.addColorStop(0, 'rgba(140,150,255,0)');
    band.addColorStop(0.5, 'rgba(190,180,255,0.22)');
    band.addColorStop(1, 'rgba(140,150,255,0)');
    g.fillStyle = band;
    g.fillRect(-400, -40, 800, 80);
    const mw = rng(51);
    for (let i = 0; i < 500; i++) {
      const x = (mw() - 0.5) * 800;
      const y = (mw() + mw() + mw() - 1.5) * 26;
      g.fillStyle = `rgba(230,230,255,${0.2 + mw() * 0.5})`;
      g.fillRect(x, y, 0.6, 0.6);
    }
    g.restore();
    // 一般星星
    const st = rng(52);
    for (let i = 0; i < W * 0.9; i++) {
      const x = L + st() * W;
      const y = T + st() * (HORIZON - 10 - T);
      g.fillStyle = `rgba(255,255,255,${0.25 + st() * 0.6})`;
      const r = st() < 0.08 ? 1.1 : 0.6;
      g.fillRect(x, y, r, r);
    }
    // 彗星：白色塵埃尾＋藍色離子尾，另有一塊分裂出的小碎片
    const tail = (dx: number, dy: number, width: number, color: string, alpha: number) => {
      const ex = COMET.x + dx;
      const ey = COMET.y + dy;
      const grad = g.createLinearGradient(COMET.x, COMET.y, ex, ey);
      grad.addColorStop(0, `rgba(${color},${alpha})`);
      grad.addColorStop(1, `rgba(${color},0)`);
      g.fillStyle = grad;
      const len = Math.hypot(dx, dy);
      const nx = -dy / len;
      const ny = dx / len;
      g.beginPath();
      g.moveTo(COMET.x + nx * 1.5, COMET.y + ny * 1.5);
      g.quadraticCurveTo(COMET.x + dx * 0.5 + nx * width * 0.6, COMET.y + dy * 0.5 + ny * width * 0.6, ex + nx * width, ey + ny * width);
      g.lineTo(ex - nx * width * 0.3, ey - ny * width * 0.3);
      g.quadraticCurveTo(COMET.x + dx * 0.5 - nx * width * 0.2, COMET.y + dy * 0.5 - ny * width * 0.2, COMET.x - nx * 1.5, COMET.y - ny * 1.5);
      g.closePath();
      g.fill();
    };
    g.save();
    g.globalCompositeOperation = 'lighter';
    tail(-230, -110, 26, '210,225,255', 0.55);
    tail(-250, -70, 10, '120,190,255', 0.6);
    tail(-200, -130, 6, '255,220,240', 0.35);
    const head = g.createRadialGradient(COMET.x, COMET.y, 0, COMET.x, COMET.y, 16);
    head.addColorStop(0, 'rgba(255,255,255,1)');
    head.addColorStop(0.25, 'rgba(210,235,255,0.8)');
    head.addColorStop(1, 'rgba(150,200,255,0)');
    g.fillStyle = head;
    g.fillRect(COMET.x - 16, COMET.y - 16, 32, 32);
    const fx = COMET.x - 18;
    const fy = COMET.y + 10;
    const frag = g.createRadialGradient(fx, fy, 0, fx, fy, 7);
    frag.addColorStop(0, 'rgba(255,230,210,0.9)');
    frag.addColorStop(1, 'rgba(255,180,160,0)');
    g.fillStyle = frag;
    g.fillRect(fx - 7, fy - 7, 14, 14);
    g.restore();
    // 群山剪影與燈火
    ridge(g, L, R, HORIZON + 1, 34, 5, '#1d2550', 18);
    ridge(g, L, R, HORIZON + 1, 20, 9, '#121838', 40);
    townLights(g, L, R, 4, 90, 0.95);
    // 湖面：深藍，倒映彗星與燈火
    const water = g.createLinearGradient(0, HORIZON, 0, SHORE + 2);
    water.addColorStop(0, '#2c3f7a');
    water.addColorStop(0.5, '#162455');
    water.addColorStop(1, '#0f1a40');
    g.fillStyle = water;
    g.fillRect(L, HORIZON, W, SHORE + 2 - HORIZON);
    this.reflectRidges(g, L, R, '#0b1030', 0.5);
    const refl = g.createLinearGradient(COMET.x - 24, 0, COMET.x + 24, 0);
    refl.addColorStop(0, 'rgba(180,210,255,0)');
    refl.addColorStop(0.5, 'rgba(190,215,255,0.35)');
    refl.addColorStop(1, 'rgba(180,210,255,0)');
    g.fillStyle = refl;
    g.fillRect(COMET.x - 24, HORIZON, 48, SHORE - HORIZON);
    paintShore(g, L, R, B, true);
  }

  /** 把近山倒映在湖面上 */
  private reflectRidges(g: CanvasRenderingContext2D, L: number, R: number, color: string, alpha: number) {
    g.save();
    g.beginPath();
    g.rect(L, HORIZON, R - L, SHORE - HORIZON);
    g.clip();
    g.translate(0, HORIZON * 2 + 2);
    g.scale(1, -1);
    g.globalAlpha = alpha;
    ridge(g, L, R, HORIZON + 1, 20, 9, color, 40);
    g.restore();
  }

  private buildClouds(k: number) {
    const make = (specs: { x: number; y: number; w: number; h: number; speed: number; seed: number }[], warm: number, pal: CloudPal) =>
      specs.map((s) => {
        const { img, pad } = cloudCanvas(k, s.w, s.h, s.seed * 31, warm, pal);
        return { img, w: s.w + pad * 2, h: s.h + pad, x: s.x - pad, y: s.y - pad, speed: s.speed };
      });
    if (this.theme === 'comet' || this.theme === 'taipei' || this.theme === 'yangming') {
      this.clouds = [];
    } else if (this.theme === 'lake' || this.theme === 'tamsui' || this.theme === 'songshan') {
      this.clouds = make([
        { x: 40, y: 54, w: 90, h: 26, speed: 0.0009, seed: 6 },
        { x: 330, y: 70, w: 70, h: 20, speed: 0.0007, seed: 7 },
        { x: 190, y: 28, w: 60, h: 18, speed: 0.0012, seed: 8 },
      ], 1, DUSK);
    } else {
      this.clouds = make([
        { x: 10, y: 14, w: 100, h: 36, speed: 0.0016, seed: 1 },
        { x: 200, y: 62, w: 64, h: 22, speed: 0.0011, seed: 2 },
        { x: 400, y: 8, w: 120, h: 42, speed: 0.002, seed: 3 },
        { x: 120, y: 96, w: 46, h: 14, speed: 0.0008, seed: 4 },
      ], 0.7, DAY);
    }
  }

  /** 天空到地面（在角色之前畫） */
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

    if (this.theme === 'beach') this.drawSea(ctx, time, L, R);
    else if (LANDMARK_IDS.has(this.theme)) LANDMARKS?.[this.theme]?.draw(ctx, time, L, R);
    else this.drawLake(ctx, time, L, R);
    ctx.imageSmoothingEnabled = smooth;
  }

  private drawSparkles(ctx: CanvasRenderingContext2D, list: Sparkle[], time: number, L: number, R: number, color: string, gain: number) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of list) {
      if (s.x < L - 10 || s.x > R + 10) continue;
      const a = Math.sin(time * s.speed + s.phase);
      if (a <= 0.2) continue;
      ctx.fillStyle = `rgba(${color},${(a - 0.2) * gain})`;
      ctx.fillRect(s.x - s.w / 2, s.y, s.w, 0.8);
    }
    ctx.restore();
  }

  private drawSea(ctx: CanvasRenderingContext2D, time: number, L: number, R: number) {
    this.drawSparkles(ctx, this.sparkles, time, L, R, '255,250,235', 0.9);
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
  }

  /** 湖：漣漪的光、平緩的水線；夜晚加上閃爍的星星與流星 */
  private drawLake(ctx: CanvasRenderingContext2D, time: number, L: number, R: number) {
    const night = this.theme === 'comet';
    if (night) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const s of this.stars) {
        if (s.x < L || s.x > R) continue;
        const a = 0.5 + 0.5 * Math.sin(time * 0.003 + s.phase);
        ctx.fillStyle = `rgba(255,255,255,${a * 0.9})`;
        ctx.fillRect(s.x - s.r, s.y - 0.25, s.r * 2, 0.5);
        ctx.fillRect(s.x - 0.25, s.y - s.r, 0.5, s.r * 2);
      }
      // 流星：三條錯開週期的軌道，每次出現的位置都不同
      for (let slot = 0; slot < 3; slot++) {
        const period = 2600 + slot * 900;
        const tt = time + slot * 1300;
        const n = Math.floor(tt / period);
        const p = (tt % period) / period;
        if (p > 0.28) continue;
        const r = rng(n * 7 + slot);
        const sx = L + 40 + r() * (R - L) * 0.9;
        const sy = -10 + r() * 70;
        const len = 60 + r() * 60;
        const k = p / 0.28;
        const hx = sx - k * len * 1.6;
        const hy = sy + k * len * 0.9;
        const tx = hx + len * 0.5;
        const ty = hy - len * 0.28;
        const grad = ctx.createLinearGradient(hx, hy, tx, ty);
        grad.addColorStop(0, `rgba(255,255,255,${0.95 * Math.sin(k * Math.PI)})`);
        grad.addColorStop(1, 'rgba(160,200,255,0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (night) this.drawSparkles(ctx, this.nightSparkles, time, L, R, '200,220,255', 0.45);
    else this.drawSparkles(ctx, this.duskSparkles, time, L, R, '255,214,160', 0.85);
    // 湖岸水線：比海浪平緩
    ctx.fillStyle = night ? 'rgba(150,170,230,0.35)' : 'rgba(255,230,210,0.6)';
    ctx.beginPath();
    ctx.moveTo(L, SHORE + 5);
    for (let x = Math.floor(L); x <= R + 4; x += 4) ctx.lineTo(x, SHORE + Math.sin(x * 0.05 + time * 0.0012) * 0.8);
    ctx.lineTo(R + 4, SHORE + 5);
    ctx.closePath();
    ctx.fill();
  }

  /** 最上層（在所有東西之後畫） */
  drawOverlay(ctx: CanvasRenderingContext2D, time: number, L: number, T: number, R: number, B: number) {
    if (DAY_SCENES.has(this.theme)) this.drawDayOverlay(ctx, time, L, T, R, B);
    else this.drawEveningOverlay(ctx, time, L, T, R, B);
  }

  /** 白天：漂浮光點與鏡頭光斑 */
  private drawDayOverlay(ctx: CanvasRenderingContext2D, time: number, L: number, T: number, R: number, B: number) {
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
    const cx = 216;
    const cy = 170;
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

  /** 黃昏／夜晚：整體色調（讓角色融入光線）＋螢火蟲般的光點 */
  private drawEveningOverlay(ctx: CanvasRenderingContext2D, time: number, L: number, T: number, R: number, B: number) {
    const night = this.theme === 'comet';
    const look = TINTS[this.theme] ?? { tint: 'rgb(255,236,220)', motes: '255,220,150' };
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = look.tint;
    ctx.fillRect(L, T, R - L, B - T);
    if (!look.motes) {
      ctx.restore();
      return;
    }
    ctx.globalCompositeOperation = 'lighter';
    const w = R - L;
    const band = (B - 140) * 0.9;
    for (const m of this.motes) {
      const x = L + ((((m.x + Math.sin(time * 0.0007 + m.phase) * 20 + time * m.vx * 0.5) - L) % w) + w) % w;
      const y = 140 + ((((m.y * 0.6 + Math.cos(time * 0.0009 + m.phase) * 10)) % band) + band) % band;
      const a = Math.max(0, Math.sin(time * 0.0025 + m.phase)) * (night ? 0.7 : 0.45);
      if (a <= 0.02) continue;
      const c = look.motes;
      const g = ctx.createRadialGradient(x, y, 0, x, y, m.r * 3.5);
      g.addColorStop(0, `rgba(${c},${a})`);
      g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x - m.r * 3.5, y - m.r * 3.5, m.r * 7, m.r * 7);
    }
    ctx.restore();
  }
}
