// 手機觸控（荒野亂鬥式）：
// - 左半邊任意位置按下，搖桿就出現在手指下（浮動搖桿）；放開回到左下角待命位置。
// - 右下大圓鈕＝擊球：點一下直接擊球；按住拖曳可以瞄準（拖的方向＝扣殺球路，同方向鍵）。
// - 擊球鈕左上方的小圓鈕＝跳。
// 各按鍵以 pointerId 獨立追蹤，可同時「移動＋跳＋擊球」。
import { IN_DOWN, IN_HIT, IN_LEFT, IN_RIGHT, IN_UP, type InputFrame } from '../engine/types';
import type { Settings } from '../ui/settings';

/** 搖桿推動量（0～1）超過此值才算有方向 */
const DEAD = 0.28;
/** 上／下要推得比較明確才算，避免左右移動時誤跳 */
const VERT = 0.55;

function dirBits(nx: number, ny: number, mag: number): number {
  if (mag < DEAD) return 0;
  let v = 0;
  if (nx < -0.38) v |= IN_LEFT;
  if (nx > 0.38) v |= IN_RIGHT;
  if (ny < -VERT) v |= IN_UP;
  if (ny > VERT) v |= IN_DOWN;
  return v;
}

interface Stick {
  base: HTMLDivElement;
  knob: HTMLDivElement;
  pointer: number | null;
  cx: number;
  cy: number;
  bits: number;
}

export class TouchControls {
  readonly root: HTMLDivElement;
  private zone: HTMLDivElement;
  private move: Stick;
  private aimRing: HTMLDivElement;
  private aimKnob: HTMLDivElement;
  private hitBtn: HTMLDivElement;
  private jumpBtn: HTMLDivElement;
  private hitPointer: number | null = null;
  private aimBits = 0;
  private hitCx = 0;
  private hitCy = 0;
  private jumpPointers = new Set<number>();
  private vibrate = true;
  private floating = true;
  private swapped = false;

  constructor(parent: HTMLElement) {
    this.root = this.el('touch-controls');
    // 搖桿感應區：螢幕左半邊（或互換後右半邊）
    this.zone = this.el('touch-zone');
    const base = this.el('stick-base');
    const knob = this.el('stick-knob');
    base.append(knob);
    this.zone.append(base);
    this.move = { base, knob, pointer: null, cx: 0, cy: 0, bits: 0 };

    const actions = this.el('touch-actions');
    this.hitBtn = this.el('touch-btn touch-hit');
    this.aimRing = this.el('aim-ring');
    this.aimKnob = this.el('aim-knob');
    this.hitBtn.append(this.aimRing, this.aimKnob, this.el('btn-icon hit-icon'));
    this.jumpBtn = this.el('touch-btn touch-jump');
    this.jumpBtn.append(this.el('btn-icon jump-icon'));
    actions.append(this.jumpBtn, this.hitBtn);
    this.root.append(this.zone, actions);
    parent.appendChild(this.root);

    this.bindStick();
    this.bindHit();
    this.bindJump();
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('resize', () => this.resetStick());
  }

  private el(cls: string): HTMLDivElement {
    const d = document.createElement('div');
    d.className = cls;
    return d;
  }

  private buzz() {
    if (this.vibrate && navigator.vibrate) navigator.vibrate(10);
  }

  // ------------------------------------------------------------ 移動搖桿
  private bindStick() {
    const s = this.move;
    this.zone.addEventListener('pointerdown', (e) => {
      if (s.pointer !== null) return;
      e.preventDefault();
      s.pointer = e.pointerId;
      try {
        this.zone.setPointerCapture(e.pointerId);
      } catch {
        // 已放開的指標
      }
      const z = this.zone.getBoundingClientRect();
      const r = s.base.getBoundingClientRect();
      const rad = r.width / 2;
      if (this.floating) {
        // 浮動：搖桿中心移到手指位置（保持整顆在畫面內）
        const x = Math.min(Math.max(e.clientX, z.left + rad), z.right - rad);
        const y = Math.min(Math.max(e.clientY, z.top + rad), z.bottom - rad);
        s.cx = x;
        s.cy = y;
        s.base.style.left = `${x - z.left - rad}px`;
        s.base.style.top = `${y - z.top - rad}px`;
        s.base.style.bottom = 'auto';
      } else {
        s.cx = r.left + rad;
        s.cy = r.top + rad;
      }
      s.base.classList.add('active');
      this.updateStick(e);
    });
    this.zone.addEventListener('pointermove', (e) => {
      if (e.pointerId === s.pointer) this.updateStick(e);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== s.pointer) return;
      s.pointer = null;
      s.bits = 0;
      s.knob.style.transform = '';
      s.base.classList.remove('active');
      this.resetStick();
    };
    this.zone.addEventListener('pointerup', end);
    this.zone.addEventListener('pointercancel', end);
  }

