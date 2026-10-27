// 把精彩球重演一次、畫在另一張畫布上，同時用瀏覽器內建的 MediaRecorder 錄成影片。
// 得分前 0.8 秒到得分後 0.3 秒放慢成 0.35 倍；畫面左上角「精彩重播」、下方戰績標題與網址。
// 支援 MP4 的瀏覽器（Safari、新版 Chrome）錄 MP4，方便傳 LINE；其他錄 WebM。
// 不支援錄影時（舊瀏覽器）仍會播放重播，只是不能存成影片。
import { Renderer, type BallSkin, type View } from '../render/renderer';
import type { SceneId } from '../render/scenery';
import type { CharacterPack } from '../characters/registry';
import type { GameState } from '../engine/types';
import type { Highlight, MatchRecorder } from './recorder';

const VW = 864;
const VH = 608;
const VIDEO_FPS = 30;

export function videoMime(): string | null {
  const MR = (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
  if (!MR) return null;
  for (const m of ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    if (MR.isTypeSupported?.(m)) return m;
  }
  return null;
}

export interface ReplayVideoOpts {
  packs: [CharacterPack, CharacterPack];
  label: string;
  caption: string;
  url: string;
  /** 每畫一幀就呼叫（顯示進度） */
  onProgress?: (t: number) => void;
}

export interface ReplayJob {
  canvas: HTMLCanvasElement;
  /** 錄完的影片；不支援錄影時是 null */
  done: Promise<Blob | null>;
  cancel(): void;
}

export function playHighlight(rec: MatchRecorder, hl: Highlight, o: ReplayVideoOpts): ReplayJob {
  const canvas = document.createElement('canvas');
  const renderer = new Renderer(canvas);
  renderer.resizeExact(VW, VH);
  const m = rec.meta;
  const view: View = {
    mirror: false,
    chars: o.packs,
    hueShift2: m.chars[0] === m.chars[1],
    smooth: true,
    scene: m.scene as SceneId,
    ball: m.ball as BallSkin,
    hats: m.hats,
    night: m.night,
  };

  const mime = videoMime();
  let recorder: MediaRecorder | null = null;
  const chunks: Blob[] = [];
  const cap = (canvas as HTMLCanvasElement & { captureStream?: (fps: number) => MediaStream }).captureStream;
  if (mime && cap) {
    try {
      recorder = new MediaRecorder(cap.call(canvas, VIDEO_FPS), { mimeType: mime, videoBitsPerSecond: 3_000_000 });
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    } catch {
      recorder = null;
    }
  }

  let cancelled = false;
  let resolveDone: (b: Blob | null) => void = () => {};
  const done = new Promise<Blob | null>((r) => (resolveDone = r));

  // 從開場重演到精彩球開始的前一幀
  let cur: GameState = rec.stateAt(hl.from);
  let prev = cur;
  let frame = hl.from;
  let pos = hl.from;
  const slowFrom = hl.at - Math.round(m.fps * 0.8);
  const slowTo = hl.at + Math.round(m.fps * 0.3);
  let last = performance.now();
  let holdUntil = 0;

  const overlay = (g: CanvasRenderingContext2D) => {
    g.setTransform(1, 0, 0, 1, 0, 0);
    const font = '"Arial Rounded MT Bold", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
    g.font = `900 30px ${font}`;
    g.textBaseline = 'middle';
    // 標籤放在上方正中間，不蓋住兩邊的比分
    const tw = g.measureText(o.label).width;
    const lx = (VW - (tw + 70)) / 2;
    g.fillStyle = 'rgba(12,28,52,0.75)';
    g.beginPath();
    g.roundRect(lx, 16, tw + 70, 52, 26);
    g.fill();
    g.fillStyle = '#e8384a';
    g.beginPath();
    g.arc(lx + 26, 42, 9, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.fillText(o.label, lx + 44, 43);
    const slow = frame >= slowFrom && frame <= slowTo;
    if (slow) {
      g.font = `900 24px ${font}`;
      g.fillStyle = '#ffe27a';
      g.textAlign = 'center';
      g.fillText('▶▶ SLOW', VW / 2, 92);
      g.textAlign = 'left';
    }
    // 下方：戰績標題＋網址
    g.fillStyle = 'rgba(12,28,52,0.7)';
    g.fillRect(0, VH - 70, VW, 70);
    g.textAlign = 'center';
    g.font = `900 26px ${font}`;
    g.fillStyle = '#ffe27a';
    g.fillText(o.caption, VW / 2, VH - 46, VW - 40);
    g.font = `700 16px ${font}`;
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.fillText(o.url.replace(/^https?:\/\//, '').replace(/\?.*$/, ''), VW / 2, VH - 18);
    g.textAlign = 'left';
  };

  const finish = () => {
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = () => resolveDone(cancelled ? null : new Blob(chunks, { type: mime!.split(';')[0] }));
      recorder.stop();
    } else resolveDone(null);
  };

  const tick = (now: number) => {
    if (cancelled) return finish();
    const dt = Math.min(100, now - last);
    last = now;
    if (!holdUntil) {
      const speed = frame >= slowFrom && frame <= slowTo ? 0.35 : 1;
      pos += (dt / 1000) * m.fps * speed;
      while (frame < Math.floor(pos) && frame < hl.to) {
        prev = cur;
        cur = rec.stepAt(cur, frame);
        renderer.spawnEffects(cur.events, false, m.chars);
        frame++;
      }
      if (frame >= hl.to) holdUntil = now + 600;
    } else if (now >= holdUntil) {
      renderer.draw(prev, cur, 1, view, now);
      overlay((canvas.getContext('2d') as CanvasRenderingContext2D));
      return finish();
    }
    renderer.draw(prev, cur, Math.min(1, pos - Math.floor(pos)), view, now);
    overlay(canvas.getContext('2d') as CanvasRenderingContext2D);
    o.onProgress?.((frame - hl.from) / Math.max(1, hl.to - hl.from));
    requestAnimationFrame(tick);
  };

  // 先畫第一幀再開始錄，影片開頭才不會是黑的
  renderer.draw(prev, cur, 1, view, performance.now());
  overlay(canvas.getContext('2d') as CanvasRenderingContext2D);
  recorder?.start(250);
  requestAnimationFrame(tick);

  return {
    canvas,
    done,
    cancel() {
      cancelled = true;
    },
  };
}
