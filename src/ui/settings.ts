import type { Speed } from '../engine/constants';
import { detectLang, type Lang } from '../i18n';
import { cloneKeymap, DEFAULT_KEYMAP_1P, DEFAULT_KEYMAP_2P, LEGACY_KEYMAPS, sanitizeKeymap, type KeyMap } from '../input/keyboard';

export interface Settings {
  speed: Speed;
  targetScore: 5 | 10 | 15;
  graphics: 'sharp' | 'smooth';
  bgm: boolean;
  sfx: 'stereo' | 'mono' | 'off';
  balance: boolean;
  touchSize: 'small' | 'medium' | 'large';
  touchOpacity: number;
  touchSwap: boolean;
  /** 搖桿：浮動（手指按哪就出現在哪）或固定在左下角 */
  touchStick: 'float' | 'fixed';
  vibrate: boolean;
  lang: Lang;
  selfLeft: boolean;
  /** 鍵盤鍵位：[1P, 2P] */
  keys: [KeyMap, KeyMap];
  /** 預設鍵位版本；v2 起 1P 為 WASD＋T、2P 為方向鍵＋M */
  keysVersion: number;
}

export const KEYS_VERSION = 2;

const KEY = 'bvd.settings.v1';

export function defaultSettings(): Settings {
  return {
    speed: 'normal',
    targetScore: 15,
    graphics: 'smooth',
    bgm: true,
    sfx: 'stereo',
    balance: true,
    touchSize: 'medium',
    touchOpacity: 0.6,
    touchSwap: false,
    touchStick: 'float',
    vibrate: true,
    lang: detectLang(),
    selfLeft: true,
    keys: [cloneKeymap(DEFAULT_KEYMAP_1P), cloneKeymap(DEFAULT_KEYMAP_2P)],
    keysVersion: KEYS_VERSION,
  };
}

/** 舊版存檔：若某一側的鍵位仍是 v1 預設，就換成新預設；玩家自訂過的保留 */
function migrateKeys(keys: [KeyMap, KeyMap], version: number): [KeyMap, KeyMap] {
  if (version >= KEYS_VERSION) return keys;
  const same = (a: KeyMap, b: KeyMap) => JSON.stringify(a) === JSON.stringify(b);
  return [
    same(keys[0], LEGACY_KEYMAPS[0]) ? cloneKeymap(DEFAULT_KEYMAP_1P) : keys[0],
    same(keys[1], LEGACY_KEYMAPS[1]) ? cloneKeymap(DEFAULT_KEYMAP_2P) : keys[1],
  ];
}

export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      const raw2 = Array.isArray(saved?.keys) ? saved.keys : null;
      const version = Number(saved?.keysVersion) || 1;
      const fb = version >= KEYS_VERSION ? [DEFAULT_KEYMAP_1P, DEFAULT_KEYMAP_2P] : LEGACY_KEYMAPS;
      const keys: [KeyMap, KeyMap] = raw2
        ? migrateKeys([sanitizeKeymap(raw2[0], fb[0]), sanitizeKeymap(raw2[1], fb[1])], version)
        : d.keys;
      return { ...d, ...saved, keys, keysVersion: KEYS_VERSION };
    }
  } catch {
    // 無痕模式等情況：使用預設值
  }
  return d;
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // 忽略
  }
}
