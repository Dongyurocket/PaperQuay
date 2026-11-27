import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  createBlockReparseStorageKey,
  loadBlockReparseOverrides,
  type BlockReparseOverrideApi,
  type BlockReparseOverrides,
} from '../../services/blockReparseOverrides';
import { readMineruParseEdits, writeMineruParseEdits } from '../../services/desktop';
import {
  applyMineruBlockEdits,
  computeMineruBlockFingerprint,
  resolveMineruBlockEdits,
  sanitizeMineruBlockEdits,
  type MineruBlockEdits,
} from '../../services/parseEdits';
import type { PdfSource, PositionedMineruBlock } from '../../types/reader';
import { getPdfSourceSignature } from '../pdf/pdfDocumentSource';

interface UseBlockReparseOverridesOptions {
  blocks: PositionedMineruBlock[];
  mineruPath: string;
  /** 解析结果所属的稳定路径（目录或 JSON 路径），用于定位持久化编辑文件。 */
  parsePath: string;
  pdfSource?: PdfSource | null;
}

interface BlockReparseOverrideState {
  scope: object;
  ready: boolean;
  edits: MineruBlockEdits;
  staleCount: number;
  error: string;
}

const EMPTY_EDITS: MineruBlockEdits = {};
const EMPTY_BLOCKS: PositionedMineruBlock[] = [];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readEditsSnapshot(ref: { current: MineruBlockEdits }): MineruBlockEdits {
  return ref.current;
}

/**
 * 解析结果编辑的唯一数据源。
 *
 * 早期版本把 AI 修复保存在 localStorage，并且只影响阅读视图。现在统一为
 * 「解析编辑」：
 *  - 文本修正与整块隐藏都持久化到应用数据目录（按解析路径归档）；
 *  - 每条编辑携带原始块指纹，重新解析后内容变化时自动失效；
 *  - 编辑结果同时供 BlockViewer、翻译、摘要与 RAG 分块使用。
 *
 * 旧 localStorage 修复会在首次加载时自动迁移到新的编辑文件。
 */
