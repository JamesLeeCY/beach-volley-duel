// 場景縮圖：用真正的場景畫法畫一張小圖（含色調），快取成圖片網址給選單卡片使用。
import { FIELD_H, FIELD_W } from '../engine/constants';
import { Scenery, loadLandmarks, type SceneId } from './scenery';

const cache = new Map<SceneId, Promise<string>>();
const LANDMARK = new Set<SceneId>(['taipei', 'zoo', 'ntu', 'songshan', 'expo', 'yangming', 'tamsui']);
const W = 192;
const H = Math.round((W * FIELD_H) / FIELD_W);

/** 依序產生（一次只畫一張），避免打開選單時一口氣卡住畫面 */
let queue: Promise<unknown> = Promise.resolve();

export function sceneThumb(id: SceneId): Promise<string> {
  let p = cache.get(id);
  if (!p) {
    p = queue.then(async () => {
      if (LANDMARK.has(id)) await loadLandmarks();
      await new Promise((r) => setTimeout(r, 0));
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d')!;
      const k = W / FIELD_W;
      g.setTransform(k, 0, 0, k, 0, 0);
      const scenery = new Scenery();
      scenery.setTheme(id);
      // 選一個好看的時間點（例如 101 的煙火、纜車都在畫面上）
      const time = 30000;
      scenery.draw(g, time, k, 0, 0, FIELD_W, FIELD_H);
      scenery.drawOverlay(g, time, 0, 0, FIELD_W, FIELD_H);
      return c.toDataURL('image/webp', 0.85);
    });
    queue = p;
    cache.set(id, p);
  }
  return p;
}
