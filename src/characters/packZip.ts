// 解析使用者拖入的角色包 .zip（純函式，不碰 DOM，方便單元測試）。
// 結構：manifest.json 與其引用的圖片，可放在 zip 根目錄或單一資料夾內。
import { unzipSync } from 'fflate';
import { ManifestSchema, type Manifest } from './registry';

export const MAX_ZIP_BYTES = 5 * 1024 * 1024;
export const MAX_UNZIPPED_BYTES = 10 * 1024 * 1024;

export interface PackFiles {
  raw: unknown;
  manifest: Manifest;
  /** manifest 內的相對路徑 → 檔案內容 */
  files: Record<string, Uint8Array>;
}

export class PackError extends Error {}

const MIME: Record<string, string> = {
  png: 'image/png', webp: 'image/webp', gif: 'image/gif', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  ogg: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav', json: 'application/json',
};

export function mimeOf(path: string): string {
  return MIME[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

export function parsePackZip(bytes: Uint8Array): PackFiles {
  if (bytes.byteLength > MAX_ZIP_BYTES) throw new PackError('zip > 5 MB');
  let entries: Record<string, Uint8Array>;
  let total = 0;
  try {
    entries = unzipSync(bytes, {
      filter: (f) => {
        if (f.name.endsWith('/') || f.name.startsWith('__MACOSX/')) return false;
        total += f.originalSize;
        if (total > MAX_UNZIPPED_BYTES) throw new PackError('unzipped > 10 MB');
        return true;
      },
    });
  } catch (e) {
    if (e instanceof PackError) throw e;
    throw new PackError('not a zip file');
  }
  // 取路徑最短的 manifest.json 當作包的根目錄
  const manifestPath = Object.keys(entries)
    .filter((n) => n === 'manifest.json' || n.endsWith('/manifest.json'))
    .sort((a, b) => a.length - b.length)[0];
  if (!manifestPath) throw new PackError('manifest.json missing');
  const root = manifestPath.slice(0, -'manifest.json'.length);
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(entries[manifestPath]));
  } catch {
    throw new PackError('manifest.json is not valid JSON');
  }
  const parsed = ManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new PackError(`manifest: ${issue.path.join('.')} ${issue.message}`);
  }
  const files: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(entries)) {
    if (name.startsWith(root) && name !== manifestPath) files[name.slice(root.length)] = data;
  }
  const m = parsed.data;
  if (!files[m.sprite]) throw new PackError(`sprite "${m.sprite}" missing`);
  if (m.portrait && !files[m.portrait]) throw new PackError(`portrait "${m.portrait}" missing`);
  return { raw, manifest: m, files };
}
