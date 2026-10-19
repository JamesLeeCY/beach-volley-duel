// 背景音樂：依場景切換曲風，全部即時合成（原創）。
// - bright   夏日海灘、動物園、花博、椰林大道：輕快的大調，沙鈴與明亮的旋律。
// - dusk     黃昏湖畔、淡水夕陽、松菸：慢板的大七和弦、柔和的琶音與長音旋律。
// - night    彗星之夜、信義夜景：小調的都會感，電鋼琴般的反拍和弦與細碎的 hi-hat。
// - mountain 陽明山溫泉：五聲音階、帶顫音的笛聲、稀疏的木魚。
// 每首曲子是 64 個八分音符（8 小節）的循環；onStep 決定每一拍要發出哪些聲音。

export type MusicId = 'bright' | 'dusk' | 'night' | 'mountain';

export interface Voice {
  /** 播放一個音：midi 音高、波形、長度（秒）、音量、選項 */
  note(midi: number, wave: OscillatorType, dur: number, vol: number, opts?: { vibrato?: number; attack?: number }): void;
  /** 打擊音：以濾波雜訊模擬（沙鈴、hi-hat） */
  noise(dur: number, vol: number, highpass: number): void;
}

export interface Song {
  bpm: number;
  onStep(step: number, v: Voice): void;
}

const bright: Song = {
  bpm: 132,
  onStep(s, v) {
    const roots = [48, 45, 41, 43]; // C Am F G
    const lead = [
      72, -1, 76, 79, 76, -1, 74, 72, 69, -1, 72, 76, 72, -1, 69, 67,
      65, -1, 69, 72, 77, -1, 76, 74, 67, -1, 71, 74, 79, 77, 76, 74,
    ];
    const bar = Math.floor(s / 8) % 4;
    const step = 60 / this.bpm / 2;
    if (s % 2 === 0) v.note(roots[bar] + (s % 4 === 2 ? 7 : 0), 'triangle', step * 1.8, 0.5);
    if (s % 8 === 4) for (const iv of [12, bar === 1 ? 15 : 16, 19]) v.note(roots[bar] + iv, 'square', step * 0.9, 0.06);
    const m = lead[s % 32];
    if (s >= 32 && m > 0) v.note(m, 'square', step * 0.9, 0.1);
    if (s % 2 === 1) v.noise(0.05, 0.12, 6000);
  },
};

const dusk: Song = {
  bpm: 84,
  onStep(s, v) {
    // Fmaj7 – Em7 – Dm7 – Cmaj7
    const chords = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]];
    const bar = Math.floor(s / 8) % 4;
    const c = chords[bar];
    const step = 60 / this.bpm / 2;
    if (s % 8 === 0) {
      v.note(c[0] - 12, 'triangle', step * 7.5, 0.4, { attack: 0.05 });
      for (const n of c) v.note(n, 'sine', step * 7.8, 0.05, { attack: 0.4 });
    }
    // 琶音：上下來回
    const arp = [0, 1, 2, 3, 2, 1, 2, 3];
    v.note(c[arp[s % 8]] + 12, 'triangle', step * 1.6, 0.07);
    // 長音旋律（後半段進來）
    const lead = [76, -1, -1, 74, 72, -1, -1, -1, 74, -1, -1, 72, 69, -1, -1, -1,
      72, -1, -1, 71, 67, -1, -1, -1, 69, -1, 71, -1, 72, -1, -1, -1];
    const m = lead[s % 32];
    if (s >= 32 && m > 0) v.note(m, 'sine', step * 3.5, 0.11, { vibrato: 4, attack: 0.08 });
    if (s % 4 === 2) v.noise(0.08, 0.05, 7000);
  },
};

const night: Song = {
  bpm: 96,
  onStep(s, v) {
    // Am – F – C – G（小調的都會感）
    const chords = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]];
    const roots = [45, 41, 48, 43];
    const bar = Math.floor(s / 8) % 4;
    const step = 60 / this.bpm / 2;
    // 低音：八分音符跳動
    if (s % 2 === 0) v.note(roots[bar] - (s % 8 === 6 ? 5 : 0), 'square', step * 0.9, 0.08);
    // 電鋼琴般的反拍和弦
    if (s % 4 === 2) for (const n of chords[bar]) v.note(n, 'triangle', step * 1.4, 0.06, { attack: 0.005 });
    // hi-hat
    v.noise(0.03, s % 2 ? 0.05 : 0.09, 8000);
    if (s % 8 === 4) v.noise(0.12, 0.12, 1800); // 小鼓
    // 小調五聲旋律
    const lead = [69, -1, 72, -1, 74, 76, -1, 74, 72, -1, 69, -1, 67, -1, 69, -1,
      65, -1, 69, 72, -1, 74, 72, -1, 71, -1, 67, -1, 69, -1, -1, -1];
    const m = lead[s % 32];
    if (s >= 16 && m > 0) v.note(m + 12, 'sine', step * 1.6, 0.07, { vibrato: 3 });
  },
};

const mountain: Song = {
  bpm: 70,
  onStep(s, v) {
    // D 五聲音階：D – Bm – G – A
    const roots = [50, 47, 43, 45];
    const bar = Math.floor(s / 8) % 4;
    const step = 60 / this.bpm / 2;
    if (s % 8 === 0) {
      v.note(roots[bar] - 12, 'sine', step * 7.5, 0.35, { attack: 0.2 });
      v.note(roots[bar] + 7, 'sine', step * 7.5, 0.05, { attack: 0.6 });
    }
    // 笛聲：帶顫音的長音
    const flute = [74, -1, 76, -1, 78, -1, -1, -1, 81, -1, 78, -1, 76, -1, -1, -1,
      74, -1, 71, -1, 69, -1, -1, -1, 71, -1, 74, -1, 76, -1, -1, -1];
    const m = flute[s % 32];
    if (m > 0) v.note(m, 'sine', step * 2.4, 0.1, { vibrato: 6, attack: 0.06 });
    // 木魚
    if (s % 8 === 6) v.note(84, 'sine', 0.05, 0.08);
    if (s % 16 === 7) v.note(88, 'sine', 0.04, 0.05);
  },
};

export const SONGS: Record<MusicId, Song> = { bright, dusk, night, mountain };
