// 決定性遊戲引擎：step(state, in1, in2, cfg) → 新的 state。
// 只用整數運算；禁用 Math.random、Date.now、三角函數與 DOM。

import * as C from './constants';
import { nextRng } from './rng';
import {
  IN_DOWN, IN_HIT, IN_LEFT, IN_RIGHT, IN_UP,
  Phase, PState,
  type BallState, type GameEventType, type GameState, type InputFrame,
  type MatchConfig, type PlayerState, type Stats,
} from './types';

const FP = C.FP;
const abs = Math.abs;
const trunc = Math.trunc;

export const ZERO_STATS: Stats = { speed: 0, jump: 0, power: 0 };

export function defaultConfig(partial: Partial<MatchConfig> = {}): MatchConfig {
  return {
    targetScore: 15,
    practice: false,
    balance: true,
    stats: [{ ...ZERO_STATS }, { ...ZERO_STATS }],
    ...partial,
  };
}

function newPlayer(i: number): PlayerState {
  return {
    x: C.PLAYER_START_X[i] * FP,
    y: C.PLAYER_GROUND_Y * FP,
    vx: 0,
    vy: 0,
    state: PState.Normal,
    timer: 0,
    facing: i === 0 ? 1 : -1,
    prevInput: 0,
    touching: 0,
  };
}

function serveBall(server: number): BallState {
  return {
    x: C.BALL_SERVE_X[server] * FP,
    y: C.BALL_SERVE_Y * FP,
    vx: 0,
    vy: 0,
    power: 0,
    lastTouch: -1,
  };
}

export function createState(seed: number, server = 0): GameState {
  return {
    frame: 0,
    rng: seed | 0,
    phase: Phase.Play,
    phaseTimer: 0,
    score: [0, 0],
    server,
    winner: -1,
    ball: serveBall(server),
    players: [newPlayer(0), newPlayer(1)],
    events: [{ type: 'serve', who: server, x: C.BALL_SERVE_X[server], y: C.BALL_SERVE_Y }],
  };
}

export function cloneState(s: GameState): GameState {
  return {
    frame: s.frame,
    rng: s.rng,
    phase: s.phase,
    phaseTimer: s.phaseTimer,
    score: [s.score[0], s.score[1]],
    server: s.server,
    winner: s.winner,
    ball: { ...s.ball },
    players: [{ ...s.players[0] }, { ...s.players[1] }],
    events: s.events.slice(),
  };
}

function rand(s: GameState, n: number): number {
  const [v, next] = nextRng(s.rng);
  s.rng = next;
  return v % n;
}

function emit(s: GameState, type: GameEventType, who: number, x: number, y: number) {
  s.events.push({ type, who, x: trunc(x / FP), y: trunc(y / FP) });
}

function scaled(value: number, stat: number): number {
  return trunc((value * (100 + stat * C.STAT_PERCENT)) / 100);
}

function statsOf(cfg: MatchConfig, i: number): Stats {
  return cfg.balance ? ZERO_STATS : cfg.stats[i];
}

function isAirborne(p: PlayerState) {
  return p.state === PState.Jump || p.state === PState.Spike || p.state === PState.Dive;
}

