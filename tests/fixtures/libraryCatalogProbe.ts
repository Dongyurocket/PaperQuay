import { createElement, useEffect } from 'react';
import { useLibraryCatalog } from '../../src/features/literature/hooks/useLibraryCatalog';

export type LibraryCatalogProbeHandle = ReturnType<typeof useLibraryCatalog>;

export interface LibraryCatalogProbeProps {
  onCatalog?: (catalog: LibraryCatalogProbeHandle) => void;
}

/** 稳定的 l：避免探针每次渲染都让防抖 effect 重跑（真实应用里由语言上下文缓存）。 */
const l = (_zh: string, en: string) => en;

/**
 * 行为测试探针：在 jsdom 中真实挂载 useLibraryCatalog。
 * 每次提交后把最新的 hook 结果交回用例，供测试驱动分类点击/筛选变化。
 */
export function LibraryCatalogProbe({ onCatalog }: LibraryCatalogProbeProps) {
  const catalog = useLibraryCatalog({
    demoLibrary: null,
    mineruCacheDir: '',
    autoLoadSiblingJson: false,
    l,
  });

  useEffect(() => {
    onCatalog?.(catalog);
  });

  return createElement(
    'div',
    { 'data-testid': 'library-catalog-probe' },
    `${catalog.loading ? 'loading' : 'ready'}|${catalog.selectedCategoryId ?? 'none'}|${catalog.papers.length}|${catalog.error}`,
  );
}
