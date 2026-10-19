import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { parsePackZip, PackError } from '../src/characters/packZip';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const manifest = {
  id: 'zed',
  name: { en: 'Zed' },
  sprite: 'sprite.png',
  frameSize: [64, 64],
  animations: { idle: { row: 0, frames: 2, fps: 6 } },
  stats: { speed: 1, jump: 0, power: -1 },
};

const zip = (files: Record<string, Uint8Array>) => zipSync(files);

describe('character pack zip', () => {
  it('reads manifest and files at the zip root', () => {
    const p = parsePackZip(zip({ 'manifest.json': strToU8(JSON.stringify(manifest)), 'sprite.png': PNG }));
    expect(p.manifest.id).toBe('zed');
    expect(p.manifest.stats).toEqual({ speed: 1, jump: 0, power: -1 });
    expect(Object.keys(p.files)).toEqual(['sprite.png']);
  });

  it('accepts a pack nested in one folder', () => {
    const p = parsePackZip(zip({
      'zed/manifest.json': strToU8(JSON.stringify({ ...manifest, portrait: 'img/face.png' })),
      'zed/sprite.png': PNG,
      'zed/img/face.png': PNG,
      '__MACOSX/zed/._sprite.png': PNG,
    }));
    expect(Object.keys(p.files).sort()).toEqual(['img/face.png', 'sprite.png']);
  });

  it('rejects broken packs with a reason', () => {
    const cases: [Uint8Array, RegExp][] = [
      [new Uint8Array([1, 2, 3]), /not a zip/],
      [zip({ 'sprite.png': PNG }), /manifest.json missing/],
      [zip({ 'manifest.json': strToU8('{oops') }), /not valid JSON/],
      [zip({ 'manifest.json': strToU8(JSON.stringify({ ...manifest, id: 'Bad Id' })), 'sprite.png': PNG }), /manifest: id/],
      [zip({ 'manifest.json': strToU8(JSON.stringify(manifest)) }), /sprite "sprite.png" missing/],
    ];
    for (const [bytes, msg] of cases) {
      expect(() => parsePackZip(bytes)).toThrow(PackError);
      expect(() => parsePackZip(bytes)).toThrow(msg);
    }
  });
});
