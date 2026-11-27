import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  createBlockReparseStorageKey,
  loadBlockReparseOverrides,
  saveBlockReparseOverride,
  type BlockReparseOverrideApi,
  type BlockReparseOverrides,
} from '../../services/blockReparseOverrides';
import type { PdfSource, PositionedMineruBlock } from '../../types/reader';
import { getPdfSourceSignature } from '../pdf/pdfDocumentSource';

interface UseBlockReparseOverridesOptions {
  blocks: PositionedMineruBlock[];
  mineruPath: string;
  pdfSource?: PdfSource | null;
}

interface BlockReparseOverrideState {
  scope: object;
  key: string;
  overrides: BlockReparseOverrides;
  error: string;
}

const EMPTY_OVERRIDES: BlockReparseOverrides = {};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * AI 重解析覆盖的唯一数据源。
 *
 * 覆盖值仍然只影响本地阅读视图，但 BlockViewer 与翻译流程共享同一份状态：
 * BlockViewer 显示修复文本，翻译按同一份修复文本重译，并按块级源文本指纹
 * 判断已有译文是否过期。覆盖键绑定文献来源、解析路径与完整原始 blocks，
 * 解析内容变化时不会把旧修复套到新版本上。
 */
export function useBlockReparseOverrides({
  blocks,
  mineruPath,
  pdfSource,
}: UseBlockReparseOverridesOptions): BlockReparseOverrideApi {
  const documentSource = getPdfSourceSignature(pdfSource ?? null, mineruPath);
  const scope = useMemo(
    () => ({ documentSource, mineruPath, blocks }),
    [blocks, documentSource, mineruPath],
  );
  const [state, setState] = useState<BlockReparseOverrideState>({
    scope,
    key: '',
    overrides: {},
    error: '',
  });
  const overridesRef = useRef<BlockReparseOverrides>({});
  const storageReady = state.scope === scope && Boolean(state.key);

  useEffect(() => {
    let disposed = false;

    // 解析版本切换后先清掉同步读取值，避免异步算键期间把上一份修复带进新文档。
    overridesRef.current = {};

    void createBlockReparseStorageKey(documentSource, mineruPath, blocks)
      .then((key) => {
        if (disposed) {
          return;
        }

        try {
          const overrides = loadBlockReparseOverrides(window.localStorage, key);
          overridesRef.current = overrides;
          setState({ scope, key, overrides, error: '' });
        } catch (error) {
          overridesRef.current = {};
          setState({ scope, key: '', overrides: {}, error: errorMessage(error) });
        }
      })
      .catch((error) => {
        if (disposed) {
          return;
        }

        overridesRef.current = {};
        setState({ scope, key: '', overrides: {}, error: errorMessage(error) });
      });

    return () => {
      disposed = true;
    };
  }, [blocks, documentSource, mineruPath, scope]);

  const getOverrideMarkdown = useCallback(
    (blockId: string): string | undefined => {
      if (!storageReady) {
        return undefined;
      }

      return overridesRef.current[blockId];
    },
    [storageReady],
  );

  const saveOverride = useCallback(
    (blockId: string, markdown: string | null): void => {
      if (!storageReady) {
        throw new Error('解析版本已变化或存储尚未就绪，请重新打开此区块。');
      }

      const next = saveBlockReparseOverride(window.localStorage, state.key, blockId, markdown);
      overridesRef.current = next;
      setState((previous) =>
        previous.scope === scope
          ? { ...previous, overrides: next, error: '' }
          : previous,
      );
    },
    [scope, state.key, storageReady],
  );

  const overrides = storageReady ? state.overrides : EMPTY_OVERRIDES;
  const storageError = state.scope === scope ? state.error : '';

  // 保持引用稳定，避免把新的对象每次渲染都传给被 memo 的 BlockViewer。
  return useMemo(
    () => ({
      overrides,
      storageReady,
      storageError,
      getOverrideMarkdown,
      saveOverride,
    }),
    [getOverrideMarkdown, overrides, saveOverride, storageError, storageReady],
  );
}
