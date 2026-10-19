// 角色包：public/characters/<id>/manifest.json + 精靈圖。新增角色只要放資料夾並加進 index.json。
import { z } from 'zod';
import type { Stats } from '../engine/types';

const Anim = z.object({ row: z.number().int().min(0), frames: z.number().int().min(1), fps: z.number().positive() });
const Stat = z.number().int().min(-2).max(2);

export const ManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/),
  name: z.record(z.string(), z.string()),
  sprite: z.string(),
  frameSize: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  animations: z.object({ idle: Anim }).catchall(Anim),
  hitbox: z.object({ w: z.number(), h: z.number() }).optional(),
  stats: z.object({ speed: Stat, jump: Stat, power: Stat }).catch({ speed: 0, jump: 0, power: 0 }),
  sfx: z.record(z.string(), z.string()).optional(),
  portrait: z.string().optional(),
  themeColor: z.string().default('#cccccc'),
});

export type Manifest = z.infer<typeof ManifestSchema>;
export type AnimName = 'idle' | 'run' | 'jump' | 'spike' | 'dive' | 'win' | 'lose' | 'bump' | 'cheer' | 'oops';

export interface CharacterPack {
  id: string;
  manifest: Manifest;
  sprite: HTMLImageElement | null;
  portrait: string | null;
  hash: string;
  /** 由使用者匯入、只存在本機（IndexedDB） */
  local?: boolean;
}

export const DEFAULT_CHARACTER = 'momo';

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * 驗證並建立角色包；失敗時回傳 null（呼叫端會退回預設角色）。
 * base 可以是網址前綴，或把 manifest 內的相對路徑轉成網址的函式（例如匯入包的 blob: URL）。
 */
export async function loadPack(base: string | ((path: string) => string), raw: unknown): Promise<CharacterPack | null> {
  const url = typeof base === 'string' ? (p: string) => base + p : base;
  const parsed = ManifestSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn('[characters] manifest 無效', base, parsed.error.issues);
    return null;
  }
  const m = parsed.data;
  const sprite = await loadImage(url(m.sprite));
  if (!sprite) console.warn('[characters] 精靈圖載入失敗', url(m.sprite));
  return {
    id: m.id,
    manifest: m,
    sprite,
    portrait: m.portrait ? url(m.portrait) : null,
    hash: fnv(JSON.stringify(raw)),
  };
}

const packs = new Map<string, CharacterPack>();

export async function loadCharacters(base = './characters/'): Promise<CharacterPack[]> {
  let ids: string[] = [DEFAULT_CHARACTER];
  try {
    const res = await fetch(base + 'index.json');
    const list = await res.json();
    if (Array.isArray(list)) ids = list.filter((x) => typeof x === 'string');
  } catch {
    // 使用預設清單
  }
  const loaded = await Promise.all(
    ids.map(async (id) => {
      try {
        const res = await fetch(`${base}${id}/manifest.json`);
        return await loadPack(`${base}${id}/`, await res.json());
      } catch {
        return null;
      }
    }),
  );
  for (const p of loaded) if (p) packs.set(p.id, p);
  if (!packs.size) {
    // 連預設角色都載入失敗：建立純色佔位角色，確保不會當機
    const m = ManifestSchema.parse({
      id: DEFAULT_CHARACTER, name: { 'zh-TW': '桃桃', en: 'Momo' }, sprite: '', frameSize: [64, 64],
      animations: { idle: { row: 0, frames: 1, fps: 1 } }, themeColor: '#F29B38',
    });
    packs.set(m.id, { id: m.id, manifest: m, sprite: null, portrait: null, hash: '0' });
  }
  return [...packs.values()];
}

/** 加入（或取代同 id 的）匯入角色；不可覆蓋內建角色 */
export function registerPack(pack: CharacterPack): boolean {
  const cur = packs.get(pack.id);
  if (cur && !cur.local) return false;
  packs.set(pack.id, { ...pack, local: true });
  return true;
}

export function unregisterPack(id: string) {
  if (packs.get(id)?.local) packs.delete(id);
}

export function isBuiltin(id: string): boolean {
  const p = packs.get(id);
  return !!p && !p.local;
}

export function allCharacters(): CharacterPack[] {
  return [...packs.values()];
}

export function getCharacter(id: string): CharacterPack {
  return packs.get(id) ?? packs.get(DEFAULT_CHARACTER) ?? [...packs.values()][0];
}

export function hasCharacter(id: string): boolean {
  return packs.has(id);
}

export function statsOf(id: string): Stats {
  return { ...getCharacter(id).manifest.stats };
}

/** 缺少的動畫退回 idle */
export function animOf(pack: CharacterPack, name: AnimName) {
  const a = pack.manifest.animations;
  return a[name] ?? a.idle;
}

export function displayName(pack: CharacterPack, lang: string): string {
  const n = pack.manifest.name;
  return n[lang] ?? n.en ?? Object.values(n)[0] ?? pack.id;
}
