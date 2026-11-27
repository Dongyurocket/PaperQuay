import type { MineruBlockBase, PositionedMineruBlock } from '../types/reader';
import { extractTableHtmlFromMineruBlock, extractTextFromMineruBlock } from './mineru.ts';
import type { MineruOutlineIndexItem } from '../features/reader/mineruSegments.ts';

/**
 * 解析结果手动编辑（Parse Edits）。
 *
 * MinerU 的分页切片/合并偶尔会在识别结果里留下多余内容（页眉页脚、跨页重复块、
 * 切片边界的碎片等）。阅读器允许用户直接修正文本或隐藏整个块，而不改写
 * content_list 原文件：
 *
 *  - 编辑按 blockId 记录，并附带「原始块指纹」；重新解析后块内容变化时，
 *    旧编辑自动失效，不会把上一版的修正贴到别的段落上。
 *  - 文本覆盖进入块的可读文本（textOverride），阅读、翻译、摘要和 RAG 分块
 *    共用同一份结果；隐藏块则从这些出口中统一排除。
 *  - 持久化由主进程完成（dataDir/parse-edits/<parsePath 指纹>.json），
 *    不依赖 localStorage，也不会写坏 MinerU 解析产物。
 */

export const MINERU_PARSE_EDIT_VERSION = 1;
export const MINERU_PARSE_EDIT_MAX_TEXT_LENGTH = 200_000;

const BLOCK_ID_PATTERN = /^page-[1-9]\d*-block-[1-9]\d*$/;
const HASH_PATTERN = /^[0-9a-f]{8,64}$/;

export interface MineruBlockEdit {
  /** 原始块内容指纹；与当前块不一致时编辑视为过期。 */
  hash: string;
  /** 手动或 AI 重析后确认的 Markdown 文本。 */
  text?: string;
  /** 该块被判定为多余内容，从阅读与索引中隐藏。 */
  deleted?: boolean;
}

export type MineruBlockEdits = Record<string, MineruBlockEdit>;

export interface MineruParseEditFile {
  version: number;
  updatedAt: string;
  blocks: MineruBlockEdits;
}

export interface AppliedMineruBlockEdits {
  blocks: PositionedMineruBlock[];
  /** 命中的编辑条数（文本覆盖或隐藏）。 */
  appliedCount: number;
  /** 因原始内容已变化而失效的编辑 blockId。 */
  staleBlockIds: string[];
  hiddenBlockIds: Set<string>;
  textOverrides: Record<string, string>;
}

function fnv1a64Hex(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * prime) & mask;
  }

  return hash.toString(16).padStart(16, '0');
}

function readRawBlockText(block: MineruBlockBase): string {
  if (!block.textOverride) {
    return extractTextFromMineruBlock(block as PositionedMineruBlock);
  }

  // 指纹必须针对 MinerU 原始内容计算，否则编辑保存后再次打开会把自身当成原始内容。
  return extractTextFromMineruBlock({ ...block, textOverride: undefined } as PositionedMineruBlock);
}

/** 计算原始块的内容指纹；同一块在重新解析后会得到不同指纹。 */
export function computeMineruBlockFingerprint(block: MineruBlockBase): string {
  const tableHtml = block.type === 'table'
    ? extractTableHtmlFromMineruBlock(block as PositionedMineruBlock) ?? ''
    : '';

  return fnv1a64Hex([block.type, readRawBlockText(block).trim(), tableHtml.trim()].join('\u0000'));
}

export function isMineruParseEditBlockId(value: string): boolean {
  return BLOCK_ID_PATTERN.test(value);
}

export function isValidMineruBlockEdit(value: unknown): value is MineruBlockEdit {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const hash = typeof candidate.hash === 'string' ? candidate.hash.trim().toLowerCase() : '';

  if (!HASH_PATTERN.test(hash)) {
    return false;
  }

  if (candidate.deleted !== undefined && typeof candidate.deleted !== 'boolean') {
    return false;
  }

  if (candidate.text !== undefined) {
    if (typeof candidate.text !== 'string' || candidate.text.length > MINERU_PARSE_EDIT_MAX_TEXT_LENGTH) {
      return false;
    }
  }

  return candidate.deleted === true || typeof candidate.text === 'string';
}

