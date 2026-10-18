/** 每幀 1 byte：bit0 左、bit1 右、bit2 上、bit3 下、bit4 擊球 */
export type InputFrame = number;

export const IN_LEFT = 1;
export const IN_RIGHT = 2;
export const IN_UP = 4;
export const IN_DOWN = 8;
export const IN_HIT = 16;

export enum PState {
  Normal = 0,
  Jump = 1,
  Spike = 2,
  Dive = 3,
  Lying = 4,
  Win = 5,
  Lose = 6,
}

export enum Phase {
  Play = 0,
  Scored = 1,
  Over = 2,
}

export interface Stats {
  speed: number;
  jump: number;
  power: number;
}

export interface MatchConfig {
  targetScore: number;
  practice: boolean;
  /** 平衡模式開啟時忽略能力值 */
  balance: boolean;
  stats: [Stats, Stats];
}

export interface PlayerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  state: PState;
  timer: number;
  /** 1 = 面向右、-1 = 面向左 */
  facing: number;
  prevInput: number;
  /** 上一幀是否與球重疊（避免同一次接觸重複觸發） */
  touching: number;
}

export interface BallState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 扣殺球（拖尾特效）：1 / 0 */
  power: number;
  /** 最後觸球者 0 / 1，-1 = 無 */
  lastTouch: number;
}

export type GameEventType = 'serve' | 'bump' | 'spike' | 'net' | 'wall' | 'ground' | 'score' | 'win' | 'jump' | 'dive';

export interface GameEvent {
  type: GameEventType;
  /** 相關玩家（-1 = 無） */
  who: number;
  x: number;
  y: number;
}

export interface GameState {
  frame: number;
  rng: number;
  phase: Phase;
  phaseTimer: number;
  score: [number, number];
  server: number;
  winner: number;
  ball: BallState;
  players: [PlayerState, PlayerState];
  /** 本幀發生的事件，僅供音效與特效使用，不影響物理 */
  events: GameEvent[];
}
