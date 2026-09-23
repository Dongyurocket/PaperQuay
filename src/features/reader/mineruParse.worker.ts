import { parseMineruPages } from '../../services/mineru.ts';
import { MINERU_PARSE_PAGE_BATCH, splitMineruPagesIntoParts } from './mineruSegments.ts';

interface ParseRequest {
  id: number;
  jsonText: string;
  sourcePath?: string;
}

self.onmessage = (event: MessageEvent<ParseRequest>) => {
  const { id, jsonText, sourcePath } = event.data;

  try {
    const pages = parseMineruPages(jsonText);
    const parts = splitMineruPagesIntoParts(pages, MINERU_PARSE_PAGE_BATCH, sourcePath);

    // 首先推送文档元数据与轻量章节索引，主线程无需等待全部正文到达即可直接展示目录
    const hasSegments = parts.segments.length > 0 && parts.metadata.pageCount > 0;
    self.postMessage({
      id,
      ok: true,
      done: !hasSegments,
      metadata: parts.metadata,
      outlineIndex: parts.outlineIndex,
      totalSegments: hasSegments ? parts.segments.length : 0,
      segmentIndex: -1,
      pages: [],
    });

    if (hasSegments) {
      for (let i = 0; i < parts.segments.length; i++) {
        const seg = parts.segments[i];
        const isLast = i === parts.segments.length - 1;
        self.postMessage({
          id,
          ok: true,
          done: isLast,
          segmentIndex: i,
          totalSegments: parts.segments.length,
          pages: seg.pages,
        });
      }
    }
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      done: true,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