  private updateStick(e: PointerEvent) {
    const s = this.move;
    const rad = s.base.getBoundingClientRect().width / 2;
    const dx = e.clientX - s.cx;
    const dy = e.clientY - s.cy;
    const dist = Math.hypot(dx, dy);
    const mag = Math.min(1, dist / rad);
    const nx = dist ? dx / dist : 0;
    const ny = dist ? dy / dist : 0;
    s.knob.style.transform = `translate(${nx * mag * rad * 0.6}px, ${ny * mag * rad * 0.6}px)`;
    const bits = dirBits(nx, ny, mag);
    if (bits !== s.bits && bits) this.buzz();
    s.bits = bits;
  }

  /** 搖桿回到待命位置（左下角） */
  private resetStick() {
    const b = this.move.base;
    b.style.left = '';
    b.style.top = '';
    b.style.bottom = '';
  }

  // ------------------------------------------------------------ 擊球（可瞄準）
  private bindHit() {
    const btn = this.hitBtn;
    btn.addEventListener('pointerdown', (e) => {
      if (this.hitPointer !== null) return;
      e.preventDefault();
      this.hitPointer = e.pointerId;
      try {
        btn.setPointerCapture(e.pointerId);
      } catch {
        // 已放開的指標
      }
      const r = btn.getBoundingClientRect();
      this.hitCx = r.left + r.width / 2;
      this.hitCy = r.top + r.height / 2;
      this.aimBits = 0;
      btn.classList.add('active');
      this.buzz();
    });
    btn.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.hitPointer) return;
      const rad = btn.getBoundingClientRect().width / 2;
      const dx = e.clientX - this.hitCx;
      const dy = e.clientY - this.hitCy;
      const dist = Math.hypot(dx, dy);
      const mag = Math.min(1, dist / (rad * 1.2));
      const nx = dist ? dx / dist : 0;
      const ny = dist ? dy / dist : 0;
      const bits = dirBits(nx, ny, mag);
      btn.classList.toggle('aiming', bits !== 0);
      this.aimKnob.style.transform = bits ? `translate(${nx * rad * 0.9}px, ${ny * rad * 0.9}px)` : '';
      this.aimRing.style.transform = bits ? `rotate(${Math.atan2(ny, nx)}rad)` : '';
      if (bits !== this.aimBits && bits) this.buzz();
      this.aimBits = bits;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.hitPointer) return;
      this.hitPointer = null;
      this.aimBits = 0;
      btn.classList.remove('active', 'aiming');
      this.aimKnob.style.transform = '';
      this.aimRing.style.transform = '';
    };
    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointercancel', end);
  }

  // ------------------------------------------------------------ 跳
  private bindJump() {
    const btn = this.jumpBtn;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.jumpPointers.add(e.pointerId);
      btn.classList.add('active');
      this.buzz();
    });
    const up = (e: PointerEvent) => {
      this.jumpPointers.delete(e.pointerId);
      if (!this.jumpPointers.size) btn.classList.remove('active');
    };
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
  }

  apply(s: Settings) {
    this.vibrate = s.vibrate;
    this.floating = s.touchStick !== 'fixed';
    this.swapped = s.touchSwap;
    const size = { small: 0.8, medium: 1, large: 1.25 }[s.touchSize];
    this.root.style.setProperty('--touch-scale', String(size));
    this.root.style.setProperty('--touch-opacity', String(s.touchOpacity));
    this.root.classList.toggle('swapped', this.swapped);
    this.resetStick();
  }

  setVisible(v: boolean) {
    this.root.classList.toggle('visible', v);
    if (!v) {
      this.move.pointer = null;
      this.move.bits = 0;
      this.move.knob.style.transform = '';
      this.move.base.classList.remove('active');
      this.hitPointer = null;
      this.aimBits = 0;
      this.jumpPointers.clear();
      this.resetStick();
    }
  }

  read(): InputFrame {
    // 瞄準中以瞄準方向為準（決定扣殺球路）；否則用移動搖桿
    let v = this.aimBits || this.move.bits;
    if (this.jumpPointers.size) v |= IN_UP;
    if (this.hitPointer !== null) v |= IN_HIT;
    return v;
  }
}

let touchUsed = false;
window.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') touchUsed = true;
}, { capture: true });

/** 主要輸入為觸控（手機／平板），或使用者曾經用手指觸碰畫面 */
export function isTouchDevice(): boolean {
  return touchUsed || matchMedia('(pointer: coarse)').matches;
}
