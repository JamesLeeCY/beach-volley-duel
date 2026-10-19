import { describe, expect, it } from 'vitest';
import { SONGS, type Voice } from '../src/audio/music';

describe('背景音樂', () => {
  for (const [id, song] of Object.entries(SONGS)) {
    it(`${id}：每一拍都產生合法的音`, () => {
      let notes = 0;
      const v: Voice = {
        note: (midi, _wave, dur, vol) => {
          notes++;
          expect(midi).toBeGreaterThanOrEqual(24);
          expect(midi).toBeLessThanOrEqual(108);
          expect(dur).toBeGreaterThan(0);
          expect(vol).toBeGreaterThan(0);
          expect(vol).toBeLessThanOrEqual(1);
        },
        noise: (dur, vol) => {
          expect(dur).toBeGreaterThan(0);
          expect(vol).toBeGreaterThan(0);
        },
      };
      for (let s = 0; s < 64; s++) song.onStep(s, v);
      expect(notes).toBeGreaterThan(20);
      expect(song.bpm).toBeGreaterThan(40);
    });
  }
});
