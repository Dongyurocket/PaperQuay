import { extractTranslatableMarkdownFromMineruBlock } from '../../services/mineru.ts';
import type {
  PositionedMineruBlock,
  TranslationBlockInput,
  TranslationMap,
  TranslationSourceHashes,
} from '../../types/reader';

/**
 * 块级源文本指纹。键是 blockId，值是生成译文时使用的源文本指纹。
 * 指纹只用于本地译文缓存失效判断，不承担任何安全用途。
 */
export type { TranslationSourceHashes };

const HASH_SEED_1 = 0x9e3779b9;
const HASH_SEED_2 = 0x85ebca6b;
const HASH_SEED_3 = 0xc2b2ae35;
const FNV_PRIME = 0x01000193;

function avalanche(value: number): number {
  let hash = value >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/**
 * 同步计算源文本指纹（3 × 32 位混合 + 长度）。
 *
 * 重解析覆盖、全文翻译和缓存读取都在渲染路径上，必须同步且足够快；
 * 单块文本可达数千字符，整篇可达上千块，因此不用 `crypto.subtle`
 * （异步）也不做逐字符 BigInt 运算。碰撞概率远低于本地缓存误用的可接受
 * 水平，且判据始终与 blockId 一起使用。
 */
export function hashTranslationSourceText(text: string): string {
  const normalized = text.trim();
  let hash1 = (0x811c9dc5 ^ HASH_SEED_1) >>> 0;
  let hash2 = (0x811c9dc5 ^ HASH_SEED_2) >>> 0;
  let hash3 = (0x811c9dc5 ^ HASH_SEED_3) >>> 0;

  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.charCodeAt(index);
    hash1 = Math.imul(hash1 ^ code, FNV_PRIME);
    hash2 = Math.imul(hash2 ^ code, HASH_SEED_2);
    hash3 = Math.imul(hash3 ^ code, HASH_SEED_3);
  }

  return [avalanche(hash1), avalanche(hash2), avalanche(hash3), normalized.length >>> 0]
    .map((value) => value.toString(16).padStart(8, '0'))
    .join('');
}

/** 解析阅读器当前用于翻译的源文本：AI 重解析覆盖优先，否则用原始 MinerU 文本。 */
export function resolveBlockTranslationText(
  block: PositionedMineruBlock,
  getOverrideMarkdown?: (blockId: string) => string | undefined,
): string {
  const override = getOverrideMarkdown?.(block.blockId)?.trim();

  return override || extractTranslatableMarkdownFromMineruBlock(block).trim();
}

/**
 * 构造翻译输入。`text` 与 `sourceHash` 必须同时生成，保证“送进模型的文本”
 * 与“之后判定译文是否仍然有效”的指纹完全一致。
 */
export function buildBlockTranslationInput(
  block: PositionedMineruBlock,
  getOverrideMarkdown?: (blockId: string) => string | undefined,
): TranslationBlockInput | null {
  if (block.contentSourceBlockId) {
    return null;
  }

  const text = resolveBlockTranslationText(block, getOverrideMarkdown);

  return text
    ? { blockId: block.blockId, text, sourceHash: hashTranslationSourceText(text) }
    : null;
}

export function buildBlockTranslationInputs(
  blocks: PositionedMineruBlock[],
  getOverrideMarkdown?: (blockId: string) => string | undefined,
): TranslationBlockInput[] {
  return blocks
    .map((block) => buildBlockTranslationInput(block, getOverrideMarkdown))
    .filter((block): block is TranslationBlockInput => Boolean(block));
}

/** 为一批当前文档块生成指纹表。 */
export function buildTranslationSourceHashes(
  blocks: Iterable<Pick<TranslationBlockInput, 'blockId' | 'text'>>,
): TranslationSourceHashes {
  const hashes: TranslationSourceHashes = {};

  for (const block of blocks) {
    const blockId = block.blockId.trim();

    if (!blockId) {
      continue;
    }

    hashes[blockId] = hashTranslationSourceText(block.text);
  }

  return hashes;
}

