import { IN_DOWN, IN_HIT, IN_LEFT, IN_RIGHT, IN_UP, type InputFrame } from '../engine/types';

const DEAD = 0.4;

/** 標準配置：D-pad／左搖桿移動、A 跳、B 或 X 擊球 */
export function readGamepad(index: number): InputFrame {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const list = [...pads].filter((p): p is Gamepad => !!p);
  const gp = list[index];
  if (!gp) return 0;
  const b = (i: number) => !!gp.buttons[i]?.pressed;
  const ax = gp.axes[0] ?? 0;
  const ay = gp.axes[1] ?? 0;
  let v = 0;
  if (b(14) || ax < -DEAD) v |= IN_LEFT;
  if (b(15) || ax > DEAD) v |= IN_RIGHT;
  if (b(12) || b(0) || ay < -DEAD * 1.5) v |= IN_UP;
  if (b(13) || ay > DEAD) v |= IN_DOWN;
  if (b(1) || b(2)) v |= IN_HIT;
  return v;
}

export function gamepadCount(): number {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  return [...pads].filter(Boolean).length;
}
