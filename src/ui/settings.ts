import type { Speed } from '../engine/constants';
import { detectLang, type Lang } from '../i18n';

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
  };
}

export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...d, ...JSON.parse(raw) };
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
