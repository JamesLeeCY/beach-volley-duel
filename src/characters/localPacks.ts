// 匯入的角色包：存在 IndexedDB，只在本機可見；啟動時載入並加進角色清單。
import { loadPack, registerPack, unregisterPack, isBuiltin, type CharacterPack } from './registry';
import { mimeOf, PackError, parsePackZip } from './packZip';

const DB_NAME = 'bvd-packs';
const STORE = 'packs';

interface PackRecord {
  id: string;
  raw: unknown;
  files: Record<string, ArrayBuffer>;
  added: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

const objectUrls = new Map<string, string[]>();

async function toPack(rec: PackRecord): Promise<CharacterPack | null> {
  for (const u of objectUrls.get(rec.id) ?? []) URL.revokeObjectURL(u);
  const urls: Record<string, string> = {};
  for (const [path, buf] of Object.entries(rec.files)) urls[path] = URL.createObjectURL(new Blob([buf], { type: mimeOf(path) }));
  objectUrls.set(rec.id, Object.values(urls));
  return loadPack((p) => urls[p] ?? '', rec.raw);
}

/** 啟動時呼叫：把 IndexedDB 裡的角色包加進角色清單 */
export async function loadLocalPacks(): Promise<CharacterPack[]> {
  let recs: PackRecord[] = [];
  try {
    recs = await tx('readonly', (s) => s.getAll() as IDBRequest<PackRecord[]>);
  } catch {
    return []; // 無痕模式或不支援 IndexedDB
  }
  const out: CharacterPack[] = [];
  for (const rec of recs.sort((a, b) => a.added - b.added)) {
    const pack = await toPack(rec);
    if (pack && registerPack(pack)) out.push(pack);
  }
  return out;
}

/** 匯入 .zip：驗證、存進 IndexedDB、加入角色清單。失敗時丟出 PackError。 */
export async function importPackZip(file: Blob): Promise<CharacterPack> {
  const { raw, manifest, files } = parsePackZip(new Uint8Array(await file.arrayBuffer()));
  if (isBuiltin(manifest.id)) throw new PackError(`id "${manifest.id}" is a built-in character`);
  const rec: PackRecord = {
    id: manifest.id,
    raw,
    files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.slice().buffer])),
    added: Date.now(),
  };
  const pack = await toPack(rec);
  if (!pack?.sprite) throw new PackError(`sprite "${manifest.sprite}" is not a valid image`);
  await tx('readwrite', (s) => s.put(rec));
  registerPack(pack);
  return pack;
}

export async function deleteLocalPack(id: string) {
  await tx('readwrite', (s) => s.delete(id));
  for (const u of objectUrls.get(id) ?? []) URL.revokeObjectURL(u);
  objectUrls.delete(id);
  unregisterPack(id);
}
