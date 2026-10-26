// 角色特效：每隻動物在扣殺、接球、跳躍、魚躍、得分時有自己的誇張特效與狀聲詞。
// 純視覺（不影響遊戲邏輯，線上對戰兩邊各自畫），粒子數有上限。
import { GROUND_Y } from '../engine/constants';
// 「簡潔」模式：粒子少一半、沒有閃光、畫面不震動、不顯示狀聲詞。

export type FxShape = 'sq' | 'dot' | 'drop' | 'feather' | 'petal' | 'leaf' | 'scale' | 'cloud' | 'streak' | 'paw' | 'acorn' | 'bubble';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  drag: number;
  life: number;
  max: number;
  color: string;
  size: number;
  shape: FxShape;
  rot: number;
  spin: number;
}

interface Ring {
  x: number;
  y: number;
  r: number;
  grow: number;
  life: number;
  max: number;
  color: string;
  width: number;
}

interface Slash {
  x: number;
  y: number;
  dir: number;
  life: number;
  max: number;
  color: string;
}

interface Word {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  max: number;
  tilt: number;
}

export interface FxHost {
  shake(n: number): void;
  flash(a: number, color?: string): void;
  punch(n: number): void;
}

type Kind = 'spike' | 'bump' | 'jump' | 'dive' | 'score' | 'ground';

interface SprayOpts {
  colors: string[];
  shape?: FxShape;
  speed?: number;
  up?: number;
  g?: number;
  size?: number;
  life?: number;
  spread?: number;
  /** 往哪個方向噴（弧度，0 = 右）；沒給就四面八方 */
  dir?: number;
  drag?: number;
}

/** 每隻動物的特效風格 */
interface Style {
  /** 狀聲詞（不分語言都用英文漫畫字） */
  word: string;
  wordColor: string;
  /** 主題色（得分的彩帶、衝擊波） */
  colors: string[];
  on: Partial<Record<Kind, (f: Fx, x: number, y: number, face: number) => void>>;
}

const MAX_PARTICLES = 420;

export class Fx {
  particles: Particle[] = [];
  rings: Ring[] = [];
  slashes: Slash[] = [];
  words: Word[] = [];
  /** 0.5 = 簡潔模式 */
  amount = 1;
  showWords = true;

  constructor(private host: FxHost) {}