/** 已确定的译文对应的就是当前源文本，直接给这些块补上当前指纹。 */
export function withCurrentSourceHashes(
  translations: TranslationMap | null | undefined,
  currentHashes: TranslationSourceHashes,
): TranslationSourceHashes {
  const hashes: TranslationSourceHashes = {};

  if (!translations) {
    return hashes;
  }

  for (const blockId of Object.keys(translations)) {
    const currentHash = currentHashes[blockId];

    if (currentHash) {
      hashes[blockId] = currentHash;
    }
  }

  return hashes;
}

export function mergeSourceHashes(
  ...hashMaps: Array<TranslationSourceHashes | null | undefined>
): TranslationSourceHashes {
  const merged: TranslationSourceHashes = {};

  for (const hashMap of hashMaps) {
    if (!hashMap) {
      continue;
    }

    Object.assign(merged, hashMap);
  }

  return merged;
}

export interface ReconcileTranslationsInput {
  translations: TranslationMap | null | undefined;
  /** 译文写入时记录的源文本指纹；旧版缓存没有该字段 */
  storedHashes?: TranslationSourceHashes | null;
  /** 需要校验的块当前源文本指纹；未提供的块按 `knownBlockIds` 判断。 */
  currentHashes: TranslationSourceHashes;
  /** 当前存在 AI 重解析覆盖的块 */
  customSourceBlockIds?: Iterable<string> | null;
  /** 当前文档的块集合；传入时丢弃文档中已不存在的块 */
  knownBlockIds?: ReadonlySet<string> | null;
}

export interface ReconcileTranslationsResult {
  translations: TranslationMap;
  sourceHashes: TranslationSourceHashes;
}

/**
 * 只保留“译文确实对应当前源文本”的条目，并返回这些条目当前的指纹。
 *
 * 判定规则：
 * - 有指纹：必须与当前源文本指纹一致；
 * - 无指纹（旧版缓存）：视为基于原始 OCR 生成的译文。若该块已被 AI 重解析
 *   覆盖，则必然过期；否则仍然有效，并补写当前指纹；
 * - 当前文档中不存在该块：传入 `knownBlockIds` 时丢弃，避免重新解析后
 *   blockId 漂移导致旧译文张冠李戴。
 */
export function reconcileTranslations({
  translations,
  storedHashes,
  currentHashes,
  customSourceBlockIds,
  knownBlockIds,
}: ReconcileTranslationsInput): ReconcileTranslationsResult {
  const normalizedTranslations: TranslationMap = {};
  const nextHashes: TranslationSourceHashes = {};
  const customBlockIds = new Set(customSourceBlockIds ?? []);

  for (const [rawBlockId, rawTranslatedText] of Object.entries(translations ?? {})) {
    const blockId = rawBlockId.trim();
    const translatedText = typeof rawTranslatedText === 'string'
      ? rawTranslatedText.trim()
      : '';

    if (!blockId || !translatedText) {
      continue;
    }

    if (knownBlockIds && !knownBlockIds.has(blockId)) {
      continue;
    }

    const currentHash = currentHashes[blockId];

    if (!currentHash) {
      // 无法取得当前文本（调用方只算了候选块）；保留条目，由其它路径决定。
      normalizedTranslations[blockId] = translatedText;
      const storedHash = (storedHashes?.[blockId] ?? '').trim();

      if (storedHash) {
        nextHashes[blockId] = storedHash;
      }

      continue;
    }

    const storedHash = (storedHashes?.[blockId] ?? '').trim();
    const isCurrent = storedHash
      ? storedHash === currentHash
      : !customBlockIds.has(blockId);

    if (!isCurrent) {
      continue;
    }

    normalizedTranslations[blockId] = translatedText;
    nextHashes[blockId] = currentHash;
  }

  return { translations: normalizedTranslations, sourceHashes: nextHashes };
}

export function sameTranslationMap(left: TranslationMap, right: TranslationMap): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);

  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  return leftEntries.every(([blockId, text]) => right[blockId] === text);
}
