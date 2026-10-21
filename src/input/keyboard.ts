import { IN_DOWN, IN_HIT, IN_LEFT, IN_RIGHT, IN_UP, type InputFrame } from '../engine/types';

export interface KeyMap {
  left: string[];
  right: string[];
  up: string[];
  down: string[];
  hit: string[];
}

export type KeyAction = keyof KeyMap;
export const KEY_ACTIONS: KeyAction[] = ['left', 'right', 'up', 'down', 'hit'];

export const DEFAULT_KEYMAP_1P: Readonly<KeyMap> = {
  left: ['KeyA'],
  right: ['KeyD'],
  up: ['KeyW'],
  down: ['KeyS'],
  hit: ['KeyT'],
};

export const DEFAULT_KEYMAP_2P: Readonly<KeyMap> = {
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  hit: ['KeyM'],
};

/** v1 的預設鍵位（用來判斷存檔是否從未改過，可安全升級為新預設） */
export const LEGACY_KEYMAPS: Readonly<[KeyMap, KeyMap]> = [
  { left: ['KeyD'], right: ['KeyG'], up: ['KeyR'], down: ['KeyF', 'KeyV'], hit: ['KeyZ'] },
  { left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], down: ['ArrowDown'], hit: ['Enter', 'NumpadEnter'] },
];

/** 不可綁定的按鍵（暫停／返回／全域快捷鍵） */
const RESERVED = new Set(['Escape', 'Space', 'KeyP', 'Tab', 'F5', 'F11', 'F12', 'MetaLeft', 'MetaRight']);

export function cloneKeymap(m: Readonly<KeyMap>): KeyMap {
  return { left: [...m.left], right: [...m.right], up: [...m.up], down: [...m.down], hit: [...m.hit] };
}

/** 目前使用中的鍵位（就地修改，讓其他模組持有的參照保持有效） */
export const KEYMAP_1P: KeyMap = cloneKeymap(DEFAULT_KEYMAP_1P);
export const KEYMAP_2P: KeyMap = cloneKeymap(DEFAULT_KEYMAP_2P);

/**
 * 單人模式（對戰電腦、練習、線上）額外接受的擊球鍵：空白鍵或 J。
 * 方向鍵在單人模式本來就能移動（兩套鍵位都控制自己）。J 已被綁成其他動作時就不加。
 */
export const SOLO_KEYMAP: KeyMap = { left: [], right: [], up: [], down: [], hit: ['Space', 'KeyJ'] };

let gameKeys = new Set<string>();
function refreshGameKeys() {
  const bound = [KEYMAP_1P, KEYMAP_2P].flatMap((m) => KEY_ACTIONS.flatMap((a) => m[a]));
  SOLO_KEYMAP.hit = ['Space', 'KeyJ'].filter((k) => !bound.includes(k));
  gameKeys = new Set(bound.concat(['Space', 'KeyJ']));
}
refreshGameKeys();

export function canBind(code: string): boolean {
  return !!code && !RESERVED.has(code);
}

/** 檢查並修正存檔中的鍵位；格式錯誤的部分退回預設 */
export function sanitizeKeymap(raw: unknown, fallback: Readonly<KeyMap>): KeyMap {
  const out = cloneKeymap(fallback);
  if (!raw || typeof raw !== 'object') return out;
  for (const a of KEY_ACTIONS) {
    const v = (raw as Record<string, unknown>)[a];
    if (Array.isArray(v)) out[a] = v.filter((c): c is string => typeof c === 'string' && canBind(c)).slice(0, 4);
  }
  return out;
}

/**
 * 把 code 綁到 maps[side][action]（取代該動作原本的按鍵），
 * 並從其他所有動作移除同一個鍵，避免一鍵兩用。回傳新的鍵位（不修改輸入）。
 */
export function rebind(maps: [KeyMap, KeyMap], side: 0 | 1, action: KeyAction, code: string): [KeyMap, KeyMap] {
  const next: [KeyMap, KeyMap] = [cloneKeymap(maps[0]), cloneKeymap(maps[1])];
  if (!canBind(code)) return next;
  for (const m of next) for (const a of KEY_ACTIONS) m[a] = m[a].filter((c) => c !== code);
  next[side][action] = [code];
  return next;
}

/** 套用鍵位到使用中的 KEYMAP_1P / KEYMAP_2P */
export function applyKeymaps(p1: KeyMap, p2: KeyMap) {
  Object.assign(KEYMAP_1P, cloneKeymap(p1));
  Object.assign(KEYMAP_2P, cloneKeymap(p2));
  refreshGameKeys();
}

/** 按鍵代碼的顯示名稱 */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  const named: Record<string, string> = {
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Enter: 'Enter',
    ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
    AltLeft: 'L-Alt', AltRight: 'R-Alt', Slash: '/', Period: '.', Comma: ',', Semicolon: ';',
    Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\',Minus: '-', Equal: '=', Backquote: '`',
  };
  return named[code] ?? code;
}

export class Keyboard {
  readonly down = new Set<string>();
  private listeners: ((code: string, e: KeyboardEvent) => void)[] = [];

  constructor() {
    window.addEventListener('keydown', (e) => {
      const typing = e.target instanceof HTMLInputElement;
      if (!typing && gameKeys.has(e.code)) e.preventDefault();
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
  // 空白鍵與 Enter 在選單中一律是確認
  if (code === 'Space' || code === 'Enter' || code === 'NumpadEnter') return 'ok';
  return null;
}

export function keymapSide(code: string): 0 | 1 | null {
  const has = (m: KeyMap) => KEY_ACTIONS.some((a) => m[a].includes(code));
  if (has(KEYMAP_1P)) return 0;
  if (has(KEYMAP_2P)) return 1;
  return null;
}
