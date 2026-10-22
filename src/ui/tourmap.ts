// 環島地圖：簡化的臺灣本島與金門輪廓，12 站依路線連成一圈；蓋到章的站點亮。
// 台北的 7 站擠在同一點，改成圍繞台北的一小圈。
import type { SceneId } from '../render/scenery';
import { ROUTE } from './tour';

/** 經緯度 → 地圖座標（每度 80px） */
const K = 80;
const LON0 = 119.0;
const LAT0 = 25.45;
const px = (lon: number, lat: number): [number, number] => [(lon - LON0) * K, (LAT0 - lat) * K];

/** 臺灣本島輪廓（順時針，從富貴角開始） */
const TAIWAN: [number, number][] = [
  [121.54, 25.3], [121.75, 25.15], [122.0, 25.0], [121.83, 24.75], [121.86, 24.58], [121.62, 24.0], [121.45, 23.4],
  [121.15, 22.75], [120.9, 22.3], [120.85, 21.9], [120.73, 21.95], [120.6, 22.35], [120.27, 22.62], [120.1, 23.0],
  [120.13, 23.5], [120.38, 24.08], [120.52, 24.28], [120.9, 24.82], [121.1, 25.05], [121.4, 25.2],
];
/** 金門實際在更西邊（118.3°E），地圖上畫成靠近臺灣海峽的小插圖 */
const KINMEN: [number, number] = [119.4, 24.45];

/** 各站在地圖上的位置（台北的站另外排成一圈） */
const PLACES: Partial<Record<SceneId, [number, number]>> = {
  wuling: [121.31, 24.39],
  comet: [121.27, 24.14],
  lake: [120.91, 23.86],
  beach: [120.8, 21.98],
  kinmen: KINMEN,
};
const TAIPEI: [number, number] = [121.53, 25.04];

export function stationPoint(scene: SceneId): [number, number] {
  const p = PLACES[scene];
  if (p) return px(p[0], p[1]);
  // 台北的 7 站：在台北外圍排成一圈
  const taipei = ROUTE.filter((s) => !PLACES[s.scene]);
  const k = taipei.findIndex((s) => s.scene === scene);
  const [cx, cy] = px(TAIPEI[0], TAIPEI[1]);
  const a = -Math.PI * 0.95 + (k / Math.max(1, taipei.length - 1)) * Math.PI * 1.25;
  return [cx + Math.cos(a) * 34, cy + Math.sin(a) * 24 - 6];
}

/** 產生地圖 SVG（內容都是程式內的常數，沒有外部輸入） */
export function tourMapSvg(stamps: readonly SceneId[], next: number): string {
  const poly = TAIWAN.map(([lon, lat]) => px(lon, lat).map((v) => v.toFixed(1)).join(',')).join(' ');
  const [kx, ky] = px(KINMEN[0], KINMEN[1]);
  const pts = ROUTE.map((s) => stationPoint(s.scene));
  const route = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const dots = ROUTE.map((s, i) => {
    const [x, y] = pts[i];
    const done = stamps.includes(s.scene);
    const cls = done ? 'done' : i === next ? 'next' : '';
    return `<g class="st ${cls}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7"/>`
      + `<text x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}">${i + 1}</text></g>`;
  }).join('');
  const w = (122.2 - LON0) * K;
  const h = (LAT0 - 21.7) * K;
  return `<svg class="tour-svg" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" role="img" aria-label="Taiwan">`
    + `<polygon class="land" points="${poly}"/>`
    + `<rect class="inset" x="${(kx - 22).toFixed(1)}" y="${(ky - 22).toFixed(1)}" width="44" height="38" rx="4"/>`
    + `<ellipse class="land" cx="${kx.toFixed(1)}" cy="${ky.toFixed(1)}" rx="11" ry="6"/>`
    + `<polyline class="route" points="${route}"/>`
    + dots
    + '</svg>';
}
