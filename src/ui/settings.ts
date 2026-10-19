import type { Speed } from '../engine/constants';
import { detectLang, type Lang } from '../i18n';
import { cloneKeymap, DEFAULT_KEYMAP_1P, DEFAULT_KEYMAP_2P, sanitizeKeymap, type KeyMap } from '../input/keyboard';

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
  vibrate: boolean;
  lang: Lang;
  selfLeft: boolean;
  /** 鍵盤鍵位：[1P, 2P] */
  keys: [KeyMap, KeyMap];
}

const KEY = 'bvd.settings.v1';

export function defaultSettings(): Settings {
  return {
    speed: 'normal',
    targetScore: 15,
    graphics: 'sharp',
    bgm: true,
    sfx: 'stereo',
    balance: true,
    touchSize: 'medium',
    touchOpacity: 0.6,
    touchSwap: false,
    vibrate: true,
    lang: detectLang(),
    selfLeft: true,
    keys: [cloneKeymap(DEFAULT_KEYMAP_1P), cloneKeymap(DEFAULT_KEYMAP_2P)],
  };
}

export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      const keys = Array.isArray(saved?.keys) ? saved.keys : [];
      return {
        ...d,
        ...saved,
        keys: [sanitizeKeymap(keys[0], DEFAULT_KEYMAP_1P), sanitizeKeymap(keys[1], DEFAULT_KEYMAP_2P)],
      };
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
