import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);

/**
 * A4 的原始症状在渲染层：阅读器用 1000 条截断列表覆盖全库快照。
 * 这里直接驱动 src/services/library.ts，断言分页 helper 能取回窗口外文献，
 * 并断言单条查询不依赖列表。
 */
const libraryService = await (async () => {
  const bundle = await build({
    entryPoints: ['src/services/library.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    logLevel: 'silent',
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
})();

function makePaper(index) {
  return { id: `paper-${index}`, title: `Paper ${index}`, authors: [], tags: [], categoryIds: [], attachments: [] };
}

/** 模拟后端：1200 篇，query 分页，list 命令保持 1000 条硬上限。 */
function installBridge(total = 1200) {
  const papers = Array.from({ length: total }, (_, index) => makePaper(index));
  const calls = [];
  globalThis.window = {
    paperquay: {
      async invoke(command, args) {
        calls.push({ command, args });

        if (command === 'library_query_papers') {
          const request = args?.request ?? {};
          const limit = Math.min(1000, Number(request.limit) || 300);
          const offset = Number(request.offset) || 0;
          return {
            papers: papers.slice(offset, offset + limit),
            total: papers.length,
            offset,
            limit,
          };
        }

        if (command === 'library_list_papers') {
          return papers.slice(0, 1000);
        }

        if (command === 'library_get_paper') {
          return papers.find((paper) => paper.id === args?.paperId) ?? null;
        }

        throw new Error(`Unexpected command: ${command}`);
      },
    },
  };
  return { papers, calls };
}

test('listAllLibraryPapers pages past the 1000-row clamp and returns every paper', async () => {
  const { calls } = installBridge(1200);

  const papers = await libraryService.listAllLibraryPapers({ sortBy: 'updatedAt', sortDirection: 'desc' });

  assert.equal(papers.length, 1200);
  assert.equal(papers.at(-1).id, 'paper-1199');
  assert.equal(new Set(papers.map((paper) => paper.id)).size, 1200, 'no duplicates across pages');
  const queryCalls = calls.filter((call) => call.command === 'library_query_papers');
  assert.equal(queryCalls.length >= 2, true, 'must page instead of trusting one truncated response');
  assert.equal(queryCalls.every((call) => call.args.request.limit === 1000), true);
});

test('listAllLibraryPapers stops exactly at total and survives a shrinking library', async () => {
  let remaining = 1200;
  const calls = [];
  globalThis.window = {
    paperquay: {
      async invoke(command, args) {
        calls.push({ command, args });
        const request = args?.request ?? {};
        const limit = Number(request.limit) || 300;
        const offset = Number(request.offset) || 0;
        // 第二页时文库变小：不得死循环，也不得重复累加。
        if (offset > 0) remaining = 1100;
        const total = remaining;
        const start = Math.min(offset, total);
        const end = Math.min(start + limit, total);
        return {
          papers: Array.from({ length: end - start }, (_, index) => makePaper(start + index)),
          total,
          offset,
          limit,
        };
      },
    },
  };

  const papers = await libraryService.listAllLibraryPapers();

  assert.equal(papers.length, 1100);
  assert.equal(new Set(papers.map((paper) => paper.id)).size, 1100);
  assert.equal(calls.length < 10, true, 'paging must terminate');
});

test('getLibraryPaper resolves a paper beyond the clamped list', async () => {
  installBridge(1200);

  const paper = await libraryService.getLibraryPaper('paper-1199');

  assert.equal(paper?.id, 'paper-1199');
  assert.equal(await libraryService.getLibraryPaper('paper-missing'), null);
});
