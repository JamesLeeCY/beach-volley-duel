// 闖關挑戰：依序打敗 6 位對手（5 分制），難度逐關提高，每關換一個場景。
import type { Difficulty } from '../engine/ai';
import type { SceneId } from '../render/scenery';

export const STAGE_COUNT = 6;
export const STAGE_DIFFS: Difficulty[] = ['beginner', 'easy', 'easy', 'normal', 'normal', 'hard'];
export const STAGE_SCENES: SceneId[] = ['beach', 'zoo', 'ntu', 'expo', 'tamsui', 'taipei'];
export const STAGE_TARGET = 5;

/** 對手順序：其他角色依序上場，不夠 6 位時最後一關是「鏡像對決」（同角色） */
export function buildStages(player: string, all: string[]): string[] {
  const others = all.filter((id) => id !== player);
  const out = others.slice(0, STAGE_COUNT - 1);
  while (out.length < STAGE_COUNT) out.push(out.length === STAGE_COUNT - 1 ? player : others[out.length % Math.max(1, others.length)] ?? player);
  return out;
}

const KEY = 'bvd.challenge.best';

/** 最佳紀錄：最遠打到第幾關（0 = 尚未過關，6 = 全破） */
export function loadBest(): number {
  try {
    return Number(localStorage.getItem(KEY)) || 0;
  } catch {
    return 0;
  }
}

export function saveBest(cleared: number) {
  try {
    if (cleared > loadBest()) localStorage.setItem(KEY, String(cleared));
  } catch {
    // 忽略
  }
}
