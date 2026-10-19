import { describe, expect, it } from 'vitest';
import {
  applyKeymaps, cloneKeymap, DEFAULT_KEYMAP_1P, DEFAULT_KEYMAP_2P, KEYMAP_1P, KEYMAP_2P, keyLabel, keymapSide,
  menuAction, rebind, sanitizeKeymap,
} from '../src/input/keyboard';

const defaults = () => [cloneKeymap(DEFAULT_KEYMAP_1P), cloneKeymap(DEFAULT_KEYMAP_2P)] as [typeof KEYMAP_1P, typeof KEYMAP_2P];

describe('key rebinding', () => {
  it('replaces the action key and leaves inputs untouched', () => {
    const maps = defaults();
    const next = rebind(maps, 0, 'hit', 'KeyX');
    expect(next[0].hit).toEqual(['KeyX']);
    expect(maps[0].hit).toEqual(['KeyZ']);
  });

  it('removes the key from any other action on either side', () => {
    const next = rebind(defaults(), 0, 'left', 'ArrowLeft');
    expect(next[0].left).toEqual(['ArrowLeft']);
    expect(next[1].left).toEqual([]);
    const again = rebind(next, 0, 'up', 'KeyD');
    expect(again[0].up).toEqual(['KeyD']);
    expect(again[0].left).toEqual(['ArrowLeft']);
  });

  it('refuses reserved keys', () => {
    for (const code of ['Escape', 'Space', 'Tab', '']) expect(rebind(defaults(), 1, 'hit', code)[1].hit).toEqual(['Enter', 'NumpadEnter']);
  });

  it('sanitizes saved keymaps', () => {
    expect(sanitizeKeymap(null, DEFAULT_KEYMAP_1P)).toEqual(DEFAULT_KEYMAP_1P);
    const m = sanitizeKeymap({ left: ['KeyA', 3, 'Escape'], hit: 'nope' }, DEFAULT_KEYMAP_1P);
    expect(m.left).toEqual(['KeyA']);
    expect(m.hit).toEqual(['KeyZ']);
  });

  it('applyKeymaps updates the live maps used by menus and input', () => {
    const next = rebind(defaults(), 1, 'hit', 'KeyM');
    applyKeymaps(next[0], next[1]);
    expect(KEYMAP_2P.hit).toEqual(['KeyM']);
    expect(menuAction('KeyM')).toBe('ok');
    expect(keymapSide('KeyM')).toBe(1);
    expect(menuAction('Enter')).toBe(null);
    applyKeymaps(DEFAULT_KEYMAP_1P, DEFAULT_KEYMAP_2P);
    expect(menuAction('Enter')).toBe('ok');
  });

  it('labels keys', () => {
    expect(keyLabel('KeyQ')).toBe('Q');
    expect(keyLabel('ArrowUp')).toBe('↑');
    expect(keyLabel('Digit7')).toBe('7');
  });
});