  spray(x: number, y: number, n: number, o: SprayOpts) {
    const count = Math.round(n * this.amount);
    for (let i = 0; i < count && this.particles.length < MAX_PARTICLES; i++) {
      const a = o.dir === undefined ? Math.random() * Math.PI * 2 : o.dir + (Math.random() - 0.5) * (o.spread ?? 1);
      // 誇張模式：粒子大一點、噴得遠一點
      const v = (o.speed ?? 3) * (0.35 + Math.random() * 0.75) * (this.amount >= 1 ? 1.3 : 1);
      this.particles.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - (o.up ?? 0) * Math.random(),
        g: o.g ?? 0.15,
        drag: o.drag ?? 0.985,
        life: 0,
        max: (o.life ?? 30) * (0.7 + Math.random() * 0.6),
        color: o.colors[i % o.colors.length],
        size: (o.size ?? 2.4) * (0.7 + Math.random() * 0.6) * (this.amount >= 1 ? 1.6 : 1.1),
        shape: o.shape ?? 'sq',
        rot: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.4,
      });
    }
  }

  ring(x: number, y: number, color: string, grow = 2.2, max = 18, width = 2.5) {
    this.rings.push({ x, y, r: 3, grow, life: 0, max, color, width });
  }

  slash(x: number, y: number, dir: number, color: string) {
    this.slashes.push({ x, y, dir, life: 0, max: 24, color });
  }

  word(x: number, y: number, text: string, color: string) {
    if (!this.showWords) return;
    this.words = this.words.filter((w) => w.life < w.max * 0.6).slice(-2);
    this.words.push({ x, y, text, color, life: 0, max: 42, tilt: (Math.random() - 0.5) * 0.3 });
  }

  shake(n: number) {
    if (this.amount >= 1) this.host.shake(n);
  }

  flash(a: number, color?: string) {
    if (this.amount >= 1) this.host.flash(a, color);
  }

  punch(n: number) {
    if (this.amount >= 1) this.host.punch(n);
  }

  /** 角色特效：charId 是動物；face = 面向（1 右、-1 左） */
  emit(kind: Kind, charId: string, x: number, y: number, face: number) {
    const st = STYLES[charId] ?? DEFAULT_STYLE;
    // 共同的誇張效果
    if (kind === 'spike') {
      this.ring(x, y, '#ffffff', 3, 16, 3);
      this.flash(0.22);
      this.punch(1);
      this.shake(5);
      this.word(x, y - 26, st.word, st.wordColor);
    } else if (kind === 'score') {
      this.spray(x, y - 20, 34, { colors: st.colors, shape: 'sq', speed: 4.5, up: 3, g: 0.12, size: 3, life: 55, drag: 0.97 });
    }
    st.on[kind]?.(this, x, y, face);
  }

  /** 每個邏輯幀呼叫一次 */
  step() {
    for (const p of this.particles) {
      p.vx *= p.drag;
      p.vy = p.vy * p.drag + p.g;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.spin;
      p.life++;
    }
    this.particles = this.particles.filter((p) => p.life < p.max);
    for (const r of this.rings) {
      r.r += r.grow * (1 - r.life / r.max);
      r.life++;
    }
    this.rings = this.rings.filter((r) => r.life < r.max);
    for (const s of this.slashes) s.life++;
    this.slashes = this.slashes.filter((s) => s.life < s.max);
    for (const w of this.words) {
      w.life++;
      w.y -= 0.35;
    }
    this.words = this.words.filter((w) => w.life < w.max);
  }

  clear() {
    this.particles = [];
    this.rings = [];
    this.slashes = [];
    this.words = [];
  }

  draw(g: CanvasRenderingContext2D) {
    for (const r of this.rings) {
      g.globalAlpha = 1 - r.life / r.max;
      g.strokeStyle = r.color;
      g.lineWidth = r.width * (1 - r.life / r.max) + 0.5;
      g.beginPath();
      g.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      g.stroke();
    }
    for (const s of this.slashes) {
      const t = s.life / s.max;
      g.globalAlpha = 1 - t;
      g.lineCap = 'round';
      // 三道爪痕：先畫深色外框，再畫亮色本體
      for (const [col, extra] of [[EDGE, 2.2], [s.color, 0]] as const) {
        g.strokeStyle = col;
        for (let k = -1; k <= 1; k++) {
          g.lineWidth = 5 * (1 - t * 0.7) + extra;
          g.beginPath();
          const ox = s.x + k * 9 * Math.cos(s.dir + Math.PI / 2), oy = s.y + k * 9 * Math.sin(s.dir + Math.PI / 2);
          const len = 40 * Math.min(1, t * 4);
          g.moveTo(ox - Math.cos(s.dir) * len * 0.5, oy - Math.sin(s.dir) * len * 0.5);
          g.quadraticCurveTo(ox + 5, oy + 5, ox + Math.cos(s.dir) * len * 0.5, oy + Math.sin(s.dir) * len * 0.5);
          g.stroke();
        }
      }
    }
    for (const p of this.particles) {
      g.globalAlpha = Math.max(0, 1 - p.life / p.max);
      drawParticle(g, p);
    }
    g.globalAlpha = 1;
    for (const w of this.words) {
      const t = w.life / w.max;
      const pop = t < 0.15 ? 0.4 + (t / 0.15) * 0.9 : t < 0.25 ? 1.3 - ((t - 0.15) / 0.1) * 0.3 : 1;
      g.save();
      g.globalAlpha = t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
      g.translate(w.x, w.y);
      g.rotate(w.tilt);
      g.scale(pop, pop);
      g.font = '900 20px "Arial Rounded MT Bold", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineJoin = 'round';
      g.lineWidth = 5;
      g.strokeStyle = 'rgba(20,24,40,0.9)';
      g.strokeText(w.text, 0, 0);
      g.fillStyle = w.color;
      g.fillText(w.text, 0, 0);
      g.restore();
    }
    g.globalAlpha = 1;
  }
}

/** 淺色粒子（水滴、白羽毛）加一圈細細的深色描邊，在天空或沙灘上都看得清楚 */
const EDGE = 'rgba(30,40,70,0.55)';

