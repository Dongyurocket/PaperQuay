import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildMineruCachePathCandidates,
  buildMineruCachePaths,
  buildTitleMineruCachePaths,
} = require('../src/shared/mineruCachePaths.cjs');
const { locateMineruFigureBlock } = require('../electron/mcp/knowledgeMcpService.cjs');

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value), 'utf8');
}

test('MCP reads the cache directory the reader actually writes for native-library papers', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'paperquay-mineru-sharing-'));

  try {
    const item = {
      workspaceId: 'native-library:paper-1',
      itemKey: 'paper-1',
      title: 'A Shared Cache Paper',
    };
    const cachePaths = buildMineruCachePaths(root, item);
    writeJson(cachePaths.contentJsonPath, [
      { type: 'text', text: 'intro', page_idx: 0 },
      { type: 'image', img_path: 'images/p1.png', image_caption: ['Figure 1'], page_idx: 0 },
    ]);

    const located = locateMineruFigureBlock({
      cacheRoot: root,
      paperId: 'paper-1',
      paperTitle: item.title,
      blockId: 'page-1-block-2',
      pageIndex: null,
    });

    assert.ok(located.located, 'the reader cache directory must be found');
    assert.equal(located.cacheDir, cachePaths.directory);
    assert.equal(located.located.block.type, 'image');
    assert.equal(located.located.blockIndex, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('MCP also resolves title-based cache directories and middle.json', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'paperquay-mineru-middle-'));

  try {
    const item = {
      workspaceId: 'native-library:paper-2',
      itemKey: 'paper-2',
      title: 'Middle Json Paper',
    };
    const cachePaths = buildTitleMineruCachePaths(root, item);
    writeJson(cachePaths.middleJsonPath, {
      pdf_info: [
        { page_idx: 0, para_blocks: [{ type: 'text', text: 'page 1' }] },
        {
          page_idx: 1,
          para_blocks: [
            { type: 'text', text: 'page 2 text' },
            { type: 'table', img_path: 'images/table.png' },
          ],
        },
      ],
    });

    const located = locateMineruFigureBlock({
      cacheRoot: root,
      paperId: 'paper-2',
      paperTitle: item.title,
      blockId: 'page-2-block-2',
      pageIndex: null,
    });

    assert.ok(located.located);
    assert.equal(located.cacheDir, cachePaths.directory);
    assert.equal(located.located.block.type, 'table');

    const byPage = locateMineruFigureBlock({
      cacheRoot: root,
      paperId: 'paper-2',
      paperTitle: item.title,
      blockId: '',
      pageIndex: 1,
    });
    assert.ok(byPage.located, 'pageIndex fallback locates the first image/table block');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('all candidate directories are produced by the shared reader builder', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'paperquay-mineru-candidates-'));
  try {
    const item = { workspaceId: 'native-library:paper-3', itemKey: 'paper-3', title: 'Title' };
    const candidates = buildMineruCachePathCandidates(root, item);
    assert.equal(candidates.length, 3);
    assert.equal(new Set(candidates.map((entry) => entry.directory)).size, 3);
    assert.equal(
      candidates[0].directory,
      buildMineruCachePaths(root, item).directory,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
