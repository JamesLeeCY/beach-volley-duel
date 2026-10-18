import { IN_DOWN, IN_HIT, IN_LEFT, IN_RIGHT, IN_UP, type InputFrame } from '../engine/types';

export interface KeyMap {
  left: string[];
  right: string[];
  up: string[];
  down: string[];
  hit: string[];
}

export const KEYMAP_1P: KeyMap = {
  left: ['KeyD'],
  right: ['KeyG'],
  up: ['KeyR'],
  down: ['KeyF', 'KeyV'],
  hit: ['KeyZ'],
};

export const KEYMAP_2P: KeyMap = {
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  hit: ['Enter', 'NumpadEnter'],
};

const GAME_KEYS = new Set(
  [KEYMAP_1P, KEYMAP_2P].flatMap((m) => [...m.left, ...m.right, ...m.up, ...m.down, ...m.hit]).concat(['Space']),
);

export class Keyboard {
  readonly down = new Set<string>();
  private listeners: ((code: string, e: KeyboardEvent) => void)[] = [];

  constructor() {
    window.addEventListener('keydown', (e) => {
      const typing = e.target instanceof HTMLInputElement;
      if (!typing && GAME_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) for (const l of this.listeners) l(e.code, e);
      if (!typing) this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  onPress(fn: (code: string, e: KeyboardEvent) => void) {
    this.listeners.push(fn);
  }

  read(map: KeyMap): InputFrame {
    const any = (codes: string[]) => codes.some((c) => this.down.has(c));
    let v = 0;
    if (any(map.left)) v |= IN_LEFT;
    if (any(map.right)) v |= IN_RIGHT;
    if (any(map.up)) v |= IN_UP;
    if (any(map.down)) v |= IN_DOWN;
    if (any(map.hit)) v |= IN_HIT;
    return v;
  }
}

/** 某個按鍵代表的選單方向與確認（兩套按鍵都可用） */
export function menuAction(code: string): 'left' | 'right' | 'up' | 'down' | 'ok' | null {
  for (const m of [KEYMAP_1P, KEYMAP_2P]) {
    if (m.left.includes(code)) return 'left';
    if (m.right.includes(code)) return 'right';
    if (m.up.includes(code)) return 'up';
    if (m.down.includes(code)) return 'down';
    if (m.hit.includes(code)) return 'ok';
  }
  if (code === 'Space') return 'ok';
  return null;
}

export function keymapSide(code: string): 0 | 1 | null {
  const has = (m: KeyMap) => [...m.left, ...m.right, ...m.up, ...m.down, ...m.hit].includes(code);
  if (has(KEYMAP_1P)) return 0;
  if (has(KEYMAP_2P)) return 1;
  return null;
}