function updatePlayer(s: GameState, i: number, input: InputFrame, cfg: MatchConfig) {
  const p = s.players[i];
  const st = statsOf(cfg, i);
  const hitEdge = (input & IN_HIT) !== 0 && (p.prevInput & IN_HIT) === 0;
  const dir = ((input & IN_RIGHT) ? 1 : 0) - ((input & IN_LEFT) ? 1 : 0);
  const speed = scaled(C.MOVE_SPEED, st.speed);
  const homeFacing = i === 0 ? 1 : -1;

  switch (p.state) {
    case PState.Normal:
      if (hitEdge && dir !== 0) {
        p.state = PState.Dive;
        p.vx = dir * scaled(C.DIVE_VX, st.speed);
        p.vy = C.DIVE_VY;
        p.facing = dir;
        emit(s, 'dive', i, p.x, p.y);
      } else if (input & IN_UP) {
        p.state = PState.Jump;
        p.vy = scaled(C.JUMP_VY, st.jump);
        p.vx = dir * speed;
        emit(s, 'jump', i, p.x, p.y);
      } else {
        p.vx = dir * speed;
      }
      break;
    case PState.Jump:
    case PState.Spike:
      p.vx = dir * speed;
      if (hitEdge && p.state === PState.Jump) {
        p.state = PState.Spike;
        p.timer = C.SPIKE_FRAMES;
      } else if (p.state === PState.Spike) {
        p.timer--;
        if (p.timer <= 0) p.state = PState.Jump;
      }
      break;
    case PState.Dive:
      break;
    case PState.Lying:
      p.vx = 0;
      p.timer--;
      if (p.timer <= 0) {
        p.state = PState.Normal;
        p.facing = homeFacing;
      }
      break;
    default:
      p.vx = 0;
  }

  p.x += p.vx;
  const minX = C.PLAYER_MIN_X[i] * FP;
  const maxX = C.PLAYER_MAX_X[i] * FP;
  if (p.x < minX) p.x = minX;
  if (p.x > maxX) p.x = maxX;

  if (isAirborne(p)) {
    p.vy += C.PLAYER_GRAVITY;
    p.y += p.vy;
    const ground = C.PLAYER_GROUND_Y * FP;
    if (p.y >= ground) {
      p.y = ground;
      p.vy = 0;
      if (p.state === PState.Dive) {
        p.state = PState.Lying;
        p.timer = C.DIVE_RECOVER_FRAMES;
        p.vx = 0;
      } else {
        p.state = PState.Normal;
        p.timer = 0;
      }
    }
  }
}

/** 移動球並處理牆、天花板、網子。回傳是否落地。 */
function moveBall(s: GameState): boolean {
  const b = s.ball;
  const R = C.BALL_R * FP;
  const prevX = b.x;

  b.vy += C.BALL_GRAVITY;
  if (b.vy > C.BALL_MAX_VY) b.vy = C.BALL_MAX_VY;
  b.x += b.vx;
  b.y += b.vy;

  // 左右牆
  if (b.x < R) {
    b.x = R;
    b.vx = abs(b.vx);
    emit(s, 'wall', -1, b.x, b.y);
  } else if (b.x > C.FIELD_W * FP - R) {
    b.x = C.FIELD_W * FP - R;
    b.vx = -abs(b.vx);
    emit(s, 'wall', -1, b.x, b.y);
  }
  // 天花板
  if (b.y < R) {
    b.y = R;
    b.vy = abs(b.vy);
  }

  // 網子：網柱（網頂以下）＋網頂圓形碰撞點
  const netX = C.NET_X * FP;
  const netTop = C.NET_TOP_Y * FP;
  const reach = R + C.NET_HALF_W * FP;
  const dxn = b.x - netX;
  const prevSide = prevX < netX ? -1 : 1;
  const crossed = (b.x < netX ? -1 : 1) !== prevSide;
  if (b.y >= netTop && (abs(dxn) < reach || crossed)) {
    b.x = netX + prevSide * reach;
    b.vx = prevSide * abs(b.vx);
    if (b.vx === 0) b.vx = prevSide * FP;
    emit(s, 'net', -1, b.x, b.y);
  } else if (b.y < netTop && abs(dxn) < reach) {
    const dy = b.y - netTop;
    const dxPx = trunc(dxn / FP);
    const dyPx = trunc(dy / FP);
    const rr = C.BALL_R + C.NET_HALF_W;
    if (dxPx * dxPx + dyPx * dyPx < rr * rr) {
      const side = dxn === 0 ? (rand(s, 2) === 0 ? -1 : 1) : dxn < 0 ? -1 : 1;
      if (abs(dxPx) * 2 < C.BALL_R) {
        // 幾乎正好落在網頂：往上彈並往某一側推
        b.vy = -abs(trunc((b.vy * 3) / 4));
        b.vx += side * 2 * FP;
        b.y = netTop - rr * FP;
      } else {
        b.vx = side * abs(b.vx);
        if (b.vy > 0) b.vy = -trunc(b.vy / 2);
        b.x = netX + side * reach;
      }
      emit(s, 'net', -1, b.x, b.y);
    }
  }

  return b.y >= (C.GROUND_Y - C.BALL_R) * FP;
}

