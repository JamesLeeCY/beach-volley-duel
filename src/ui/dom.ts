type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;

/** 極簡 DOM 建構器 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function button(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  return h('button', { class: cls, type: 'button', onclick: () => onClick() }, label);
}

/** 分段選擇按鈕 */
export function segmented<T extends string | number | boolean>(
  options: { value: T; label: string }[],
  current: T,
  onChange: (v: T) => void,
): HTMLDivElement {
  const wrap = h('div', { class: 'seg' });
  for (const o of options) {
    const b = button(o.label, () => {
      for (const c of wrap.children) c.classList.remove('on');
      b.classList.add('on');
      onChange(o.value);
    });
    if (o.value === current) b.classList.add('on');
    wrap.append(b);
  }
  return wrap;
}

/** 卡片選擇器：每個選項是一張帶縮圖的卡片 */
export function cardPicker<T extends string>(
  options: { value: T; label: string; thumb: (el: HTMLElement) => void }[],
  current: T,
  onChange: (v: T) => void,
  cls = '',
): HTMLDivElement {
  const wrap = h('div', { class: `cards ${cls}` });
  for (const o of options) {
    const pic = h('span', { class: 'card-pic' });
    o.thumb(pic);
    const b = h('button', {
      type: 'button',
      class: 'card',
      onclick: () => {
        for (const c of wrap.children) c.classList.remove('on');
        b.classList.add('on');
        onChange(o.value);
      },
    }, pic, h('span', { class: 'card-label' }, o.label));
    if (o.value === current) b.classList.add('on');
    wrap.append(b);
  }
  return wrap;
}

/** 方向鍵／手把在選單按鈕間移動焦點 */
export function moveFocus(root: HTMLElement, dir: 'up' | 'down' | 'left' | 'right') {
  const items = [...root.querySelectorAll<HTMLButtonElement>('button:not([disabled])')].filter((b) => b.offsetParent !== null);
  if (!items.length) return;
  const cur = document.activeElement as HTMLElement | null;
  const idx = cur ? items.indexOf(cur as HTMLButtonElement) : -1;
  if (idx < 0) {
    items[0].focus();
    return;
  }
  // 以畫面位置找最近的下一個按鈕
  const r = cur!.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  let best: HTMLButtonElement | null = null;
  let bestScore = Infinity;
  for (const b of items) {
    if (b === cur) continue;
    const br = b.getBoundingClientRect();
    const dx = br.left + br.width / 2 - cx;
    const dy = br.top + br.height / 2 - cy;
    const along = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy;
    const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (along <= 2) continue;
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = b;
    }
  }
  if (!best) {
    // 沒有該方向的按鈕時，上下改為循環
    if (dir === 'down') best = items[(idx + 1) % items.length];
    else if (dir === 'up') best = items[(idx - 1 + items.length) % items.length];
  }
  best?.focus();
}
