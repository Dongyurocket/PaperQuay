import type { PositionedMineruBlock } from '../types/reader';

const STORAGE_PREFIX = 'paperquay:block-reparse:v1:';
export type BlockReparseOverrides = Record<string, string>;
type OverrideStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Bind overrides to both the document and the complete, unmodified parse content.
 * A changed block order, geometry, text, or source path produces a different revision.
 */
export async function createBlockReparseStorageKey(
  documentSource: string,
  parsePath: string,
  blocks: PositionedMineruBlock[],
): Promise<string> {
  if (!documentSource && !parsePath) throw new Error('无法确定文献标识，暂不能保存区块修复。');
  const content = JSON.stringify([documentSource, parsePath, blocks]);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return STORAGE_PREFIX + Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function loadBlockReparseOverrides(storage: OverrideStorage, key: string): BlockReparseOverrides {
  const raw = storage.getItem(key);
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('已保存的区块修复数据格式无效。');
  }
  const result: BlockReparseOverrides = {};
  for (const [id, value] of Object.entries(parsed)) {
    if (typeof value === 'string' && value.trim()) {
      Object.defineProperty(result, id, { value, enumerable: true, writable: true, configurable: true });
    }
  }
  return result;
}

/** Write before applying in memory: storage failures must not look like a saved repair. */
export function saveBlockReparseOverride(
  storage: OverrideStorage,
  key: string,
  blockId: string,
  markdown: string | null,
): BlockReparseOverrides {
  const current = loadBlockReparseOverrides(storage, key);
  const next = { ...current };
  if (markdown?.trim()) {
    Object.defineProperty(next, blockId, { value: markdown.trim(), enumerable: true, writable: true, configurable: true });
  } else {
    delete next[blockId];
  }
  if (Object.keys(next).length) storage.setItem(key, JSON.stringify(next));
  else storage.removeItem(key);
  return next;
}