/** 扣殺後的球速：依方向鍵決定球路（AI 也用它來預判） */
export function spikeVelocity(input: InputFrame, side: number, power: number): { vx: number; vy: number } {
  const fwd = side === 0 ? 1 : -1;
  const h = ((input & IN_RIGHT) ? 1 : 0) - ((input & IN_LEFT) ? 1 : 0);
  const rel = h * fwd;
  const up = (input & IN_UP) !== 0;
  const down = (input & IN_DOWN) !== 0;
  const S = C.SPIKE;
  let vx: number = rel > 0 ? S.forwardVx : rel < 0 ? S.backVx : S.flatVx;
  if (up && rel === 0) vx = S.lobVx;
  const vy = up ? S.upVy : down ? S.downVy : rel !== 0 ? S.diagVy : 0;
  return { vx: scaled(fwd * vx * FP, power), vy: scaled(vy * FP, power) };
}

function hitBall(s: GameState, i: number, input: InputFrame, cfg: MatchConfig) {
  const b = s.ball;
  const p = s.players[i];
  const st = statsOf(cfg, i);
  if (p.state === PState.Spike) {
    const v = spikeVelocity(input, i, st.power);
    b.vx = v.vx;
    b.vy = v.vy;
    b.power = 1;
    p.state = PState.Jump;
    p.timer = 0;
    emit(s, 'spike', i, b.x, b.y);
  } else {
    const dx = b.x - p.x;
    const jitter = rand(s, 2 * C.BUMP_JITTER + 1) - C.BUMP_JITTER;
    b.vx = trunc(dx / C.BUMP_DX_DIV) + jitter;
    b.vy = -Math.max(abs(b.vy), C.BUMP_MIN_VY);
    b.power = 0;
    emit(s, 'bump', i, b.x, b.y);
  }
  b.lastTouch = i;
}

function collidePlayers(s: GameState, inputs: [InputFrame, InputFrame], cfg: MatchConfig) {
  const b = s.ball;
  for (let i = 0; i < 2; i++) {
    const p = s.players[i];
    const overlap = abs(b.x - p.x) <= C.TOUCH_RANGE_X * FP && abs(b.y - p.y) <= C.TOUCH_RANGE_Y * FP;
    if (overlap && !p.touching) hitBall(s, i, inputs[i], cfg);
    p.touching = overlap ? 1 : 0;
  }
}

function resetRound(s: GameState) {
  for (let i = 0; i < 2; i++) {
    const keep = s.players[i].prevInput;
    s.players[i] = newPlayer(i);
    s.players[i].prevInput = keep;
  }
  s.ball = serveBall(s.server);
  s.phase = Phase.Play;
  s.phaseTimer = 0;
  emit(s, 'serve', s.server, s.ball.x, s.ball.y);
}

/** 落地後的球：小幅反彈並減速，不再計分 */
function settleBall(s: GameState) {
  const b = s.ball;
  b.vy += C.BALL_GRAVITY;
  b.x += b.vx;
  b.y += b.vy;
  const floor = (C.GROUND_Y - C.BALL_R) * FP;
  if (b.y >= floor) {
    b.y = floor;
    b.vy = -trunc(abs(b.vy) / 3);
    b.vx = trunc(b.vx / 2);
  }
  const R = C.BALL_R * FP;
  if (b.x < R) b.x = R;
  if (b.x > C.FIELD_W * FP - R) b.x = C.FIELD_W * FP - R;
  const reach = R + C.NET_HALF_W * FP;
  const dxn = b.x - C.NET_X * FP;
  if (Math.abs(dxn) < reach) {
    b.x = C.NET_X * FP + (dxn < 0 ? -reach : reach);
    b.vx = 0;
  }
}

