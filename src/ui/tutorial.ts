// 新手教學：在練習模式裡依序完成 7 個步驟，每完成一步打勾。
// 只讀取遊戲狀態與事件判斷是否完成，不影響遊戲本身。
import { FP, NET_X } from '../engine/constants';
import { PState, type GameEvent, type GameState } from '../engine/types';
import type { MsgKey } from '../i18n';

export interface TutorialStep {
  /** 鍵盤／觸控各自的說明文字 */
  kb: MsgKey;
  touch: MsgKey;
  done(s: GameState, events: GameEvent[], ctx: { startX: number }): boolean;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  { kb: 'tutMoveKb', touch: 'tutMoveTouch', done: (s, _e, c) => Math.abs(s.players[0].x - c.startX) > 40 * FP },
  { kb: 'tutJumpKb', touch: 'tutJumpTouch', done: (s) => s.players[0].state === PState.Jump },
  { kb: 'tutBumpKb', touch: 'tutBumpTouch', done: (_s, e) => e.some((x) => x.type === 'bump' && x.who === 0) },
  { kb: 'tutOverKb', touch: 'tutOverTouch', done: (s) => s.ball.lastTouch === 0 && s.ball.x > NET_X * FP },
  { kb: 'tutSpikeKb', touch: 'tutSpikeTouch', done: (_s, e) => e.some((x) => x.type === 'spike' && x.who === 0) },
  {
    kb: 'tutAimKb', touch: 'tutAimTouch',
    // 往下重扣：扣殺後球速明顯往下
    done: (s, e) => e.some((x) => x.type === 'spike' && x.who === 0) && s.ball.vy > 8 * FP,
  },
  { kb: 'tutDiveKb', touch: 'tutDiveTouch', done: (_s, e) => e.some((x) => x.type === 'dive' && x.who === 0) },
];

export class Tutorial {
  step = 0;
  private startX = 0;

  constructor(state: GameState) {
    this.startX = state.players[0].x;
  }

  get finished() {
    return this.step >= TUTORIAL_STEPS.length;
  }

  /** 每個邏輯幀呼叫；回傳這一幀是否完成了新的步驟 */
  update(s: GameState, events: GameEvent[]): boolean {
    if (this.finished) return false;
    if (TUTORIAL_STEPS[this.step].done(s, events, { startX: this.startX })) {
      this.step++;
      this.startX = s.players[0].x;
      return true;
    }
    return false;
  }
}
