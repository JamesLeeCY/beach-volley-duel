import { IN_DOWN, IN_HIT, IN_LEFT, IN_RIGHT, IN_UP, type InputFrame } from '../engine/types';

const DEAD = 0.4;

/** 手把按鍵對應（標準配置的按鈕編號）；移動固定用 D-pad／左搖桿 */
export interface PadMap {
  jump: number[];
  hit: number[];
}

/** 預設：A 跳、B 或 X 擊球 */
export const DEFAULT_PAD_MAP: PadMap = { jump: [0], hit: [1, 2] };

/** D-pad 的按鈕編號，不可拿來綁定動作 */
export const DPAD_BUTTONS = new Set([12, 13, 14, 15]);

let padMap: PadMap = { jump: [...DEFAULT_PAD_MAP.jump], hit: [...DEFAULT_PAD_MAP.hit] };

export function applyPadMap(m: PadMap) {
  padMap = { jump: [...m.jump], hit: [...m.hit] };
}

/** 檢查存檔中的手把設定，格式不對就用預設 */
export function sanitizePadMap(raw: unknown): PadMap {
  const ok = (v: unknown) => Array.isArray(v) && v.length > 0 && v.every((n) => Number.isInteger(n) && n >= 0 && n < 32 && !DPAD_BUTTONS.has(n));
  const r = raw as Partial<PadMap> | null;
  return {
    jump: r && ok(r.jump) ? [...r.jump!] : [...DEFAULT_PAD_MAP.jump],
    hit: r && ok(r.hit) ? [...r.hit!] : [...DEFAULT_PAD_MAP.hit],
  };
}

/** 標準配置下按鈕的顯示名稱（Xbox／PlayStation） */
export function padButtonLabel(i: number): string {
  const names: Record<number, string> = {
    0: 'A / ✕', 1: 'B / ○', 2: 'X / □', 3: 'Y / △', 4: 'LB / L1', 5: 'RB / R1', 6: 'LT / L2', 7: 'RT / R2',
    8: 'Back / Share', 9: 'Start / Options', 10: 'L3', 11: 'R3',
  };
  return names[i] ?? `#${i}`;
}

function pads(): Gamepad[] {
  const list = navigator.getGamepads ? navigator.getGamepads() : [];
  return [...list].filter((p): p is Gamepad => !!p);
}

export function readGamepad(index: number): InputFrame {
  const gp = pads()[index];
  if (!gp) return 0;
  const b = (i: number) => !!gp.buttons[i]?.pressed;
  const ax = gp.axes[0] ?? 0;
  const ay = gp.axes[1] ?? 0;
  let v = 0;
  if (b(14) || ax < -DEAD) v |= IN_LEFT;
  if (b(15) || ax > DEAD) v |= IN_RIGHT;
  if (b(12) || padMap.jump.some(b) || ay < -DEAD * 1.5) v |= IN_UP;
  if (b(13) || ay > DEAD) v |= IN_DOWN;
  if (padMap.hit.some(b)) v |= IN_HIT;
  return v;
}

/** 任一支手把目前按下的按鈕編號（設定頁「按下要綁定的按鈕」用） */
export function pressedButtons(): Set<number> {
  const out = new Set<number>();
  for (const gp of pads()) gp.buttons.forEach((btn, i) => btn.pressed && out.add(i));
  return out;
}

export function gamepadCount(): number {
  return pads().length;
}
