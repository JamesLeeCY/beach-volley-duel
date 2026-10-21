// 第一場比賽就是教學：不開說明頁，在比賽進行中依序顯示一句提示，
// 玩家做到了就換下一句；一直做不到也會在一段時間後換下一句，不會卡住。
import { TUTORIAL_STEPS, type TutorialStep } from './tutorial';
import type { GameEvent, GameState } from '../engine/types';

/** 用到的教學步驟：移動、跳、接球、扣殺（瞄準與魚躍留給完整教學） */
const STEPS: TutorialStep[] = [0, 1, 2, 4].map((i) => TUTORIAL_STEPS[i]);
/** 一句提示最多顯示幾個邏輯幀（約 15 秒）就換下一句 */
export const COACH_MAX_TICKS = 15 * 60;

export class Coach {
  step = 0;
  private ticks = 0;
  private startX: number;

  constructor(state: GameState) {
    this.startX = state.players[0].x;
  }

  get current(): TutorialStep | null {
    return STEPS[this.step] ?? null;
  }

  get finished() {
    return this.step >= STEPS.length;
  }

  /** 每個邏輯幀呼叫；回傳 'done'（玩家做到了）、'skip'（逾時換下一句）或 null */
  update(s: GameState, events: GameEvent[]): 'done' | 'skip' | null {
    const cur = this.current;
    if (!cur) return null;
    this.ticks++;
    const done = cur.done(s, events, { startX: this.startX });
    if (!done && this.ticks < COACH_MAX_TICKS) return null;
    this.step++;
    this.ticks = 0;
    this.startX = s.players[0].x;
    return done ? 'done' : 'skip';
  }
}
