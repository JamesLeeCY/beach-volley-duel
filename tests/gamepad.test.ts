import { describe, expect, it } from 'vitest';
import { DEFAULT_PAD_MAP, padButtonLabel, sanitizePadMap } from '../src/input/gamepad';

describe('手把按鍵設定', () => {
  it('格式錯誤或用到 D-pad 時退回預設', () => {
    expect(sanitizePadMap(null)).toEqual(DEFAULT_PAD_MAP);
    expect(sanitizePadMap({ jump: [12], hit: [3] })).toEqual({ jump: DEFAULT_PAD_MAP.jump, hit: [3] });
    expect(sanitizePadMap({ jump: 'x', hit: [] })).toEqual(DEFAULT_PAD_MAP);
  });

  it('保留合法的自訂', () => {
    expect(sanitizePadMap({ jump: [3], hit: [0, 5] })).toEqual({ jump: [3], hit: [0, 5] });
  });

  it('按鈕名稱', () => {
    expect(padButtonLabel(0)).toContain('A');
    expect(padButtonLabel(3)).toContain('Y');
    expect(padButtonLabel(20)).toBe('#20');
  });
});
