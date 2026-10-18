// 電腦 AI：只讀取 GameState、只產生 InputFrame，與玩家走同一條輸入路徑。
// 使用自己的決定性 RNG；難度以反應延遲、目標誤差與失誤率區分。

import * as C from './constants';
import { spikeVelocity } from './physics';
import { Rng } from './rng';
import { IN_DOWN, IN_HIT, IN_LEFT, IN_RIGHT, IN_UP, Phase, PState, type GameState, type InputFrame } from './types';

export type Difficulty = 'easy' | 'normal' | 'hard';

interface Profile {
  reaction: number; // 幾幀重新規劃一次
  noise: number; // 目標誤差（像素）
  spikeRate: number; // 有機會時扣殺的機率（%）
  missRate: number; // 判斷失誤的機率（%）
  deadzone: number;
  aggression: number; // 選擇最強球路的機率（%）
  moveRate: number; // 每幀實際移動的機率（%），模擬反應慢
}

const PROFILES: Record<Difficulty, Profile> = {
  easy: { reaction: 10, noise: 28, spikeRate: 30, missRate: 30, deadzone: 10, aggression: 10, moveRate: 70 },
  normal: { reaction: 4, noise: 12, spikeRate: 70, missRate: 10, deadzone: 5, aggression: 50, moveRate: 92 },
  hard: { reaction: 1, noise: 4, spikeRate: 95, missRate: 2, deadzone: 3, aggression: 85, moveRate: 100 },
};

const FP = C.FP;

/** 預測球落到指定高度時的 x 與所需幀數（簡化：牆反彈、不考慮網子與角色） */
export function predictBall(s: GameState, targetY: number): { x: number; t: number; vy: number } {
  let { x, y, vx, vy } = s.ball;
  const R = C.BALL_R * FP;
  const ty = targetY * FP;
  for (let t = 1; t < 200; t++) {
    vy += C.BALL_GRAVITY;
    if (vy > C.BALL_MAX_VY) vy = C.BALL_MAX_VY;
    x += vx;
    y += vy;
    if (x < R) { x = R; vx = -vx; }
    if (x > C.FIELD_W * FP - R) { x = C.FIELD_W * FP - R; vx = -vx; }
    if (y < R) { y = R; vy = -vy; }
    if (vy > 0 && y >= ty) return { x: Math.trunc(x / FP), t, vy };
  }
  return { x: Math.trunc(x / FP), t: 200, vy };
}

/** 從 (x, y) 以 (vx, vy) 出發的球，是否能從網上方越過並落在另一側（FP 單位） */
export function clearsNet(x: number, y: number, vx: number, vy: number): boolean {
  const R = C.BALL_R * FP;
  const net = C.NET_X * FP;
  const startSide = x < net ? 0 : 1;
  let crossed = false;
  for (let t = 0; t < 120; t++) {
    vy += C.BALL_GRAVITY;
    if (vy > C.BALL_MAX_VY) vy = C.BALL_MAX_VY;
    const px = x;
    x += vx;
    y += vy;
    if (x < R) { x = R; vx = -vx; }
    if (x > C.FIELD_W * FP - R) { x = C.FIELD_W * FP - R; vx = -vx; }
    if (y < R) { y = R; vy = -vy; }
    if ((px < net) !== (x < net)) {
      if (y > (C.NET_TOP_Y - C.BALL_R - 4) * FP) return false;
      crossed = true;
    }
    if (y >= (C.GROUND_Y - C.BALL_R) * FP) return crossed && (x < net ? 0 : 1) !== startSide;
  }
  return false;
}

export class AiController {
  private rng: Rng;
  private p: Profile;
  private targetX = 0;
  private nextPlan = 0;
  private skipRally = false;
  private lastServeFrame = -1;
  private spikeInput = 0;
  private wantSpike = false;

  constructor(public side: number, difficulty: Difficulty, seed: number) {
    this.rng = new Rng(seed ^ 0x5a5a1234);
    this.p = PROFILES[difficulty];
    this.targetX = C.PLAYER_START_X[side];
  }

  /** 模擬各種扣殺方向，回傳能過網且落在對方場地的選項；都不行就回傳 null（改為一般觸球） */
  private chooseSpike(s: GameState): number | null {
    const fwdBit = this.side === 0 ? IN_RIGHT : IN_LEFT;
    const backBit = this.side === 0 ? IN_LEFT : IN_RIGHT;
    const options = [IN_DOWN | fwdBit, IN_DOWN, fwdBit, 0, IN_UP | fwdBit, IN_UP, IN_DOWN | backBit, backBit];
    const valid = options.filter((o) => this.spikeClears(s, o));
    if (this.rng.percent() >= this.p.spikeRate) return null;
    if (!valid.length) return this.rng.percent() < this.p.missRate ? options[this.rng.int(options.length)] : null;
    if (this.rng.percent() < this.p.missRate) return options[this.rng.int(options.length)];
    // 難度越高越偏好強力球路
    const pick = this.p.aggression >= this.rng.percent() ? 0 : this.rng.int(valid.length);
    return valid[pick];
  }

