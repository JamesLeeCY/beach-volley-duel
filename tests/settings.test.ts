import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEYMAP_1P, DEFAULT_KEYMAP_2P, LEGACY_KEYMAPS } from '../src/input/keyboard';

// settings.ts 需要 localStorage 與 navigator；在 Node 測試環境中以簡單替身提供
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
});
vi.stubGlobal('navigator', { language: 'zh-TW' });

const { loadSettings, KEYS_VERSION } = await import('../src/ui/settings');

afterEach(() => store.clear());

describe('settings key migration', () => {
  it('upgrades untouched v1 default keys to the new defaults', () => {
    store.set('bvd.settings.v1', JSON.stringify({ speed: 'fast', keys: LEGACY_KEYMAPS }));
    const s = loadSettings();
    expect(s.keys).toEqual([DEFAULT_KEYMAP_1P, DEFAULT_KEYMAP_2P]);
    expect(s.keysVersion).toBe(KEYS_VERSION);
    expect(s.speed).toBe('fast');
  });

  it('keeps keys the player customised in v1', () => {
    const custom = { ...LEGACY_KEYMAPS[0], hit: ['KeyQ'] };
    store.set('bvd.settings.v1', JSON.stringify({ keys: [custom, LEGACY_KEYMAPS[1]] }));
    const s = loadSettings();
    expect(s.keys[0].hit).toEqual(['KeyQ']);
    expect(s.keys[1]).toEqual(DEFAULT_KEYMAP_2P);
  });

  it('leaves v2 saves alone, even if they match the old defaults', () => {
    store.set('bvd.settings.v1', JSON.stringify({ keys: LEGACY_KEYMAPS, keysVersion: KEYS_VERSION }));
    expect(loadSettings().keys).toEqual(LEGACY_KEYMAPS);
  });

  it('uses new defaults with no save', () => {
    expect(loadSettings().keys).toEqual([DEFAULT_KEYMAP_1P, DEFAULT_KEYMAP_2P]);
  });
});
