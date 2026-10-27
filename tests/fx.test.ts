import { describe, expect, it } from 'vitest';
import { Fx } from '../src/render/fx';
import index from '../public/characters/index.json';

const host = () => {
  const calls = { shake: 0, flash: 0, punch: 0 };
  return { calls, host: { shake: () => calls.shake++, flash: () => calls.flash++, punch: () => calls.punch++ } };
};

describe('角色特效', () => {
  it('16 隻動物扣殺都有自己的粒子特效（不顯示任何狀聲詞文字）', () => {
    for (const id of index) {
      const fx = new Fx(host().host);
      fx.emit('spike', id, 100, 100, 1);
      expect(fx.particles.length + fx.slashes.length + fx.rings.length, id).toBeGreaterThan(1);
      expect('words' in fx, id).toBe(false);
    }
  });

  it('簡潔模式：粒子減半、不閃光不震動', () => {
    const full = host();
    const a = new Fx(full.host);
    a.emit('spike', 'caicai', 100, 100, 1);
    const lite = host();
    const b = new Fx(lite.host);
    b.amount = 0.5;
    b.emit('spike', 'caicai', 100, 100, 1);
    expect(b.particles.length).toBeLessThan(a.particles.length);
    expect(full.calls.flash + full.calls.shake).toBeGreaterThan(0);
    expect(lite.calls).toEqual({ shake: 0, flash: 0, punch: 0 });
  });

  it('粒子會消失，數量有上限', () => {
    const fx = new Fx(host().host);
    for (let i = 0; i < 100; i++) fx.emit('score', 'caicai', 100, 100, 1);
    expect(fx.particles.length).toBeLessThanOrEqual(420);
    for (let i = 0; i < 200; i++) fx.step();
    expect(fx.particles.length + fx.rings.length).toBe(0);
  });
});