export function useBlockReparseOverrides({
  blocks,
  mineruPath,
  parsePath,
  pdfSource,
}: UseBlockReparseOverridesOptions): BlockReparseOverrideApi {
  const documentSource = getPdfSourceSignature(pdfSource ?? null, mineruPath);
  const scope = useMemo(
    () => ({ parsePath, mineruPath, blocks }),
    [blocks, mineruPath, parsePath],
  );
  const [state, setState] = useState<BlockReparseOverrideState>({
    scope,
    ready: false,
    edits: {},
    staleCount: 0,
    error: '',
  });
  const editsRef = useRef<MineruBlockEdits>({});
  const storageReady = state.scope === scope && state.ready && Boolean(parsePath.trim());

  useEffect(() => {
    let disposed = false;

    // 解析版本切换后先清掉同步读取值，避免异步加载期间把上一份编辑带进新文档。
    editsRef.current = {};

    if (!parsePath.trim() || blocks.length === 0) {
      setState({
        scope,
        ready: false,
        edits: {},
        staleCount: 0,
        error: parsePath.trim() ? '' : '当前解析结果没有可用的编辑存储位置。',
      });
      return undefined;
    }

    void (async () => {
      let loadedEdits: MineruBlockEdits = {};
      let loadError = '';

      try {
        const file = await readMineruParseEdits(parsePath);
        loadedEdits = sanitizeMineruBlockEdits(file.blocks).edits;
      } catch (error) {
        loadError = errorMessage(error);
      }

      let { edits: validEdits, staleBlockIds } = resolveMineruBlockEdits(blocks, loadedEdits);

      // 一次性迁移：旧版 localStorage 修复按当前 blocks 的哈希键绑定，
      // 迁移后写回同一份编辑文件，之后不再读写 localStorage。
      try {
        const legacyKey = await createBlockReparseStorageKey(documentSource, mineruPath, blocks);
        const legacyOverrides = loadBlockReparseOverrides(window.localStorage, legacyKey);
        const blockById = new Map(blocks.map((block) => [block.blockId, block]));

        if (Object.keys(legacyOverrides).length > 0) {
          const migrated: MineruBlockEdits = { ...validEdits };
          let changed = false;

          for (const [blockId, text] of Object.entries(legacyOverrides)) {
            const block = blockById.get(blockId);

            if (!block || migrated[blockId]) {
              continue;
            }

            migrated[blockId] = {
              hash: computeMineruBlockFingerprint(block),
              text,
            };
            changed = true;
          }

          if (changed) {
            await writeMineruParseEdits(parsePath, migrated);
            validEdits = migrated;
            staleBlockIds = staleBlockIds.filter((blockId) => !migrated[blockId]);
            window.localStorage.removeItem(legacyKey);
          }
        }
      } catch {
        // 迁移失败不影响阅读：已加载的磁盘编辑仍然生效，旧 localStorage 保留待下次重试。
      }

      if (disposed) {
        return;
      }

      editsRef.current = validEdits;
      setState({
        scope,
        ready: true,
        edits: validEdits,
        staleCount: staleBlockIds.length,
        error: loadError,
      });
    })();

    return () => {
      disposed = true;
    };
  }, [blocks, documentSource, mineruPath, parsePath, scope]);

  const persistEdits = useCallback(
    async (nextEdits: MineruBlockEdits): Promise<void> => {
      if (!storageReady) {
        throw new Error('解析版本已变化或存储尚未就绪，请重新打开此文献。');
      }

      // 先落盘再更新内存：写入失败不能被界面当成已保存。
      await writeMineruParseEdits(parsePath, nextEdits);
      editsRef.current = nextEdits;
      setState((previous) =>
        previous.scope === scope
          ? { ...previous, edits: nextEdits, staleCount: 0, error: '' }
          : previous,
      );
    },
    [parsePath, scope, storageReady],
  );

  const blockById = useMemo(
    () => new Map(blocks.map((block) => [block.blockId, block])),
    [blocks],
  );

  const getOverrideMarkdown = useCallback(
    (blockId: string): string | undefined => {
      const edit = editsRef.current[blockId];

      return edit && !edit.deleted && typeof edit.text === 'string' ? edit.text : undefined;
    },
    [],
  );

  const saveOverride = useCallback(
    async (blockId: string, markdown: string): Promise<void> => {
      const block = blockById.get(blockId);
      const text = markdown.trim();

      if (!block) {
        throw new Error('找不到对应的解析块，编辑未保存。');
      }
      if (!text) {
        throw new Error('编辑内容不能为空；如需移除该块，请使用「删除此块」。');
      }

      const current = readEditsSnapshot(editsRef);
      const next: MineruBlockEdits = {
        ...current,
        [blockId]: { hash: computeMineruBlockFingerprint(block), text },
      };

      await persistEdits(next);
    },
    [blockById, persistEdits],
  );

  const deleteBlock = useCallback(
    async (blockId: string): Promise<void> => {
      const block = blockById.get(blockId);

      if (!block) {
        throw new Error('找不到对应的解析块，删除未保存。');
      }

      const current = readEditsSnapshot(editsRef);
      const next: MineruBlockEdits = {
        ...current,
        [blockId]: { hash: computeMineruBlockFingerprint(block), deleted: true },
      };

      await persistEdits(next);
    },
    [blockById, persistEdits],
  );

  const restoreBlock = useCallback(
    async (blockId: string): Promise<void> => {
      const current = readEditsSnapshot(editsRef);
      const next: MineruBlockEdits = { ...current };
      delete next[blockId];

      await persistEdits(next);
    },
    [persistEdits],
  );

  const restoreAll = useCallback(async (): Promise<void> => {
    await persistEdits({});
  }, [persistEdits]);

  const edits = useMemo(
    () => (state.scope === scope ? state.edits : EMPTY_EDITS),
    [scope, state.edits, state.scope],
  );
  const overrides = useMemo<BlockReparseOverrides>(() => {
    const result: BlockReparseOverrides = {};

    for (const [blockId, edit] of Object.entries(edits)) {
      if (!edit.deleted && typeof edit.text === 'string' && edit.text.trim()) {
        result[blockId] = edit.text;
      }
    }

    return result;
  }, [edits]);

  const hiddenBlockIds = useMemo(() => {
    const result = new Set<string>();

    for (const [blockId, edit] of Object.entries(edits)) {
      if (edit.deleted) {
        result.add(blockId);
      }
    }

    return result;
  }, [edits]);
  const effectiveBlocks = useMemo(
    () => applyMineruBlockEdits(blocks.length ? blocks : EMPTY_BLOCKS, edits).blocks,
    [blocks, edits],
  );
  const editCount = Object.keys(edits).length;
  const staleCount = state.scope === scope ? state.staleCount : 0;
  const storageError = state.scope === scope ? state.error : '';

  // 保持引用稳定，避免把新的对象每次渲染都传给被 memo 的 BlockViewer。
  return useMemo(
    () => ({
      overrides,
      hiddenBlockIds,
      edits,
      editCount,
      staleCount,
      effectiveBlocks,
      storageReady,
      storageError,
      getOverrideMarkdown,
      saveOverride,
      deleteBlock,
      restoreBlock,
      restoreAll,
    }),
    [
      deleteBlock,
      editCount,
      edits,
      effectiveBlocks,
      getOverrideMarkdown,
      hiddenBlockIds,
      overrides,
      restoreAll,
      restoreBlock,
      saveOverride,
      staleCount,
      storageError,
      storageReady,
    ],
  );
}