export function step(state: GameState, in1: InputFrame, in2: InputFrame, cfg: MatchConfig): GameState {
  const s = cloneState(state);
  s.frame++;
  s.events = [];
  const inputs: [InputFrame, InputFrame] = [in1 & 31, in2 & 31];

  if (s.phase === Phase.Over) {
    if (s.phaseTimer > 0) s.phaseTimer--;
    for (const p of s.players) p.timer++;
  } else if (s.phase === Phase.Scored) {
    s.phaseTimer--;
    // 慢動作：每兩幀才推進一次物理
    if (s.phaseTimer % 2 === 0) {
      settleBall(s);
      for (let i = 0; i < 2; i++) updatePlayer(s, i, 0, cfg);
    }
    if (s.phaseTimer <= 0) {
      const target = cfg.targetScore;
      if (!cfg.practice && (s.score[0] >= target || s.score[1] >= target)) {
        s.phase = Phase.Over;
        s.winner = s.score[0] >= target ? 0 : 1;
        s.phaseTimer = C.GAME_OVER_FRAMES;
        s.players[s.winner].state = PState.Win;
        s.players[1 - s.winner].state = PState.Lose;
        for (const p of s.players) {
          p.timer = 0;
          p.vx = 0;
          p.vy = 0;
          p.y = C.PLAYER_GROUND_Y * FP;
        }
        emit(s, 'win', s.winner, s.players[s.winner].x, s.players[s.winner].y);
      } else {
        resetRound(s);
      }
    }
  } else {
    updatePlayer(s, 0, inputs[0], cfg);
    updatePlayer(s, 1, inputs[1], cfg);
    const landed = moveBall(s);
    if (!landed) collidePlayers(s, inputs, cfg);
    if (landed) {
      const b = s.ball;
      b.y = (C.GROUND_Y - C.BALL_R) * FP;
      b.vy = -trunc(abs(b.vy) / 3);
      b.vx = trunc(b.vx / 2);
      const loser = b.x < C.NET_X * FP ? 0 : 1;
      const scorer = 1 - loser;
      emit(s, 'ground', loser, b.x, b.y + C.BALL_R * FP);
      if (!cfg.practice) {
        s.score[scorer]++;
        s.server = scorer;
        emit(s, 'score', scorer, b.x, b.y);
      }
      s.phase = Phase.Scored;
      s.phaseTimer = C.SCORED_FRAMES;
    }
  }

  s.players[0].prevInput = inputs[0];
  s.players[1].prevInput = inputs[1];
  return s;
}

/** FNV-1a 雜湊，供連線對帳 */
export function hashState(s: GameState): number {
  const vals = [
    s.frame, s.rng, s.phase, s.phaseTimer, s.score[0], s.score[1], s.server, s.winner,
    s.ball.x, s.ball.y, s.ball.vx, s.ball.vy, s.ball.power, s.ball.lastTouch,
  ];
  for (const p of s.players) {
    vals.push(p.x, p.y, p.vx, p.vy, p.state, p.timer, p.facing, p.prevInput, p.touching);
  }
  let h = 0x811c9dc5;
  for (const v of vals) {
    let x = v | 0;
    for (let k = 0; k < 4; k++) {
      h ^= x & 0xff;
      h = Math.imul(h, 0x01000193);
      x >>>= 8;
    }
  }
  return h >>> 0;
}

export function serializeState(s: GameState): string {
  return JSON.stringify({ ...s, events: [] });
}

export function deserializeState(json: string): GameState {
  return JSON.parse(json) as GameState;
}
