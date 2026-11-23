import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * S1：工作区懒加载的冷启动断言。
 *
 * 首屏只应加载 index.html 里 script + modulepreload 指向的 chunk，以及它们
 * 静态 import 的 chunk（静态闭包）。Tiptap/ProseMirror/lowlight（笔记编辑器）与
 * cytoscape/fcose（知识图谱）必须只出现在动态 import 里。
 *
 * dist/ 不存在时跳过：本机未构建不该算失败，CI 的 build.yml 会先跑 npm run build。
 */

const DIST = path.resolve('dist');

function readAsset(name) {
  return fs.readFileSync(path.join(DIST, 'assets', name), 'utf8');
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
const MARKERS = [
  { label: 'prosemirror', pattern: /prosemirror|ProseMirror/ },
  { label: 'lowlight', pattern: /highlightAuto|lowlight/ },
  { label: 'cytoscape', pattern: /nodeRepulsion|cytoscape|fcose/ },
];

test('cold start does not load the notes editor or graph engine chunks', { skip: !fs.existsSync(path.join(DIST, 'index.html')) }, () => {
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

test('lazy workspaces are reachable through dynamic imports only', { skip: !fs.existsSync(path.join(DIST, 'index.html')) }, () => {
  const { seen } = initialChunkClosure();
  const allChunks = fs.readdirSync(path.join(DIST, 'assets')).filter((name) => name.endsWith('.js'));
  const lazyChunks = allChunks.filter((name) => /^(NotesWorkspace|KnowledgeGraphWorkspace|NotesSidebar)-/.test(name));

  assert.ok(lazyChunks.length >= 2, `expected lazy workspace chunks, found: ${lazyChunks.join(', ')}`);
  for (const name of lazyChunks) {
    assert.equal(seen.has(name), false, `${name} must not be part of the initial static import closure`);
  }
});