/**
 * 校验磁盘/内存中的编辑表：丢弃结构不合法或已过期的条目。
 * 返回值同时用于渲染层加载与后端读取，保证两端口径一致。
 */
export function sanitizeMineruBlockEdits(
  value: unknown,
  maxTextLength = MINERU_PARSE_EDIT_MAX_TEXT_LENGTH,
): { edits: MineruBlockEdits; dropped: string[] } {
  const edits: MineruBlockEdits = {};
  const dropped: string[] = [];

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { edits, dropped };
  }

  for (const [blockId, rawEdit] of Object.entries(value as Record<string, unknown>)) {
    if (!isMineruParseEditBlockId(blockId) || !isValidMineruBlockEdit(rawEdit)) {
      dropped.push(blockId);
      continue;
    }

    const candidate = rawEdit as MineruBlockEdit;
    const text = typeof candidate.text === 'string' ? candidate.text : undefined;

    if (text !== undefined && text.length > maxTextLength) {
      dropped.push(blockId);
      continue;
    }

    const next: MineruBlockEdit = { hash: candidate.hash.trim().toLowerCase() };
    if (text !== undefined) next.text = text;
    if (candidate.deleted === true) next.deleted = true;
    edits[blockId] = next;
  }

  return { edits, dropped };
}

/** 计算当前块集合下仍然有效的编辑（指纹一致）。 */
export function resolveMineruBlockEdits(
  blocks: readonly PositionedMineruBlock[],
  edits: MineruBlockEdits,
): { edits: MineruBlockEdits; staleBlockIds: string[] } {
  const hashes = new Map<string, string>();

  for (const block of blocks) {
    hashes.set(block.blockId, computeMineruBlockFingerprint(block));
  }

  const valid: MineruBlockEdits = {};
  const staleBlockIds: string[] = [];

  for (const [blockId, edit] of Object.entries(edits)) {
    const currentHash = hashes.get(blockId);

    if (!currentHash || currentHash !== edit.hash) {
      staleBlockIds.push(blockId);
      continue;
    }

    valid[blockId] = edit;
  }

  return { edits: valid, staleBlockIds };
}

/**
 * 把编辑应用到块列表：
 *  - deleted 块被移除；
 *  - text 写入 `textOverride`，后续 extractText / markdown / 翻译 / RAG 都读取它。
 */
export function applyMineruBlockEdits(
  blocks: readonly PositionedMineruBlock[],
  edits: MineruBlockEdits,
): AppliedMineruBlockEdits {
  const output: PositionedMineruBlock[] = [];
  const hiddenBlockIds = new Set<string>();
  const textOverrides: Record<string, string> = {};
  const staleBlockIds: string[] = [];
  let appliedCount = 0;

  for (const block of blocks) {
    const edit = edits[block.blockId];

    if (!edit) {
      output.push(block);
      continue;
    }

    if (computeMineruBlockFingerprint(block) !== edit.hash) {
      staleBlockIds.push(block.blockId);
      output.push(block);
      continue;
    }

    appliedCount += 1;

    if (edit.deleted) {
      hiddenBlockIds.add(block.blockId);
      continue;
    }

    if (typeof edit.text === 'string' && edit.text.trim()) {
      textOverrides[block.blockId] = edit.text;
      output.push({ ...block, textOverride: edit.text });
      continue;
    }

    output.push(block);
  }

  return {
    blocks: output,
    appliedCount,
    staleBlockIds,
    hiddenBlockIds,
    textOverrides,
  };
}

/** 目录索引跟随编辑结果：隐藏块不出现在目录里，标题文本使用编辑后的值。 */
export function applyMineruOutlineEdits(
  items: readonly MineruOutlineIndexItem[],
  edits: MineruBlockEdits,
): MineruOutlineIndexItem[] {
  return items.flatMap((item) => {
    const edit = edits[item.blockId];

    if (!edit) {
      return [item];
    }

    if (edit.deleted) {
      return [];
    }

    const title = edit.text?.trim();

    return [title ? { ...item, title } : item];
  });
}