function drawParticle(g: CanvasRenderingContext2D, p: Particle) {
  const s = p.size;
  g.fillStyle = p.color;
  g.strokeStyle = p.color;
  g.lineWidth = 0.7;
  switch (p.shape) {
    case 'sq':
      g.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      return;
    case 'dot':
    case 'acorn':
      g.beginPath();
      g.arc(p.x, p.y, s / 2, 0, Math.PI * 2);
      g.fill();
      if (p.shape === 'acorn') {
        g.fillStyle = '#6a4a2a';
        g.fillRect(p.x - s / 2, p.y - s / 2 - 1, s, 1.6);
      }
      return;
    case 'bubble':
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(p.x, p.y, s / 2, 0, Math.PI * 2);
      g.stroke();
      return;
    case 'drop':
      g.save();
      g.translate(p.x, p.y);
      g.rotate(Math.atan2(p.vy, p.vx) + Math.PI / 2);
      g.beginPath();
      g.moveTo(0, -s);
      g.quadraticCurveTo(s * 0.7, s * 0.3, 0, s * 0.6);
      g.quadraticCurveTo(-s * 0.7, s * 0.3, 0, -s);
      g.fill();
      g.strokeStyle = EDGE;
      g.stroke();
      g.restore();
      return;
    case 'streak':
      g.lineWidth = Math.max(0.8, s * 0.4);
      g.beginPath();
      g.moveTo(p.x, p.y);
      g.lineTo(p.x - p.vx * 3, p.y - p.vy * 3);
      g.stroke();
      return;
    case 'cloud':
      g.beginPath();
      g.arc(p.x, p.y, s, 0, Math.PI * 2);
      g.arc(p.x + s * 0.8, p.y + s * 0.2, s * 0.7, 0, Math.PI * 2);
      g.arc(p.x - s * 0.8, p.y + s * 0.3, s * 0.6, 0, Math.PI * 2);
      g.fill();
      return;
    default: {
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.beginPath();
      if (p.shape === 'feather') {
        g.ellipse(0, 0, s * 0.45, s * 1.4, 0, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = EDGE;
        g.lineWidth = 0.6;
        g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.6)';
        g.lineWidth = 0.4;
        g.beginPath();
        g.moveTo(0, -s * 1.3);
        g.lineTo(0, s * 1.3);
        g.stroke();
      } else if (p.shape === 'petal') {
        // 五瓣的梅花／櫻花
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          g.moveTo(0, 0);
          g.ellipse(Math.cos(a) * s * 0.55, Math.sin(a) * s * 0.55, s * 0.5, s * 0.36, a, 0, Math.PI * 2);
        }
        g.fill();
        g.strokeStyle = 'rgba(160,60,90,0.5)';
        g.lineWidth = 0.5;
        g.stroke();
        g.fillStyle = '#ffd84a';
        g.beginPath();
        g.arc(0, 0, s * 0.2, 0, Math.PI * 2);
        g.fill();
      } else if (p.shape === 'leaf') {
        g.ellipse(0, 0, s * 1.2, s * 0.5, 0, 0, Math.PI * 2);
        g.fill();
      } else if (p.shape === 'scale') {
        g.moveTo(-s, -s * 0.4);
        g.quadraticCurveTo(0, s * 1.3, s, -s * 0.4);
        g.closePath();
        g.fill();
      } else if (p.shape === 'paw') {
        g.ellipse(0, s * 0.3, s * 0.55, s * 0.45, 0, 0, Math.PI * 2);
        for (const [dx, dy] of [[-0.55, -0.4], [-0.2, -0.7], [0.2, -0.7], [0.55, -0.4]]) g.ellipse(dx * s, dy * s, s * 0.2, s * 0.24, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }
  }
}

// ---------------------------------------------------------------- 每隻動物的特效
const DUST = ['#e8c97a', '#d8b46a', '#f2dca0'];

const DEFAULT_STYLE: Style = {
  word: 'BAM!',
  wordColor: '#ffe27a',
  colors: ['#ffc531', '#ffffff', '#2f7fe0'],
  on: {},
};

/** 往上方（扣殺時往前下方）的速度線 */
function speedLines(f: Fx, x: number, y: number, dir: number, color: string, n = 10) {
  f.spray(x, y, n, { colors: [color], shape: 'streak', speed: 7, dir, spread: 0.5, g: 0, size: 2.4, life: 12, drag: 0.92 });
}

const STYLES: Record<string, Style> = {
  // 臺灣黑熊：巨大的熊掌爪痕、地面大震動、橡實
  yueyue: {
    word: 'ROAR!', wordColor: '#f2ece0', colors: ['#2a2628', '#f2ece0', '#b89470'],
    on: {
      spike: (f, x, y, face) => {
        f.slash(x, y, face > 0 ? 0.6 : Math.PI - 0.6, '#f2ece0');
        f.shake(9);
      },
      dive: (f, x) => f.spray(x, GROUND_Y, 22, { colors: DUST, speed: 4, up: 3, size: 3.5, life: 28 }),
      score: (f, x, y) => f.spray(x, y - 30, 12, { colors: ['#9a6a3a', '#b88a52'], shape: 'acorn', speed: 3, up: 3, size: 4, life: 50 }),
    },
  },
  // 石虎：黃褐色速度線、魚躍留下貓掌印
  shishi: {
    word: 'MEOW!', wordColor: '#ffd27a', colors: ['#c8a878', '#3a2e24', '#f2ece0'],
    on: {
      spike: (f, x, y, face) => speedLines(f, x, y, face > 0 ? 0.5 : Math.PI - 0.5, '#ffd27a', 12),
      dive: (f, x, _y, face) => {
        for (let k = 0; k < 4; k++) f.spray(x - face * k * 9, GROUND_Y + 2, 1, { colors: ['#5a4632'], shape: 'paw', speed: 0, g: 0, size: 4, life: 60 });
      },
      bump: (f, x, y) => f.spray(x, y, 8, { colors: ['#3a2e24'], shape: 'dot', speed: 3, size: 2.4 }),
    },
  },
  // 梅花鹿：梅花瓣（梅梅）、跳起來白色斑點閃一下
  meimei: {
    word: 'YIP!', wordColor: '#ffe0ea', colors: ['#ffffff', '#f8c8d8', '#c8844a'],
    on: {
      spike: (f, x, y) => f.spray(x, y, 18, { colors: ['#ffffff', '#ffd0e0', '#ffb0c8'], shape: 'petal', speed: 3.5, g: 0.04, size: 4, life: 55, drag: 0.96 }),
      jump: (f, x, y) => f.spray(x, y + 18, 10, { colors: ['#f4ecd8'], shape: 'dot', speed: 2, up: 1, g: 0.05, size: 2.4, life: 25 }),
      bump: (f, x, y) => f.spray(x, y, 6, { colors: ['#ffd0e0'], shape: 'petal', speed: 2, g: 0.04, size: 3, life: 40 }),
    },
  },
  // 臺灣獼猴：樹葉亂飛、得分時在地上彈跳
  hoho: {
    word: 'OOK!', wordColor: '#ffd0c0', colors: ['#6aa84a', '#8a8070', '#e2b0a0'],
    on: {
      spike: (f, x, y) => f.spray(x, y, 16, { colors: ['#5a9a3a', '#7ab84a', '#4a8a2a'], shape: 'leaf', speed: 4, g: 0.06, size: 3.2, life: 45, drag: 0.96 }),
      bump: (f, x, y) => f.spray(x, y, 6, { colors: ['#7ab84a'], shape: 'leaf', speed: 2.5, g: 0.06, size: 2.8, life: 35 }),
      jump: (f, x, y) => f.ring(x, y + 30, '#f2dca0', 2, 12, 2),
    },
  },
  // 白面鼯鼠：滑翔的風、飄落的葉子
  glidey: {
    word: 'WHOOSH!', wordColor: '#e8f4ff', colors: ['#efe6d6', '#8e7458', '#c8e0f0'],
    on: {
      jump: (f, x, y) => {
        f.spray(x - 14, y, 6, { colors: ['rgba(230,245,255,0.9)'], shape: 'streak', speed: 4, dir: Math.PI * 0.5, spread: 1.4, g: 0, size: 2, life: 16 });
        f.spray(x + 14, y, 6, { colors: ['rgba(230,245,255,0.9)'], shape: 'streak', speed: 4, dir: Math.PI * 0.5, spread: 1.4, g: 0, size: 2, life: 16 });
      },
      spike: (f, x, y) => {
        f.ring(x, y, '#c8e0f0', 3.5, 20, 2);
        f.spray(x, y, 12, { colors: ['#b8a070', '#8a6a48'], shape: 'leaf', speed: 3, g: 0.03, size: 3, life: 55, drag: 0.95 });
      },
    },
  },
  // 臺灣穿山甲：鱗片碎片、捲成球滾地
  jiajia: {
    word: 'ROLL!', wordColor: '#ffd8a0', colors: ['#a8784a', '#7a5432', '#e8c8a8'],
    on: {
      spike: (f, x, y) => f.spray(x, y, 14, { colors: ['#a8784a', '#c89a6a', '#7a5432'], shape: 'scale', speed: 4, g: 0.15, size: 3, life: 35 }),
      dive: (f, x, _y, face) => {
        f.ring(x, GROUND_Y - 10, '#c89a6a', 2.5, 16, 2.5);
        f.spray(x, GROUND_Y, 14, { colors: DUST, speed: 3.5, up: 2, size: 3, life: 25 });
        f.spray(x, GROUND_Y - 12, 8, { colors: ['#a8784a'], shape: 'scale', speed: 3, dir: face > 0 ? Math.PI : 0, spread: 0.8, size: 2.6, life: 25 });
      },
    },
  },
  // 歐亞水獺：水花四濺
  tata: {
    word: 'SPLASH!', wordColor: '#c8eaff', colors: ['#8ad0f0', '#ffffff', '#6e4e36'],
    on: {
      spike: (f, x, y) => f.spray(x, y, 20, { colors: ['#8ad0f0', '#c8eaff', '#ffffff'], shape: 'drop', speed: 4.5, up: 2, g: 0.2, size: 2.6, life: 30 }),
      dive: (f, x) => {
        f.ring(x, GROUND_Y - 2, '#8ad0f0', 3, 18, 2.5);
        f.spray(x, GROUND_Y - 4, 22, { colors: ['#8ad0f0', '#c8eaff'], shape: 'drop', speed: 4, up: 4, g: 0.22, size: 2.6, life: 30 });
      },
      bump: (f, x, y) => f.spray(x, y, 8, { colors: ['#c8eaff'], shape: 'drop', speed: 3, up: 1, g: 0.2, size: 2.2, life: 22 }),
    },
  },
  // 臺灣雲豹：雲狀的霧、殘影
  baobao: {
    word: 'GRRR!', wordColor: '#e8e0c8', colors: ['#b8a070', '#6a5a3e', '#e8e0c8'],
    on: {
      spike: (f, x, y, face) => {
        f.spray(x, y, 10, { colors: ['rgba(106,90,62,0.7)', 'rgba(200,190,160,0.7)'], shape: 'cloud', speed: 2, g: -0.02, size: 3.5, life: 40, drag: 0.95 });
        speedLines(f, x, y, face > 0 ? 0.5 : Math.PI - 0.5, '#e8e0c8', 8);
        f.shake(7);
      },
      jump: (f, x, y) => f.spray(x, y + 18, 6, { colors: ['rgba(200,190,160,0.6)'], shape: 'cloud', speed: 1, g: -0.02, size: 3, life: 30 }),
    },
  },
  // 帝雉：深藍與白色的羽毛
  mikado: {
    word: 'CLUCK!', wordColor: '#c8d0ff', colors: ['#2c3566', '#f2f0ea', '#c83a30'],
    on: {
      spike: (f, x, y) => f.spray(x, y, 16, { colors: ['#2c3566', '#3a4888', '#f2f0ea'], shape: 'feather', speed: 3.5, g: 0.03, size: 3, life: 55, drag: 0.95 }),
      bump: (f, x, y) => f.spray(x, y, 5, { colors: ['#2c3566', '#f2f0ea'], shape: 'feather', speed: 2, g: 0.03, size: 2.6, life: 40 }),
    },
  },
  // 臺灣藍鵲：藍色長尾的拖影＋藍羽毛
  lanlan: {
    word: 'CAW!', wordColor: '#a8d0ff', colors: ['#3a72c0', '#f6f2ea', '#cf3b30'],
    on: {
      spike: (f, x, y, face) => {
        speedLines(f, x, y, face > 0 ? 0.4 : Math.PI - 0.4, '#7aa4e8', 10);
        f.spray(x, y, 12, { colors: ['#3a72c0', '#7aa4dc', '#f6f2ea'], shape: 'feather', speed: 3, g: 0.03, size: 3, life: 50, drag: 0.95 });
      },
      jump: (f, x, y) => f.spray(x, y + 10, 5, { colors: ['#7aa4dc'], shape: 'feather', speed: 1.5, g: 0.03, size: 2.6, life: 35 }),
    },
  },
  // 五色鳥：五種顏色的彩帶
  caicai: {
    word: 'KOK-KOK!', wordColor: '#fff07a', colors: ['#5aa848', '#4a8ad8', '#d8382c', '#f0d040', '#1a1a20'],
    on: {
      spike: (f, x, y) => f.spray(x, y, 26, { colors: ['#5aa848', '#4a8ad8', '#d8382c', '#f0d040', '#1a1a20'], shape: 'sq', speed: 5, up: 1, g: 0.1, size: 3, life: 45, drag: 0.96 }),
      bump: (f, x, y) => f.spray(x, y, 10, { colors: ['#5aa848', '#4a8ad8', '#d8382c', '#f0d040'], shape: 'sq', speed: 3, g: 0.1, size: 2.4, life: 30 }),
    },
  },
  // 熊鷹：俯衝的風壓、深色羽毛、最大的閃光
  ying: {
    word: 'SCREE!', wordColor: '#ffe6a0', colors: ['#8a6440', '#efe6d2', '#e0b840'],
    on: {
      spike: (f, x, y, face) => {
        f.flash(0.35, '#fff6d8');
        f.shake(10);
        speedLines(f, x, y - 10, face > 0 ? 0.9 : Math.PI - 0.9, '#ffffff', 14);
        f.spray(x, y, 12, { colors: ['#5a3c22', '#8a6440', '#efe6d2'], shape: 'feather', speed: 3.5, g: 0.04, size: 3.2, life: 50, drag: 0.95 });
      },
      jump: (f, x, y) => f.ring(x, y + 30, '#efe6d2', 3, 14, 2),
    },
  },
  // 黑面琵鷺：水花與白羽毛
  pipi: {
    word: 'SWISH!', wordColor: '#ffffff', colors: ['#f4f2ec', '#26262a', '#f0d890'],
    on: {
      spike: (f, x, y) => f.spray(x, y, 14, { colors: ['#ffffff', '#f4f2ec', '#e8e8f0'], shape: 'feather', speed: 3, g: 0.03, size: 3, life: 50, drag: 0.95 }),
      bump: (f, x, y) => f.spray(x, y, 10, { colors: ['#c8eaff', '#ffffff'], shape: 'drop', speed: 3, up: 1, g: 0.2, size: 2.2, life: 22 }),
    },
  },
  // 諸羅樹蛙：大跳水波紋、綠色水滴
  wawa: {
    word: 'RIBBIT!', wordColor: '#c8ff9a', colors: ['#5ab04e', '#c8ff9a', '#ffffff'],
    on: {
      jump: (f, x, y) => {
        f.ring(x, y + 30, '#8ad078', 3, 16, 2.5);
        f.ring(x, y + 30, '#c8ff9a', 2, 22, 1.5);
        f.spray(x, y + 28, 8, { colors: ['#8ad078', '#c8eaff'], shape: 'drop', speed: 2.5, up: 2, g: 0.2, size: 2.2, life: 22 });
      },
      spike: (f, x, y) => f.spray(x, y, 14, { colors: ['#5ab04e', '#8ad078', '#c8ff9a'], shape: 'drop', speed: 4, g: 0.18, size: 2.6, life: 30 }),
    },
  },
  // 櫻花鉤吻鮭：櫻花瓣、跳出水面的泡泡
  sakura: {
    word: 'SPLOOSH!', wordColor: '#ffd0dc', colors: ['#e89aa8', '#ffffff', '#6e8a5a'],
    on: {
      spike: (f, x, y) => f.spray(x, y, 18, { colors: ['#ffc0d0', '#ffe0ea', '#ffffff'], shape: 'petal', speed: 3.5, g: 0.03, size: 3.6, life: 55, drag: 0.96 }),
      jump: (f, x, y) => {
        f.spray(x, y + 18, 10, { colors: ['#c8eaff'], shape: 'bubble', speed: 1.5, g: -0.06, size: 3, life: 40 });
        f.spray(x, y + 28, 8, { colors: ['#8ad0f0', '#ffffff'], shape: 'drop', speed: 3, up: 2, g: 0.2, size: 2.2, life: 22 });
      },
      bump: (f, x, y) => f.spray(x, y, 6, { colors: ['#c8eaff'], shape: 'bubble', speed: 1.2, g: -0.05, size: 3, life: 35 }),
    },
  },
  // 綠蠵龜：沉重的沙塵與震動、泡泡
  guigui: {
    word: 'THUD!', wordColor: '#e8f0c8', colors: ['#6a9a6a', '#e8dca8', '#5a6a3a'],
    on: {
      spike: (f, x, y) => {
        f.shake(11);
        f.ring(x, y, '#e8dca8', 4, 20, 3.5);
        f.spray(x, y, 18, { colors: DUST, speed: 5, size: 3.6, life: 30 });
      },
      bump: (f, x, y) => f.spray(x, y, 8, { colors: ['#c8eaff'], shape: 'bubble', speed: 1.5, g: -0.05, size: 3.2, life: 40 }),
      dive: (f, x) => {
        f.shake(6);
        f.spray(x, GROUND_Y, 24, { colors: DUST, speed: 4.5, up: 3, size: 3.6, life: 30 });
      },
    },
  },
};
