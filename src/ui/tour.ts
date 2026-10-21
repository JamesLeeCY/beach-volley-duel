// 環島巡迴賽：12 個場景串成一條環島路線，每站有一隻「站長」動物當關主。
// 每站贏了就蓋一個章；12 個章集滿是一份環島證書。通關後開放「二刷環島」（困難版）。
import type { Difficulty } from '../engine/ai';
import type { SceneId } from '../render/scenery';

export interface Station {
  scene: SceneId;
  /** 站長（對手） */
  host: string;
  /** 一刷的難度；二刷全部是困難 */
  level: Difficulty;
}

/** 從台北出發，往北海岸、中央山脈、日月潭、南部海灘，最後渡海到金門 */
export const ROUTE: Station[] = [
  { scene: 'taipei', host: 'hoho', level: 'beginner' },
  { scene: 'songshan', host: 'pipi', level: 'beginner' },
  { scene: 'ntu', host: 'caicai', level: 'easy' },
  { scene: 'zoo', host: 'jiajia', level: 'easy' },
  { scene: 'expo', host: 'glidey', level: 'easy' },
  { scene: 'yangming', host: 'meimei', level: 'normal' },
  { scene: 'tamsui', host: 'wawa', level: 'normal' },
  { scene: 'wuling', host: 'sakura', level: 'normal' },
  { scene: 'comet', host: 'ying', level: 'normal' },
  { scene: 'lake', host: 'shishi', level: 'hard' },
  { scene: 'beach', host: 'guigui', level: 'hard' },
  { scene: 'kinmen', host: 'tata', level: 'hard' },
];

export const TOUR_TARGET = 5;

/** 這一站的對手：站長剛好是玩家自己的角色時，改由黑熊（月月）代打 */
export function stationHost(st: Station, player: string): string {
  return st.host === player ? (player === 'yueyue' ? 'lanlan' : 'yueyue') : st.host;
}

export function stationLevel(st: Station, hard: boolean): Difficulty {
  return hard ? 'hard' : st.level;
}

/** 下一個還沒蓋章的站（全部蓋完回傳 -1） */
export function nextStation(stamps: readonly SceneId[]): number {
  return ROUTE.findIndex((st) => !stamps.includes(st.scene));
}
