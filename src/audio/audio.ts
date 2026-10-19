// 音效與背景音樂全部用 Web Audio 即時合成（原創，無外部素材）。
import { FIELD_W } from '../engine/constants';
import type { GameEventType } from '../engine/types';
import { SONGS, type MusicId, type Song, type Voice } from './music';

type SfxMode = 'stereo' | 'mono' | 'off';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private bgmBus!: GainNode;
  private noiseBuf!: AudioBuffer;
  private sfxMode: SfxMode = 'stereo';
  private bgmOn = true;
  private bgmTimer: number | null = null;
  private bgmStep = 0;
  private bgmNext = 0;

  /** 行動裝置需在使用者手勢中解鎖 */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.connect(this.master);
      this.bgmBus = this.ctx.createGain();
      this.bgmBus.gain.value = 0.18;
      this.bgmBus.connect(this.master);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.syncBgm();
  }

  configure(sfx: SfxMode, bgm: boolean) {
    this.sfxMode = sfx;
    this.bgmOn = bgm;
    this.syncBgm();
  }

  private out(x: number | null): AudioNode {
    const ctx = this.ctx!;
    if (this.sfxMode === 'stereo' && x !== null && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, (x / FIELD_W) * 2 - 1)) * 0.8;
      p.connect(this.sfxBus);
      return p;
    }
    return this.sfxBus;
  }

  private tone(dest: AudioNode, type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dest: AudioNode, dur: number, vol: number, freq: number, q = 1, delay = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  play(type: GameEventType, x: number | null = null) {
    if (!this.ctx || this.sfxMode === 'off' || this.ctx.state !== 'running') return;
    const o = this.out(x);
    switch (type) {
      case 'serve':
        this.tone(o, 'square', 660, 880, 0.08, 0.08);
        this.tone(o, 'square', 880, 990, 0.08, 0.06, 0.08);
        break;
      case 'bump':
        this.tone(o, 'sine', 320, 140, 0.12, 0.5);
        this.noise(o, 0.05, 0.25, 1800, 0.8);
        break;
      case 'spike':
        this.noise(o, 0.18, 0.6, 2500, 0.6);
        this.tone(o, 'square', 900, 120, 0.2, 0.18);
        this.tone(o, 'sine', 160, 60, 0.15, 0.5);
        break;
      case 'ground':
        this.tone(o, 'sine', 120, 40, 0.25, 0.6);
        this.noise(o, 0.3, 0.35, 600, 0.7);
        break;
      case 'net':
        this.noise(o, 0.12, 0.25, 3500, 4);
        break;
      case 'wall':
        this.tone(o, 'triangle', 500, 300, 0.05, 0.15);
        break;
      case 'jump':
        this.tone(o, 'square', 300, 600, 0.09, 0.05);
        break;
      case 'dive':
        this.noise(o, 0.2, 0.25, 900, 0.5);
        break;
      case 'score':
        [523, 659, 784].forEach((f, i) => this.tone(this.sfxBus, 'square', f, f, 0.1, 0.08, i * 0.08));
        break;
      case 'win':
        [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(this.sfxBus, 'square', f, f * 1.001, 0.16, 0.09, i * 0.13));
        break;
    }
  }

  /** 選單音 */
  blip(up = true) {
    if (!this.ctx || this.sfxMode === 'off' || this.ctx.state !== 'running') return;
    this.tone(this.sfxBus, 'square', up ? 880 : 660, up ? 990 : 550, 0.05, 0.05);
  }

  private syncBgm() {
    if (!this.ctx) return;
    if (this.bgmOn && this.bgmTimer === null) {
      this.bgmNext = this.ctx.currentTime + 0.1;
      this.bgmTimer = window.setInterval(() => this.scheduleBgm(), 100);
    } else if (!this.bgmOn && this.bgmTimer !== null) {
      clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
  }

  private song: Song = SONGS.bright;
  private songId: MusicId = 'bright';

  /** 切換曲風（從下一個八分音符起換成新曲子的開頭） */
  setMusic(id: MusicId) {
    if (id === this.songId) return;
    this.songId = id;
    this.song = SONGS[id];
    this.bgmStep = 0;
  }

  private scheduleBgm() {
    const ctx = this.ctx!;
    if (ctx.state !== 'running') return;
    while (this.bgmNext < ctx.currentTime + 0.3) {
      const t = this.bgmNext;
      const voice: Voice = {
        note: (midi, wave, dur, vol, opts = {}) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = wave;
          o.frequency.value = 440 * 2 ** ((midi - 69) / 12);
          if (opts.vibrato) {
            const lfo = ctx.createOscillator();
            const depth = ctx.createGain();
            lfo.frequency.value = 5.5;
            depth.gain.value = opts.vibrato;
            lfo.connect(depth).connect(o.frequency);
            lfo.start(t);
            lfo.stop(t + dur + 0.05);
          }
          const attack = opts.attack ?? 0.005;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(vol, t + attack);
          g.gain.exponentialRampToValueAtTime(0.001, t + dur);
          o.connect(g).connect(this.bgmBus);
          o.start(t);
          o.stop(t + dur + 0.05);
        },
        noise: (dur, vol, highpass) => {
          const src = ctx.createBufferSource();
          src.buffer = this.noiseBuf;
          const f = ctx.createBiquadFilter();
          f.type = 'highpass';
          f.frequency.value = highpass;
          const g = ctx.createGain();
          g.gain.setValueAtTime(vol, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + dur);
          src.connect(f).connect(g).connect(this.bgmBus);
          src.start(t, Math.random() * 0.5);
          src.stop(t + dur + 0.02);
        },
      };
      this.song.onStep(this.bgmStep % 64, voice);
      this.bgmStep++;
      this.bgmNext += 60 / this.song.bpm / 2;
    }
  }
}

export const audio = new AudioEngine();
