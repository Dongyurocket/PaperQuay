import { parseMineruPages } from '../../services/mineru.ts';
import { MINERU_PARSE_PAGE_BATCH, sliceMineruPages } from './mineruSegments.ts';

interface ParseRequest {
  id: number;
  jsonText: string;
}

self.onmessage = (event: MessageEvent<ParseRequest>) => {
  const { id, jsonText } = event.data;

  try {
    const pages = parseMineruPages(jsonText);
    for (let start = 0; start < pages.length; start += MINERU_PARSE_PAGE_BATCH) {
      self.postMessage({
        id,
        ok: true,
        done: false,
        pages: sliceMineruPages(pages, start, MINERU_PARSE_PAGE_BATCH),
      });
    }
    self.postMessage({ id, ok: true, done: true, pages: [] });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      done: true,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
