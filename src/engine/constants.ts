// 所有物理數值都在這裡。位置與速度以固定小數點表示：1 像素 = FP 單位。
// 調整手感時只改這個檔案，並記錄在 PROGRESS.md。

export const FP = 100;

export const FIELD_W = 432;
export const FIELD_H = 304;
export const GROUND_Y = 252;

export const NET_X = 216;
export const NET_HALF_W = 4;
export const NET_TOP_Y = 176;

export const PLAYER_HALF = 32; // 碰撞箱 64×64
export const PLAYER_GROUND_Y = GROUND_Y - PLAYER_HALF; // 角色中心在地面時的 y
export const PLAYER_MIN_X = [PLAYER_HALF, NET_X + NET_HALF_W + PLAYER_HALF - 4] as const;
export const PLAYER_MAX_X = [NET_X - NET_HALF_W - PLAYER_HALF + 4, FIELD_W - PLAYER_HALF] as const;
export const PLAYER_START_X = [36, FIELD_W - 36] as const;

export const BALL_R = 20;
export const BALL_GRAVITY = 1 * FP;
export const BALL_MAX_VY = 22 * FP; // 終端速度，避免穿透
export const BALL_SERVE_X = [56, FIELD_W - 56] as const;
export const BALL_SERVE_Y = BALL_R;

/** 球與角色的碰撞判定：中心距離在此範圍內視為觸球（像素） */
export const TOUCH_RANGE_X = PLAYER_HALF + 10;
export const TOUCH_RANGE_Y = PLAYER_HALF + 10;
/** 一般觸球：最小向上彈速 */
export const BUMP_MIN_VY = 15 * FP;
/** 一般觸球：水平速度 = dx / BUMP_DX_DIV */
export const BUMP_DX_DIV = 3;
/** 一般觸球：RNG 水平變異範圍（±，FP） */
export const BUMP_JITTER = 1 * FP;

export const MOVE_SPEED = 6 * FP;
export const JUMP_VY = -16 * FP;
export const PLAYER_GRAVITY = 1 * FP;

export const DIVE_VX = 9 * FP;
export const DIVE_VY = -5 * FP;
/** 魚躍落地後無法行動的幀數（約 0.5 秒 @25fps） */
export const DIVE_RECOVER_FRAMES = 12;
/** 空中按擊球後「揮臂」持續幀數，期間觸球即為扣殺 */
export const SPIKE_FRAMES = 6;

/** 扣殺球速（像素/幀） */
export const SPIKE = {
  flatVx: 20,
  forwardVx: 26,
  backVx: 12,
  lobVx: 10,
  upVy: -15,
  downVy: 15,
  diagVy: 6,
} as const;

/** 能力值每一級的修正（百分比） */
export const STAT_PERCENT = 5;

/** 得分後慢動作的邏輯幀數（約 1 秒 @25fps） */
export const SCORED_FRAMES = 25;
/** 比賽結束後停留幀數 */
export const GAME_OVER_FRAMES = 75;

export const FPS_BY_SPEED = { slow: 20, normal: 25, fast: 30 } as const;
export type Speed = keyof typeof FPS_BY_SPEED;
