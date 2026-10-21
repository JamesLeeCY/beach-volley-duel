import { describe, expect, it } from 'vitest';
import { beats, dareUrl, headline, lineShareUrl, parseDare, stripLinkParams, type Dare } from '../src/ui/dare';
import { COACH_MAX_TICKS, Coach } from '../src/ui/coach';
import { createState, defaultConfig, step } from '../src/engine/physics';
import { IN_RIGHT } from '../src/engine/types';
import type { SceneId } from '../src/render/scenery';

const valid = { char: (id: string) => ['shishi', 'meimei', 'goldie'].includes(id), scenes: ['beach', 'lake'] as SceneId[] };
const sample: Dare = { me: 'shishi', opp: 'meimei', scene: 'lake', score: [7, 3], level: 'normal', target: 7 };

describe('挑戰連結', () => {
  it('產生的網址可以原樣解析回來', () => {
    const url = dareUrl('https://x.test/game/', sample);
    expect(url).toBe('https://x.test/game/?vs=meimei&as=shishi&scene=lake&score=7-3&lv=normal&to=7');
    expect(parseDare(new URL(url).search, valid)).toEqual(sample);
  });

  it('不合法的參數整個不採用', () => {
    const bad = [
      '?vs=nobody&as=shishi&scene=lake&score=7-3&lv=normal&to=7', // 角色不存在
      '?vs=meimei&as=shishi&scene=mars&score=7-3&lv=normal&to=7', // 場景不存在
      '?vs=meimei&as=shishi&scene=lake&score=5-3&lv=normal&to=7', // 沒有人打到目標分數
      '?vs=meimei&as=shishi&scene=lake&score=7-7&lv=normal&to=7', // 平手
      '?vs=meimei&as=shishi&scene=lake&score=7-3&lv=godlike&to=7', // 難度不存在
      '?vs=meimei&as=shishi&scene=lake&score=7-3&lv=normal&to=999',
      '?vs=<img>&as=shishi&scene=lake&score=7-3&lv=normal&to=7',
      '?room=ABC234',
    ];
    for (const q of bad) expect(parseDare(q, valid), q).toBeNull();
  });

  it('分差比較大才算贏過', () => {
    expect(beats([7, 2], [7, 3])).toBe(true);
    expect(beats([7, 3], [7, 3])).toBe(false);
    expect(beats([7, 5], [7, 3])).toBe(false);
    expect(beats([5, 7], [3, 7])).toBe(true);
  });

  it('戰績標題依分差換說法', () => {
    expect(headline('zh-TW', '石虎', '台灣黑熊', [7, 3])).toBe('我用石虎 7:3 打爆台灣黑熊 🏐');
    expect(headline('zh-TW', '石虎', '台灣黑熊', [7, 6])).toBe('我用石虎 7:6 險勝台灣黑熊 🏐');
    expect(headline('zh-TW', '石虎', '台灣黑熊', [5, 7])).toBe('我用石虎 5:7 惜敗給台灣黑熊 🏐');
    expect(headline('zh-TW', '石虎', '台灣黑熊', [7, 4], false)).toBe('石虎 7:4 擊敗台灣黑熊 🏐');
    expect(headline('en', 'Leopard Cat', 'Black Bear', [7, 3])).toBe('My Leopard Cat crushed Black Bear 7:3 🏐');
  });

  it('處理完的連結參數會從網址移除，其他參數保留', () => {
    expect(stripLinkParams('https://x.test/g/?vs=a&as=b&scene=lake&score=7-3&lv=hard&to=7')).toBe('/g/');
    expect(stripLinkParams('https://x.test/g/?room=ABC234&debug=1#x')).toBe('/g/?debug=1#x');
  });

  it('LINE 分享網址把文字完整編碼', () => {
    expect(lineShareUrl('我 7:3\nhttps://a.b/?x=1&y=2')).toBe(
      'https://line.me/R/share?text=%E6%88%91%207%3A3%0Ahttps%3A%2F%2Fa.b%2F%3Fx%3D1%26y%3D2',
    );
  });
});

describe('第一場的場上提示', () => {
  it('玩家做到了就換下一句', () => {
    const cfg = defaultConfig({ targetScore: 99 });
    let s = createState(5);
    const c = new Coach(s);
    expect(c.step).toBe(0);
    let r: string | null = null;
    for (let i = 0; i < 120 && !r; i++) {
      s = step(s, IN_RIGHT, 0, cfg);
      r = c.update(s, s.events);
    }
    expect(r).toBe('done');
    expect(c.step).toBe(1);
  });

  it('一直做不到也會逾時換下一句，最後結束', () => {
    const cfg = defaultConfig({ targetScore: 99 });
    let s = createState(5);
    const c = new Coach(s);
    const seen: (string | null)[] = [];
    for (let i = 0; i < COACH_MAX_TICKS * 5 && !c.finished; i++) {
      s = step(s, 0, 0, cfg);
      const r = c.update(s, s.events);
      if (r) seen.push(r);
    }
    expect(c.finished).toBe(true);
    expect(seen.length).toBe(4);
    expect(c.current).toBeNull();
  });
});