  private spikeClears(s: GameState, bits: number): boolean {
    const v = spikeVelocity(bits, this.side, 0);
    return clearsNet(s.ball.x, s.ball.y, v.vx, v.vy);
  }

  private jumpWillMeet(s: GameState, myX: number): boolean {
    let { x, y, vx, vy } = s.ball;
    const R = C.BALL_R * FP;
    let py = C.PLAYER_GROUND_Y * FP;
    let pvy = C.JUMP_VY;
    let px = myX * FP;
    for (let t = 1; t <= 18; t++) {
      vy += C.BALL_GRAVITY;
      x += vx;
      y += vy;
      if (x < R) { x = R; vx = -vx; }
      if (x > C.FIELD_W * FP - R) { x = C.FIELD_W * FP - R; vx = -vx; }
      if (y < R) { y = R; vy = -vy; }
      pvy += C.PLAYER_GRAVITY;
      py += pvy;
      if (py > C.PLAYER_GROUND_Y * FP) return false;
      const step = Math.min(C.MOVE_SPEED, Math.abs(x - px));
      px += x > px ? step : -step;
      if (t < 4) continue;
      const high = y < (C.NET_TOP_Y - 40) * FP;
      if (high && Math.abs(x - px) < 24 * FP && Math.abs(y - py) < 24 * FP && pvy > -6 * FP) return true;
    }
    return false;
  }

  decide(s: GameState): InputFrame {
    if (s.phase !== Phase.Play) return 0;
    const me = s.players[this.side];
    const b = s.ball;
    const fwd = this.side === 0 ? 1 : -1;
    const myX = Math.trunc(me.x / FP);
    const myY = Math.trunc(me.y / FP);
    const bx = Math.trunc(b.x / FP);
    const by = Math.trunc(b.y / FP);
    const onMySide = this.side === 0 ? bx < C.NET_X : bx > C.NET_X;

    if (s.ball.lastTouch === -1 && s.frame !== this.lastServeFrame && b.vy === 0) {
      this.lastServeFrame = s.frame;
      this.skipRally = this.rng.percent() < this.p.missRate / 3;
    }

    if (s.frame >= this.nextPlan) {
      this.nextPlan = s.frame + this.p.reaction;
      const contactY = C.PLAYER_GROUND_Y - 38;
      const pred = predictBall(s, contactY);
      const landOnMySide = this.side === 0 ? pred.x < C.NET_X : pred.x > C.NET_X;
      const noise = this.rng.int(this.p.noise * 2 + 1) - this.p.noise;
      if (landOnMySide) {
        // 試算各種站位，找出能把球頂過網的位置（偏好站在球後方）
        let best = 14;
        const bumpVy = -Math.max(Math.abs(pred.vy), C.BUMP_MIN_VY);
        for (const off of [14, 18, 10, 22, 6, 26, 2, 30, -4, -10, -16]) {
          const vx = Math.trunc((fwd * off * FP) / C.BUMP_DX_DIV);
          if (clearsNet(pred.x * FP, contactY * FP, vx, bumpVy)) {
            best = off;
            break;
          }
        }
        this.targetX = pred.x - fwd * best + noise;
      } else {
        // 回到自己半場中間待命
        this.targetX = this.side === 0 ? 110 : C.FIELD_W - 110;
      }
      if (!landOnMySide) this.wantSpike = this.rng.percent() < this.p.spikeRate;
    }

    let input = 0;
    if (!this.skipRally && this.rng.percent() < this.p.moveRate) {
      const dx = this.targetX - myX;
      if (dx > this.p.deadzone) input |= IN_RIGHT;
      else if (dx < -this.p.deadzone) input |= IN_LEFT;
    }

    if (me.state === PState.Normal && onMySide && !this.skipRally) {
      // 預測起跳後能否在高點碰到球
      if (this.wantSpike && this.jumpWillMeet(s, myX)) input |= IN_UP;
      // 來不及跑到的球：魚躍
      const pred = predictBall(s, C.PLAYER_GROUND_Y);
      const gap = pred.x - myX;
      if (Math.abs(gap) > 60 && Math.abs(gap) < 110 && pred.t < 10 && (s.frame & 1) === 0) {
        input = (gap > 0 ? IN_RIGHT : IN_LEFT) | IN_HIT;
      }
    }

    if (me.state === PState.Jump && onMySide) {
      // 讓球保持在身前
      const want = bx - fwd * 8;
      input &= ~(IN_LEFT | IN_RIGHT);
      if (want > myX + 3) input |= IN_RIGHT;
      else if (want < myX - 3) input |= IN_LEFT;
      const close = Math.abs(bx - myX) < 50 && Math.abs(by - myY) < 50;
      if (close) {
        const choice = this.chooseSpike(s);
        if (choice !== null) {
          this.spikeInput = choice;
          input = (input & ~(IN_LEFT | IN_RIGHT)) | IN_HIT | choice;
        }
      }
    }
    if (me.state === PState.Spike) {
      // 揮臂期間保持方向，觸球瞬間決定球路
      input = (input & ~(IN_LEFT | IN_RIGHT)) | IN_HIT | this.spikeInput;
    }
    return input;
  }
}
