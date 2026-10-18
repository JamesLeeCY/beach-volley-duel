// 手機觸控：左下 8 方向 D-pad、右下「跳」「擊球」大按鍵。各按鍵獨立追蹤 pointerId。
import { IN_DOWN, IN_HIT, IN_LEFT, IN_RIGHT, IN_UP, type InputFrame } from '../engine/types';
import type { Settings } from '../ui/settings';

export class TouchControls {
  readonly root: HTMLDivElement;
  private pad: HTMLDivElement;
  private knob: HTMLDivElement;
  private jumpBtn: HTMLDivElement;
  private hitBtn: HTMLDivElement;
  private padPointer: number | null = null;
  private padBits = 0;
  private jumpPointers = new Set<number>();
  private hitPointers = new Set<number>();
  private vibrate = true;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'touch-controls';
    this.pad = this.el('touch-pad');
    this.knob = document.createElement('div');
    this.knob.className = 'touch-knob';
    this.pad.appendChild(this.knob);
    const right = document.createElement('div');
    right.className = 'touch-buttons';
    this.jumpBtn = this.el('touch-btn touch-jump', '⤒');
    this.hitBtn = this.el('touch-btn touch-hit', '✦');
    right.append(this.jumpBtn, this.hitBtn);
    this.root.append(this.pad, right);
    parent.appendChild(this.root);

    this.pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.padPointer = e.pointerId;
      this.pad.setPointerCapture(e.pointerId);
      this.updatePad(e);
      this.buzz();
    });
    this.pad.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.padPointer) this.updatePad(e);
    });
    const endPad = (e: PointerEvent) => {
      if (e.pointerId !== this.padPointer) return;
      this.padPointer = null;
      this.padBits = 0;
      this.knob.style.transform = '';
    };
    this.pad.addEventListener('pointerup', endPad);
    this.pad.addEventListener('pointercancel', endPad);

    this.bindButton(this.jumpBtn, this.jumpPointers);
    this.bindButton(this.hitBtn, this.hitPointers);
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private el(cls: string, text = ''): HTMLDivElement {
    const d = document.createElement('div');
    d.className = cls;
    d.textContent = text;
    return d;
  }

  private buzz() {
    if (this.vibrate && navigator.vibrate) navigator.vibrate(10);
  }

  private bindButton(btn: HTMLElement, set: Set<number>) {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      set.add(e.pointerId);
      btn.classList.add('active');
      this.buzz();
    });
    const up = (e: PointerEvent) => {
      set.delete(e.pointerId);
      if (!set.size) btn.classList.remove('active');
    };
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
  }

  private updatePad(e: PointerEvent) {
    const r = this.pad.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const dist = Math.hypot(dx, dy);
    const max = r.width / 2;
    const k = Math.min(1, dist / max);
    this.knob.style.transform = `translate(${(dx / (dist || 1)) * k * max * 0.5}px, ${(dy / (dist || 1)) * k * max * 0.5}px)`;
    if (dist < max * 0.2) {
      this.padBits = 0;
      return;
    }
    // 8 方向：以 45° 為一區
    const sector = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
    const dirs: Record<number, number> = {
      0: IN_RIGHT, 1: IN_RIGHT | IN_DOWN, 2: IN_DOWN, 3: IN_LEFT | IN_DOWN,
      4: IN_LEFT, [-4]: IN_LEFT, [-3]: IN_LEFT | IN_UP, [-2]: IN_UP, [-1]: IN_RIGHT | IN_UP,
    };
    const bits = dirs[sector] ?? 0;
    if (bits !== this.padBits) this.buzz();
    this.padBits = bits;
  }

  apply(s: Settings) {
    this.vibrate = s.vibrate;
    const size = { small: 0.8, medium: 1, large: 1.25 }[s.touchSize];
    this.root.style.setProperty('--touch-scale', String(size));
    this.root.style.setProperty('--touch-opacity', String(s.touchOpacity));
    this.root.classList.toggle('swapped', s.touchSwap);
  }

  setVisible(v: boolean) {
    this.root.classList.toggle('visible', v);
    if (!v) {
      this.padBits = 0;
      this.padPointer = null;
      this.jumpPointers.clear();
      this.hitPointers.clear();
    }
  }

  read(): InputFrame {
    let v = this.padBits;
    if (this.jumpPointers.size) v |= IN_UP;
    if (this.hitPointers.size) v |= IN_HIT;
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
