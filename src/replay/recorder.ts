// 精彩重播：遊戲引擎是決定性的，只要記下開場狀態與每一幀雙方的輸入，就能完整重演整場比賽。
// 比賽中每一幀記 1 個數字（in1 | in2 << 8），一場 5 分鐘約 18,000 個，很小。
// 得分時記下「哪一幀、誰得分、是不是扣殺得分」，結算時挑一球最精彩的。
import { cloneState, step } from '../engine/physics';
import type { GameEvent, GameState, InputFrame, MatchConfig } from '../engine/types';

export interface ReplayMeta {
  chars: [string, string];
  scene: string;
  ball: string;
  hats: [string | null, string | null];
  night: boolean;
  /** 自己是哪一邊（挑精彩球用） */
  humanSide: 0 | 1;
  /** 每秒幾個邏輯幀 */
  fps: number;
}

export interface Mark {
  /** 得分發生在第幾幀之後（狀態 = 開場後 step 了幾次） */
  frame: number;
  scorer: number;
  /** 最後一擊是扣殺 */
  spike: boolean;
}

export class MatchRecorder {
  readonly inputs: number[] = [];
  readonly marks: Mark[] = [];
  private readonly start: GameState;
  private readonly cfg: MatchConfig;

  constructor(start: GameState, cfg: MatchConfig, readonly meta: ReplayMeta) {
    this.start = cloneState(start);
    this.cfg = { ...cfg, stats: [{ ...cfg.stats[0] }, { ...cfg.stats[1] }] };
  }

  /** 每個邏輯幀 step 之前呼叫 */
  push(in1: InputFrame, in2: InputFrame) {
    this.inputs.push((in1 & 0xff) | ((in2 & 0xff) << 8));
  }

  /** step 之後呼叫：prev 是這一幀之前的狀態（判斷最後一擊是不是扣殺） */
  note(events: GameEvent[], prev: GameState) {
    for (const e of events) {
      if (e.type === 'score') this.marks.push({ frame: this.inputs.length, scorer: e.who, spike: prev.ball.power > 0 });
    }
  }

  get length() {
    return this.inputs.length;
  }

  /** 從開場重演到第 frame 幀的狀態 */
  stateAt(frame: number): GameState {
    let s = cloneState(this.start);
    for (let f = 0; f < frame && f < this.inputs.length; f++) s = this.stepAt(s, f);
    return s;
  }

  /** 第 f 幀的下一個狀態 */
  stepAt(s: GameState, f: number): GameState {
    const v = this.inputs[f] ?? 0;
    return step(s, v & 0xff, (v >> 8) & 0xff, this.cfg);
  }
}

export interface Highlight {
  from: number;
  to: number;
  /** 得分那一幀（慢動作的中心） */
  at: number;
  spike: boolean;
}

/**
 * 挑一球最精彩的：自己扣殺得分的最後一球 → 自己得分的最後一球 → 整場最後一球。
 * 範圍是得分前 4 秒到得分後 1.2 秒。
 */
export function pickHighlight(rec: { marks: Mark[]; length: number; meta: { humanSide: number; fps: number } }): Highlight | null {
  const m = rec.marks;
  if (!m.length) return null;
  const me = rec.meta.humanSide;
  const best = [...m].reverse().find((x) => x.scorer === me && x.spike)
    ?? [...m].reverse().find((x) => x.scorer === me)
    ?? m[m.length - 1];
  const fps = rec.meta.fps;
  return {
    from: Math.max(0, best.frame - Math.round(4 * fps)),
    to: Math.min(rec.length, best.frame + Math.round(1.2 * fps)),
    at: best.frame,
    spike: best.spike,
  };
}
