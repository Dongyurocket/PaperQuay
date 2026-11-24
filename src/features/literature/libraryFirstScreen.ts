import type {
  LibrarySnapshot,
  ListPapersRequest,
  QueryPapersResult,
} from '../../types/library';

export const LIBRARY_FIRST_SCREEN_PAGE_SIZE = 500;

/**
 * 首屏数据编排：init 只取设置/分类，文献列表单独走分页查询。
 * 独立成纯函数以便测试「首屏不请求全库」而不启动 React。
 */
export async function loadLibraryFirstScreen(options: {
  initialize: () => Promise<LibrarySnapshot>;
  query: (request: ListPapersRequest) => Promise<QueryPapersResult>;
  buildRequest: (categoryId: string | null) => ListPapersRequest;
  pageSize?: number;
}): Promise<{
  snapshot: LibrarySnapshot;
  categoryId: string | null;
  page: QueryPapersResult;
}> {
  const snapshot = await options.initialize();
  const allCategory = snapshot.categories.find((category) => category.systemKey === 'all');
  const categoryId = allCategory?.id ?? snapshot.categories[0]?.id ?? null;
  const page = await options.query({
    ...options.buildRequest(categoryId),
    limit: options.pageSize ?? LIBRARY_FIRST_SCREEN_PAGE_SIZE,
    offset: 0,
  });
  return { snapshot, categoryId, page };
}
