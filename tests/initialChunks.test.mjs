import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * S1：工作区懒加载的冷启动断言。
 *
 * 首屏只应加载 index.html 里 script + modulepreload 指向的 chunk，以及它们
 * 静态 import 的 chunk（静态闭包）。Tiptap/ProseMirror/lowlight（笔记编辑器）与
 * cytoscape/fcose（知识图谱）必须落在首屏闭包之外：编辑器/工作区靠动态 import
 * 懒加载，fcose 还会被打进 graphLayout.worker 的 Worker bundle（new Worker），
 * 两条路径都不属于首屏静态闭包。
 *
 * dist/ 不存在时跳过：本机未构建不该算失败，CI 的 build.yml 会先跑 npm run build。
 */

const DIST = path.resolve('dist');
const DIST_READY = fs.existsSync(path.join(DIST, 'index.html'));
const SKIP = !DIST_READY;

function readAsset(name) {
  return fs.readFileSync(path.join(DIST, 'assets', name), 'utf8');
}

function listJsChunks() {
  return fs.readdirSync(path.join(DIST, 'assets')).filter((name) => name.endsWith('.js'));
}

function initialChunkClosure() {
  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  const entryChunks = [...html.matchAll(/assets\/([^"]+\.js)/g)].map((match) => match[1]);
  const seen = new Set();
  const queue = [...entryChunks];

  while (queue.length > 0) {
    const name = queue.shift();
    if (!name || seen.has(name)) continue;
    seen.add(name);

    const source = readAsset(name);
    for (const match of source.matchAll(/from"\.\/([^"]+\.js)"/g)) {
      const dependency = match[1];
      if (!seen.has(dependency)) queue.push(dependency);
    }
  }

  return { seen, entryChunks };
}

// 只匹配编辑器/图谱引擎自身的运行时标识。注意不能匹配裸 `Tiptap`：
// 首屏的共享解析器（src/shared/markdownToTiptap.cjs）函数名里就带 Tiptap，
// 它是纯 JSON 转换、不加载编辑器运行时。
//
// 图谱引擎用运行时标识而不是 chunk 文件名里的 "cytoscape"/"fcose"：
// __vite__mapDeps 会把懒加载 chunk 的路径写成字符串，按文件名匹配会把
// 「预加载映射」误判成「已经加载」。
const MARKERS = [
  { label: 'prosemirror', pattern: /prosemirror|ProseMirror/ },
  { label: 'lowlight', pattern: /highlightAuto|lowlight/ },
  { label: 'graph engines', pattern: /nodeRepulsion|nestingFactor|gravityRangeCompound/ },
];

// fcose 运行时专属标记：
// - gravityRangeCompound 只出现在 cytoscape-fcose 的实现里；
// - LayoutConstants 来自 layout-base（fcose/cose-base 共用的布局基础包），
//   即使打包器把 cose-base/layout-base 单独分进 vendor-graph，也会命中。
// 两者都不出现在 cytoscape 本体（已对照本机 dist 的 vendor-graph 验证）。
// 不能用 nestingFactor：cytoscape 内置的 cose 布局（在 vendor-graph
// 里，属于 cytoscape 本体）同样有该选项；nodeRepulsion 在本项目的
// graphLayoutMessages.ts 里也有同名字符串，同样不能单独使用。
const FCOSE_RUNTIME = /gravityRangeCompound|LayoutConstants/;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('cold start does not load the notes editor or graph engine chunks', { skip: SKIP }, () => {
  const { seen, entryChunks } = initialChunkClosure();

  assert.ok(entryChunks.length > 0, 'dist/index.html must reference at least one entry chunk');

  const offenders = [];
  for (const name of seen) {
    const source = readAsset(name);
    for (const marker of MARKERS) {
      if (marker.pattern.test(source)) offenders.push(`${name} contains ${marker.label}`);
    }
  }

  assert.deepEqual(offenders, [], `initial chunks must stay free of lazy workspace dependencies:\n${offenders.join('\n')}`);
});

test('the initial closure excludes the graph workspace and the fcose runtime', { skip: SKIP }, () => {
  const { seen } = initialChunkClosure();
  const graphChunks = [...seen].filter((name) => /^(KnowledgeGraphWorkspace|vendor-graph)-/.test(name));
  assert.deepEqual(
    graphChunks,
    [],
    `graph workspace chunks must stay out of the initial closure:\n${graphChunks.join('\n')}`,
  );

  const fcoseChunks = [...seen].filter((name) => FCOSE_RUNTIME.test(readAsset(name)));
  assert.deepEqual(
    fcoseChunks,
    [],
    `initial chunks must not bundle the fcose runtime:\n${fcoseChunks.join('\n')}`,
  );
});

test('lazy workspaces are reachable through dynamic imports only', { skip: SKIP }, () => {
  const { seen } = initialChunkClosure();
  const allChunks = listJsChunks();
  const lazyChunks = allChunks.filter((name) => /^(NotesWorkspace|KnowledgeGraphWorkspace|NotesSidebar)-/.test(name));

  assert.ok(lazyChunks.length >= 2, `expected lazy workspace chunks, found: ${lazyChunks.join(', ')}`);
  for (const name of lazyChunks) {
    assert.equal(seen.has(name), false, `${name} must not be part of the initial static import closure`);
  }
});

/**
 * 构建守卫：fcose 体积约 500KB，不能进入首屏闭包。它由两条路径加载：
 * 1. graphLayoutFallback 里的动态 import（主线程回退布局）；
 * 2. graphLayout.worker 的 Worker bundle（new Worker(new URL(...))）。
 * worker chunk 不在首屏静态闭包，但也不能被误写进初始入口；这里因此分两类检查：
 * - vendor-graph 只装 cytoscape；
 * - 含 fcose 的 chunk（含 worker bundle）全部在初始闭包之外；
 * - KnowledgeGraphWorkspace chunk 对 fcose chunk 只能动态 import，不能静态 from。
 *
 * chunk 名带 hash，所以先按内容找到 fcose chunk，再检查工作区 chunk 对它的引用。
 * rolldown 产物的动态 import 是 import(`./chunk.js`)（反引号），静态 import 是
 * from"./chunk.js"；这里两种引号都接受，避免压缩器细节变化让断言失准。
 */
test('fcose is a lazy chunk the graph workspace reaches through a dynamic import', { skip: SKIP }, () => {
  const { seen } = initialChunkClosure();
  const allChunks = listJsChunks();

  const vendorGraphChunks = allChunks.filter((name) => /^vendor-graph-/.test(name));
  // vendor-graph 是 cytoscape 专用的静态 vendor 组；即使 rolldown 把它并进
  // 工作区 chunk，工作区 chunk 本身也不能含 fcose（下面统一检查）。
  for (const name of vendorGraphChunks) {
    assert.equal(
      FCOSE_RUNTIME.test(readAsset(name)),
      false,
      `${name} must only carry cytoscape; fcose belongs to a lazy chunk`,
    );
  }

  const workspaceChunk = allChunks.find((name) => /^KnowledgeGraphWorkspace-/.test(name));
  assert.ok(workspaceChunk, 'expected a KnowledgeGraphWorkspace chunk');
  const workspaceSource = readAsset(workspaceChunk);
  assert.equal(
    FCOSE_RUNTIME.test(workspaceSource),
    false,
    'the graph workspace chunk must not bundle the fcose runtime',
  );

  const fcoseChunks = allChunks.filter((name) => FCOSE_RUNTIME.test(readAsset(name)));
  assert.ok(fcoseChunks.length > 0, 'expected at least one chunk containing the fcose runtime');
  for (const name of fcoseChunks) {
    assert.equal(seen.has(name), false, `${name} contains fcose and must not be part of the initial closure`);
  }

  const dynamicallyLoaded = fcoseChunks.filter((name) => {
    const escaped = escapeRegExp(name);
    return new RegExp(`import\\(\\s*[\`"']\\./${escaped}[\`"']\\s*\\)`).test(workspaceSource);
  });
  assert.ok(
    dynamicallyLoaded.length > 0,
    `the graph workspace must load the fcose chunk through import(); fcose chunks: ${fcoseChunks.join(', ')}`,
  );

  for (const name of dynamicallyLoaded) {
    const staticImport = new RegExp(`from\\s*["']\\./${escapeRegExp(name)}["']`);
    assert.equal(
      staticImport.test(workspaceSource),
      false,
      `${workspaceChunk} must not statically import fcose chunk ${name}`,
    );
  }
});
