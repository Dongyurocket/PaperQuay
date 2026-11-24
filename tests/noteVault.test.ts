import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, utimesSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const { createNoteStore } = require('../electron/backend/noteStore.cjs');
const { createNoteVault, decodeFrontmatter, encodeFrontmatter, sanitizeFileName, serializeNoteMarkdown } = require('../electron/backend/noteVault.cjs');

function cleanupDir(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error: any) {
    console.warn(`cleanup skipped for ${dir}: ${error?.code ?? error}`);
  }
}

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'paperquay-vault-test-'));
  const vaultDir = path.join(dir, 'vault');
  const noteStore = createNoteStore({
    dataDir: dir,
    notesDatabasePath: path.join(dir, 'paperquay-notes.sqlite'),
  });
  // 最小 library store 替身：只需要 load/save settings。
  const library = { settings: { notesVaultDir: vaultDir }, papers: [] as any[] };
  const store = {
    load: () => library,
    save: async () => undefined,
  };
  const vault = createNoteVault({ noteStore, store } as any);
  return { dir, vaultDir, noteStore, vault, library };
}

test('frontmatter 编解码往返保真', () => {
  const fields = {
    id: 'note_1',
    type: 'standalone',
    tags: ['llm', 'agent'],
    anchors: [{ id: 'a1', pageIndex: 3, blockId: 'page-4-block-1' }],
    updatedAt: 1730000000000,
    folder: null,
  };
  const encoded = encodeFrontmatter(fields);
  const { fields: decoded, body } = decodeFrontmatter(`${encoded}\n\n正文内容\n`);
  assert.deepEqual(decoded.tags, ['llm', 'agent']);
  assert.deepEqual(decoded.anchors, fields.anchors);
  assert.equal(decoded.updatedAt, 1730000000000);
  assert.equal(decoded.folder, null);
  assert.equal(body.trim(), '正文内容');
});

test('同步导出笔记到 vault，frontmatter 带 id/anchors，目录跟随文件夹', async () => {
  const { dir, vaultDir, noteStore, vault } = setup();
  try {
    const folder = noteStore.createFolder({ name: '论文笔记' });
    const note = noteStore.createNote({
      paperId: 'global-notes',
      type: 'standalone',
      title: 'KV Cache',
      content: '键值缓存要点',
      tags: ['llm'],
      folderId: folder.id,
      anchors: [{ id: 'a1', paperId: 'p1', label: 'P3', excerpt: '原文', source: 'pdf', createdAt: 1 }],
    });

    const stats = await vault.syncNow();
    assert.equal(stats.exported, 1);
    assert.equal(stats.total, 1);

    const filePath = path.join(vaultDir, '论文笔记', 'KV Cache.md');
    assert.ok(existsSync(filePath), `expected ${filePath} to exist`);
    const { fields, body } = decodeFrontmatter(readFileSync(filePath, 'utf8'));
    assert.equal(fields.id, note.id);
    assert.equal(fields.folder, '论文笔记');
    assert.deepEqual(fields.tags, ['llm']);
    assert.deepEqual(fields.anchors, note.anchors);
    assert.ok(body.includes('键值缓存要点'));

    // 幂等：第二次同步没有变化
    const stats2 = await vault.syncNow();
    assert.equal(stats2.exported, 0);
    assert.equal(stats2.imported, 0);
  } finally {
    noteStore.close();
    cleanupDir(dir);
  }
});

test('vault 侧编辑（mtime 更新）会导回 DB，且锚点不被覆盖', async () => {
  const { dir, vaultDir, noteStore, vault } = setup();
  try {
    const note = noteStore.createNote({
      paperId: 'global-notes',
      type: 'standalone',
      title: '概念页',
      content: '旧内容',
      anchors: [{ id: 'a1', paperId: 'p1', label: 'P3', excerpt: '原文', source: 'pdf', createdAt: 1 }],
    });
    await vault.syncNow();

    const filePath = path.join(vaultDir, '概念页.md');
    const original = readFileSync(filePath, 'utf8');
    writeFileSync(filePath, original.replace('旧内容', '在 Obsidian 里改的新内容'));
    // 文件系统精度：强制把 mtime 推到未来，模拟外部编辑晚于 DB 更新。
    const future = new Date(Date.now() + 60_000);
    utimesSync(filePath, future, future);

    const stats = await vault.syncNow();
    assert.equal(stats.updated, 1);

    const reloaded = noteStore.getNote({ id: note.id });
    assert.ok(reloaded.contentText.includes('在 Obsidian 里改的新内容'));
    // 锚点保真：导入不解析不改写 anchors
    assert.deepEqual(reloaded.anchors, note.anchors);
  } finally {
    noteStore.close();
    cleanupDir(dir);
  }
});

test('vault 里无 id 的新文件导入为新笔记，目录结构映射为文件夹', async () => {
  const { dir, vaultDir, noteStore, vault } = setup();
  try {
    await vault.syncNow(); // 建 vault 目录
    const nested = path.join(vaultDir, '研究', 'LLM');
    rmSync(nested, { recursive: true, force: true });
    require('node:fs').mkdirSync(nested, { recursive: true });
    writeFileSync(path.join(nested, '外部新笔记.md'), '#tag1\n\n外部写的内容\n');

    const stats = await vault.syncNow();
    assert.equal(stats.created, 1);

    const notes = noteStore.listNotes({});
    assert.equal(notes.length, 1);
    assert.equal(notes[0].title, '外部新笔记');
    assert.ok(notes[0].contentText.includes('外部写的内容'));
    assert.deepEqual(notes[0].tags, ['tag1']);

    // 目录结构 → 文件夹树
    const folders = noteStore.listFolders();
    const llm = folders.find((f: any) => f.name === 'LLM');
    const parent = folders.find((f: any) => f.name === '研究');
    assert.ok(llm && parent);
    assert.equal(llm.parentId, parent.id);
    assert.equal(notes[0].folderId, llm.id);

    // 导入后文件获得 frontmatter（含 id），且不会被重复导入
    const synced = readFileSync(path.join(nested, '外部新笔记.md'), 'utf8');
    assert.ok(synced.includes(`id: ${notes[0].id}\n`));
    const stats2 = await vault.syncNow();
    assert.equal(stats2.created, 0);
    assert.equal(stats2.imported, 0);
  } finally {
    noteStore.close();
    cleanupDir(dir);
  }
});

test('应用内删除笔记后，manifest 记录的文件在确认后清理；非受管文件不动', async () => {
  const { dir, vaultDir, noteStore, vault } = setup();
  try {
    const note = noteStore.createNote({
      paperId: 'global-notes',
      type: 'standalone',
      title: '会删除',
      content: 'x',
    });
    await vault.syncNow();
    assert.ok(existsSync(path.join(vaultDir, '会删除.md')));

    // 用户自己的 Obsidian 文件（不在 manifest、也无 id）不应被删除
    writeFileSync(path.join(vaultDir, '我自己的文件.md'), '用户内容');

    noteStore.deleteNote({ id: note.id });
    // 单次删除 1/1 = 100%，超过 5% 熔断阈值：先暂缓，文件仍在。
    const pending = await vault.syncNow();
    assert.equal(pending.removed, 0);
    assert.equal(pending.removalConfirmationRequired, true);
    assert.equal(pending.pendingRemovals, 1);
    assert.ok(existsSync(path.join(vaultDir, '会删除.md')));

    const stats = await vault.syncNow({ confirmRemoval: true });
    assert.equal(stats.removed, 1);
    assert.equal(stats.removalConfirmationRequired, false);
    assert.ok(!existsSync(path.join(vaultDir, '会删除.md')));
    assert.ok(existsSync(path.join(vaultDir, '我自己的文件.md')));
  } finally {
    noteStore.close();
    cleanupDir(dir);
  }
});

test('501+ 既有 vault 文件首次导入后全部保留，不会因 500 条列表截断被删除', async () => {
  const { dir, vaultDir, noteStore, vault } = setup();
  try {
    await vault.syncNow(); // 建 vault 目录
    const count = 520;
    for (let index = 0; index < count; index += 1) {
      const name = `外部笔记-${String(index).padStart(3, '0')}`;
      writeFileSync(path.join(vaultDir, `${name}.md`), `\n正文 ${index}\n`);
    }

    const stats = await vault.syncNow();
    assert.equal(stats.created, count);
    assert.equal(stats.removed, 0);
    assert.equal(stats.removalConfirmationRequired, false);

    const markdownFiles = readdirSync(vaultDir).filter((name) => name.endsWith('.md'));
    assert.equal(markdownFiles.length, count);
    // 窗口外（最早创建）的文件必须仍在，且每一篇的正文都完整保留。
    for (let index = 0; index < count; index += 1) {
      const fileName = `外部笔记-${String(index).padStart(3, '0')}.md`;
      assert.match(readFileSync(path.join(vaultDir, fileName), 'utf8'), new RegExp(`正文 ${index}`));
    }

    const second = await vault.syncNow();
    assert.equal(second.removed, 0);
    assert.equal(
      readdirSync(vaultDir).filter((name) => name.endsWith('.md')).length,
      count,
    );
  } finally {
    noteStore.close();
    cleanupDir(dir);
  }
});

test('501+ 数据库笔记全部导出，文件数量与笔记数一致', async () => {
  const { dir, vaultDir, noteStore, vault } = setup();
  try {
    const count = 520;
    const noteIds: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const note = noteStore.createNote({
        title: `数据库笔记-${String(index).padStart(3, '0')}`,
        content: `内容 ${index}`,
      });
      noteIds.push(note.id);
    }

    const stats = await vault.syncNow();
    assert.equal(stats.exported, count);
    assert.equal(stats.total, count);
    assert.equal(stats.removed, 0);
    assert.equal(
      readdirSync(vaultDir).filter((name) => name.endsWith('.md')).length,
      count,
    );

    // 编辑窗口外的旧笔记（自己仍应在结果里，而不是被挤出后当作已删除）。
    noteStore.updateNote({
      id: noteIds[0],
      patch: { content: '窗口外编辑', contentText: '窗口外编辑' },
    });

    const second = await vault.syncNow();
    assert.equal(second.exported, 1);
    assert.equal(second.removed, 0);
    assert.equal(
      readdirSync(vaultDir).filter((name) => name.endsWith('.md')).length,
      count,
    );
  } finally {
    noteStore.close();
    cleanupDir(dir);
  }
});

test('未配置 vault 目录时报错；文件名清洗保留中文', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'paperquay-vault-test-'));
  const noteStore = createNoteStore({
    dataDir: dir,
    notesDatabasePath: path.join(dir, 'paperquay-notes.sqlite'),
  });
  try {
    const vault = createNoteVault({
      noteStore,
      store: { load: () => ({ settings: {} }), save: async () => undefined },
    } as any);
    assert.throws(() => vault.syncNow(), /未配置/);
    assert.equal(sanitizeFileName('a/b:c*d?'), 'a b c d');
    assert.equal(sanitizeFileName('注意力机制: 综述'), '注意力机制 综述');
  } finally {
    noteStore.close();
    cleanupDir(dir);
  }
});

test('serializeNoteMarkdown：paperReference 渲染为 [n] 且同文献同号，文末附 GB/T 列表，锚点链接保 ID', () => {
  const note = {
    contentJson: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Transformer 出自' },
            { type: 'paperReference', attrs: { paperId: 'p1', label: 'Attention' } },
            { type: 'text', text: '，BERT 见' },
            { type: 'paperReference', attrs: { paperId: 'p2', label: 'BERT' } },
            { type: 'text', text: '，再次引用' },
            { type: 'paperReference', attrs: { paperId: 'p1', label: 'Attention' } },
            { type: 'text', text: '。' },
          ],
        },
        {
          type: 'noteAnchorBlock',
          attrs: { anchorId: 'anchor-9', label: 'P3 摘录' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '快照内容' }] }],
        },
      ],
    },
  };
  const papersById = new Map([
    ['p1', {
      id: 'p1',
      title: 'Attention Is All You Need',
      authors: [{ name: 'Ashish Vaswani' }, { name: 'Noam Shazeer' }],
      year: '2017',
      publication: 'NeurIPS',
      volume: '30',
      itemType: 'conferencePaper',
    }],
    ['p2', { id: 'p2', title: 'BERT', authors: [{ name: 'Jacob Devlin' }], year: '2019', publication: 'NAACL' }],
  ]);
  const markdown = serializeNoteMarkdown(note, papersById);
  assert.match(markdown, /出自\[1\]/);
  assert.match(markdown, /BERT 见\[2\]/);
  assert.match(markdown, /再次引用\[1\]/);
  assert.match(markdown, /\[P3 摘录\]\(paperquay:\/\/anchor\/anchor-9\)/);
  assert.match(markdown, /## 参考文献/);
  assert.match(markdown, /1\. Ashish Vaswani, Noam Shazeer\. Attention Is All You Need\[C\]\. NeurIPS, 2017, 30\./);
  assert.match(markdown, /2\. Jacob Devlin\. BERT\[J\]\. NAACL, 2019\./);
});

test('serializeNoteMarkdown：识别并剔除英文 References 小节，规范列表只出现一次', () => {
  const papersById = new Map([
    ['p1', {
      id: 'p1',
      title: 'Attention Is All You Need',
      authors: [{ name: 'Ashish Vaswani' }],
      year: '2017',
      publication: 'NeurIPS',
      itemType: 'conferencePaper',
    }],
  ]);
  const note = {
    contentJson: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Transformer ' },
            { type: 'paperReference', attrs: { paperId: 'p1', label: 'Attention' } },
          ],
        },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'References' }] },
        {
          type: 'orderedList',
          attrs: { start: 1 },
          content: [{
            type: 'listItem',
            content: [{
              type: 'paragraph',
              content: [{ type: 'text', text: '1. Ashish Vaswani. Attention Is All You Need[C]. NeurIPS, 2017.' }],
            }],
          }],
        },
      ],
    },
  };

  const markdown = serializeNoteMarkdown(note, papersById);
  assert.equal((markdown.match(/## (?:参考文献|References)/g) ?? []).length, 1);
  assert.match(markdown, /## References/);
  assert.equal(markdown.includes('## 参考文献'), false);
  assert.equal((markdown.match(/Ashish Vaswani\. Attention Is All You Need/g) ?? []).length, 1, '规范列表只保留一份');

  // 回导后再导出保持幂等：解析器把 [1] 映射回 paperReference，旧列表被剔除后重建。
  const { parseMarkdownToTiptap } = require('../src/shared/markdownToTiptap.cjs');
  const reparsed = parseMarkdownToTiptap(markdown, { papers: [...papersById.values()] });
  const again = serializeNoteMarkdown({ contentJson: reparsed }, papersById);
  assert.equal(again, markdown);
});

test('serializeNoteMarkdown：识别中文参考文献小节，重复导出不增长', () => {
  const papersById = new Map([
    ['p1', { id: 'p1', title: 'Known Paper', authors: [{ name: 'Author' }], year: '2024', publication: 'Journal' }],
  ]);
  const note = {
    contentJson: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'paperReference', attrs: { paperId: 'p1', label: 'Known Paper' } }],
        },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '参考文献' }] },
        {
          type: 'bulletList',
          content: [{
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '1. Author. Known Paper[J]. Journal, 2024.' }] }],
          }],
        },
      ],
    },
  };
  const first = serializeNoteMarkdown(note, papersById);
  assert.equal((first.match(/## 参考文献/g) ?? []).length, 1);
  assert.equal((first.match(/Author\. Known Paper\[J\]/g) ?? []).length, 1, '规范列表只保留一份');

  const { parseMarkdownToTiptap } = require('../src/shared/markdownToTiptap.cjs');
  const reparsed = parseMarkdownToTiptap(first, { papers: [...papersById.values()] });
  const second = serializeNoteMarkdown({ contentJson: reparsed }, papersById);
  assert.equal(second, first);
});

test('serializeNoteMarkdown：无 paperReference 时保留用户手写的参考文献列表', () => {
  const note = {
    contentJson: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '正文没有内联引用。' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '参考文献' }] },
        {
          type: 'bulletList',
          content: [{
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '- 手写条目 A' }] }],
          }],
        },
      ],
    },
  };
  const markdown = serializeNoteMarkdown(note, new Map());
  assert.match(markdown, /正文没有内联引用/);
  assert.match(markdown, /## 参考文献/);
  assert.match(markdown, /手写条目 A/);
});

test('serializeNoteMarkdown：中英两份列表并存时只保留一份', () => {
  const papersById = new Map([
    ['p1', { id: 'p1', title: 'Known Paper', authors: [{ name: 'Author' }], year: '2024', publication: 'Journal' }],
  ]);
  const note = {
    contentJson: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'paperReference', attrs: { paperId: 'p1', label: 'Known Paper' } }],
        },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'References' }] },
        {
          type: 'orderedList',
          content: [{
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '1. Author. Known Paper[J]. Journal, 2024.' }] }],
          }],
        },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '参考文献' }] },
        {
          type: 'orderedList',
          content: [{
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '1. Author. Known Paper[J]. Journal, 2024.' }] }],
          }],
        },
      ],
    },
  };
  const markdown = serializeNoteMarkdown(note, papersById);
  assert.equal((markdown.match(/## (?:参考文献|References)/g) ?? []).length, 1);
  assert.match(markdown, /## References/, '沿用笔记原有（首个）列表语言');
  assert.equal((markdown.match(/Author\. Known Paper\[J\]/g) ?? []).length, 1, '规范列表只保留一份');
});

test('serializeNoteMarkdown：代码围栏内的 References 标题不会被删除', () => {
  const papersById = new Map([
    ['p1', { id: 'p1', title: 'Known Paper', authors: [{ name: 'Author' }], year: '2024', publication: 'Journal' }],
  ]);
  const note = {
    contentJson: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'paperReference', attrs: { paperId: 'p1', label: 'Known Paper' } }],
        },
        {
          type: 'codeBlock',
          attrs: { language: 'markdown' },
          content: [{ type: 'text', text: '## References\n1. example entry inside code' }],
        },
      ],
    },
  };
  const markdown = serializeNoteMarkdown(note, papersById);
  assert.match(markdown, /1\. example entry inside code/, 'fenced code content must be preserved');
  assert.match(markdown, /## 参考文献/);
  assert.equal((markdown.match(/Author\. Known Paper\[J\]/g) ?? []).length, 1);
});

test('serializeNoteMarkdown：内层三反引号不会提前关闭四反引号围栏，代码内容完整保留', () => {
  const papersById = new Map([
    ['p1', { id: 'p1', title: 'Known Paper', authors: [{ name: 'Author' }], year: '2024', publication: 'Journal' }],
  ]);
  const note = {
    contentJson: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'paperReference', attrs: { paperId: 'p1', label: 'Known Paper' } }],
        },
        {
          type: 'codeBlock',
          attrs: { language: 'markdown' },
          content: [{ type: 'text', text: '````markdown\n```js\n## References\n1. inside nested fence\n```\n````' }],
        },
      ],
    },
  };
  const markdown = serializeNoteMarkdown(note, papersById);
  assert.match(markdown, /```js/);
  assert.match(markdown, /1\. inside nested fence/);
  assert.match(markdown, /## References/);
  assert.match(markdown, /## 参考文献/);
  assert.equal((markdown.match(/Author\. Known Paper\[J\]/g) ?? []).length, 1);
});

test('serializeNoteMarkdown：列表项内的代码块不会被当成参考文献列表删除', () => {
  const papersById = new Map([
    ['p1', { id: 'p1', title: 'Known Paper', authors: [{ name: 'Author' }], year: '2024', publication: 'Journal' }],
  ]);
  const note = {
    contentJson: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'paperReference', attrs: { paperId: 'p1', label: 'Known Paper' } }],
        },
        {
          type: 'bulletList',
          content: [{
            type: 'listItem',
            content: [{
              type: 'codeBlock',
              attrs: { language: 'js' },
              content: [{ type: 'text', text: '## References\n1. inside code' }],
            }],
          }],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'after the list' }] },
      ],
    },
  };
  const markdown = serializeNoteMarkdown(note, papersById);
  assert.match(markdown, /1\. inside code/);
  assert.match(markdown, /after the list/);
  assert.match(markdown, /## 参考文献/);
  assert.equal((markdown.match(/Author\. Known Paper\[J\]/g) ?? []).length, 1);
});

test('serializeNoteMarkdown：参考文献列表后的另一份无序列表不会被吞掉', () => {
  const papersById = new Map([
    ['p1', { id: 'p1', title: 'Known Paper', authors: [{ name: 'Author' }], year: '2024', publication: 'Journal' }],
  ]);
  const note = {
    contentJson: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'paperReference', attrs: { paperId: 'p1', label: 'Known Paper' } }],
        },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'References' }] },
        {
          type: 'orderedList',
          content: [{
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Author. Known Paper[J]. Journal, 2024.' }] }],
          }],
        },
        {
          type: 'bulletList',
          content: [{
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'TODO unrelated' }] }],
          }],
        },
      ],
    },
  };
  const markdown = serializeNoteMarkdown(note, papersById);
  assert.match(markdown, /TODO unrelated/, 'a separate list after the bibliography must survive');
  assert.match(markdown, /## References/);
  assert.equal((markdown.match(/Author\. Known Paper\[J\]/g) ?? []).length, 1);
});

test('serializeNoteMarkdown：列表项的多行续行作为同一条目整体剔除，不留下孤行', () => {
  const papersById = new Map([
    ['p1', { id: 'p1', title: 'Known Paper', authors: [{ name: 'Author' }], year: '2024', publication: 'Journal' }],
  ]);
  const note = {
    contentJson: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'paperReference', attrs: { paperId: 'p1', label: 'Known Paper' } }],
        },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '参考文献' }] },
        {
          type: 'orderedList',
          content: [{
            type: 'listItem',
            content: [{
              type: 'paragraph',
              content: [{ type: 'text', text: '1. Author. Known Paper[J]. Journal, 2024.\ncontinuation line' }],
            }],
          }],
        },
      ],
    },
  };
  const markdown = serializeNoteMarkdown(note, papersById);
  assert.equal(markdown.includes('continuation line'), false);
  assert.match(markdown, /## 参考文献/);
  assert.equal((markdown.match(/Author\. Known Paper\[J\]/g) ?? []).length, 1);
});

test('serializeNoteMarkdown：References 标题后是正文时保留正文且不追加第二份列表', () => {
  const papersById = new Map([
    ['p1', { id: 'p1', title: 'Known Paper', authors: [{ name: 'Author' }], year: '2024', publication: 'Journal' }],
  ]);
  const note = {
    contentJson: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'paperReference', attrs: { paperId: 'p1', label: 'Known Paper' } }],
        },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'References' }] },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'My handwritten note about references.' }],
        },
      ],
    },
  };
  const markdown = serializeNoteMarkdown(note, papersById);
  assert.match(markdown, /My handwritten note about references\./);
  assert.equal((markdown.match(/## (?:参考文献|References)/g) ?? []).length, 1);
  assert.equal(markdown.includes('Author. Known Paper[J]'), false);
});

test('serializeNoteMarkdown：带行内强调的参考文献标题也能识别', () => {
  const papersById = new Map([
    ['p1', { id: 'p1', title: 'Known Paper', authors: [{ name: 'Author' }], year: '2024', publication: 'Journal' }],
  ]);
  const note = {
    contentJson: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'paperReference', attrs: { paperId: 'p1', label: 'Known Paper' } }],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: '参考文献', marks: [{ type: 'bold' }] }],
        },
        {
          type: 'orderedList',
          content: [{
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '1. 旧条目' }] }],
          }],
        },
      ],
    },
  };
  const markdown = serializeNoteMarkdown(note, papersById);
  assert.equal((markdown.match(/## (?:\*\*)?参考文献/g) ?? []).length, 1, 'marked heading must be replaced, not duplicated');
  assert.equal(markdown.includes('旧条目'), false);
  assert.match(markdown, /Author\. Known Paper\[J\]/);
});

test('serializeNoteMarkdown：保留行内和块级公式的 LaTeX', () => {
  const markdown = serializeNoteMarkdown({
    contentJson: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '能量关系 ' },
            { type: 'inlineMath', attrs: { latex: 'E=mc^2' } },
          ],
        },
        { type: 'blockMath', attrs: { latex: '\\frac{a}{b} = c\\tag{1}' } },
      ],
    },
  }, new Map());

  assert.match(markdown, /能量关系 \$E=mc\^2\$/);
  assert.match(markdown, /\$\$\n\\frac\{a\}\{b\} = c\\tag\{1\}\n\$\$/);
});

test('serializeNoteMarkdown：无 contentJson 时退化为纯文本', () => {
  assert.equal(serializeNoteMarkdown({ contentText: '纯文本内容' }, new Map()), '纯文本内容');
  assert.equal(serializeNoteMarkdown({ content: '兜底字段' }, new Map()), '兜底字段');
});

test('vault 往返保留标题、列表、双链、标签、锚点和文献引用', async () => {
  const { dir, vaultDir, noteStore, vault, library } = setup();
  try {
    library.papers.push({
      id: 'p1',
      title: 'Known Paper',
      authors: [{ name: 'Author' }],
      year: '2024',
      publication: 'Journal',
    });
    const note = noteStore.createNote({
      paperId: 'global-notes',
      type: 'standalone',
      title: '往返',
      contentJson: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '标题' }] },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: '正文 ' },
              { type: 'paperReference', attrs: { paperId: 'p1', label: 'Known Paper' } },
              { type: 'text', text: ' ' },
              { type: 'noteAnchorLink', attrs: { anchorId: 'a1', label: 'P3' } },
              { type: 'text', text: ' ' },
              { type: 'wikiLink', attrs: { id: 'note-target', label: '双链' } },
              { type: 'text', text: ' ' },
              { type: 'hashTag', attrs: { tag: '标签' } },
            ],
          },
          {
            type: 'bulletList',
            content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '列表项' }] }] }],
          },
        ],
      },
      content: '',
      anchors: [{ id: 'a1', paperId: 'p1', label: 'P3', excerpt: '摘录', source: 'pdf', createdAt: 1 }],
    });
    await vault.syncNow();
    const filePath = path.join(vaultDir, '往返.md');
    const original = readFileSync(filePath, 'utf8');
    writeFileSync(filePath, original.replace('标题', '修改后的标题'));
    const future = new Date(Date.now() + 60_000);
    utimesSync(filePath, future, future);

    assert.equal((await vault.syncNow()).updated, 1);
    const reloaded = noteStore.getNote({ id: note.id });
    assert.equal(reloaded.contentJson.content[0].type, 'heading');
    assert.equal(reloaded.contentJson.content[1].content.find((n: any) => n.type === 'noteAnchorLink').attrs.anchorId, 'a1');
    assert.equal(reloaded.contentJson.content[1].content.find((n: any) => n.type === 'paperReference').attrs.paperId, 'p1');
    assert.ok(reloaded.contentJson.content[1].content.some((n: any) => n.type === 'wikiLink' && n.attrs.label === '双链'));
    assert.ok(reloaded.contentJson.content[1].content.some((n: any) => n.type === 'hashTag' && n.attrs.tag === '标签'));
    const exported = readFileSync(filePath, 'utf8');
    assert.match(exported, /\[1\]/);
    assert.match(exported, /paperquay:\/\/anchor\/a1/);
    assert.match(exported, /\[\[双链\]\]/);
    assert.match(exported, /#标签/);
  } finally {
    noteStore.close();
    cleanupDir(dir);
  }
});

test('vault 导出按 noteId 跟随改名，回导后仍恢复双链关系', async () => {
  const { dir, vaultDir, noteStore, vault } = setup();
  try {
    const target = noteStore.createNote({ title: '旧标题', content: '' });
    const source = noteStore.createNote({
      title: '引用方',
      content: '',
      contentText: '[[旧标题]]',
      contentJson: {
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [{ type: 'wikiLink', attrs: { noteId: target.id, id: target.id, label: '旧标题' } }],
        }],
      },
    });
    await vault.syncNow();

    noteStore.updateNote({ id: target.id, patch: { title: '新标题' } });
    await vault.syncNow();
    const sourcePath = path.join(vaultDir, '引用方.md');
    assert.match(readFileSync(sourcePath, 'utf8'), /\[\[新标题\]\]/);

    const sourceText = readFileSync(sourcePath, 'utf8');
    writeFileSync(sourcePath, sourceText.replace('[[新标题]]', '[[新标题]]\n\n补充说明'));
    const future = new Date(Date.now() + 60_000);
    utimesSync(sourcePath, future, future);
    assert.equal((await vault.syncNow()).updated, 1);
    assert.deepEqual(noteStore.getNote({ id: source.id }).linkedNoteIds, [target.id]);
  } finally {
    noteStore.close();
    cleanupDir(dir);
  }
});

test('vault 双侧修改生成冲突副本且 DB 保持应用侧内容', async () => {
  const { dir, vaultDir, noteStore, vault } = setup();
  try {
    const note = noteStore.createNote({ title: '冲突', content: '初始' });
    await vault.syncNow();
    const filePath = path.join(vaultDir, '冲突.md');
    const exported = readFileSync(filePath, 'utf8');
    writeFileSync(filePath, exported.replace('初始', '文件侧修改'));
    noteStore.updateNote({ id: note.id, patch: { content: '应用侧修改', contentText: '应用侧修改' } });

    const stats = await vault.syncNow();
    assert.equal(stats.conflicts, 1);
    assert.equal(noteStore.getNote({ id: note.id }).contentText, '应用侧修改');
    assert.ok(readdirSync(vaultDir).some((name) => name.startsWith('冲突--conflict-') && name.endsWith('.md')));
    assert.match(readFileSync(filePath, 'utf8'), /文件侧修改/);
  } finally {
    noteStore.close();
    cleanupDir(dir);
  }
});

test('vault 仅文件侧修改导入，旧 manifest 字符串格式仍兼容，DB 侧修改正常导出', async () => {
  const { dir, vaultDir, noteStore, vault } = setup();
  try {
    const note = noteStore.createNote({ title: '时钟', content: '初始' });
    await vault.syncNow();
    const filePath = path.join(vaultDir, '时钟.md');
    const manifestPath = path.join(vaultDir, '.paperquay-vault.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.files = { [note.id]: manifest.files[note.id] };
    delete manifest.metadata;
    writeFileSync(manifestPath, JSON.stringify(manifest));
    writeFileSync(filePath, readFileSync(filePath, 'utf8').replace('初始', '文件改'));
    const imported = await vault.syncNow();
    assert.equal(imported.updated, 1);
    assert.equal(noteStore.getNote({ id: note.id }).contentText, '文件改');

    noteStore.updateNote({
      id: note.id,
      patch: {
        content: 'DB 改',
        contentText: 'DB 改',
        contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'DB 改' }] }] },
      },
    });
    const exported = await vault.syncNow();
    assert.equal(exported.exported, 1);
    assert.match(readFileSync(filePath, 'utf8'), /DB 改/);
  } finally {
    noteStore.close();
    cleanupDir(dir);
  }
});

test('大 vault 同步让出主线程：心跳在扫描期间运行，结果与旧行为一致', async () => {
  const { dir, vaultDir, noteStore, vault } = setup();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    await vault.syncNow(); // 建 vault 目录
    const count = 400;
    for (let index = 0; index < count; index += 1) {
      const name = `批量笔记-${String(index).padStart(3, '0')}`;
      writeFileSync(path.join(vaultDir, `${name}.md`), `#批量\n\n正文 ${index}\n`);
    }

    let ticks = 0;
    heartbeat = setInterval(() => { ticks += 1; }, 2);
    const pending = vault.syncNow();
    // 大 vault 走异步驱动：先返回 Promise，主线程才有机会跑心跳。
    assert.equal(typeof (pending as any).then, 'function');
    const stats = await pending;
    clearInterval(heartbeat);
    heartbeat = undefined;

    assert.equal(stats.created, count);
    assert.equal(stats.imported, count);
    assert.equal(stats.exported, count);
    assert.equal(stats.removed, 0);
    assert.equal(stats.removalConfirmationRequired, false);
    assert.ok(ticks > 0, `expected the event loop to tick during sync, got ${ticks}`);

    const markdownFiles = readdirSync(vaultDir).filter((name) => name.endsWith('.md'));
    assert.equal(markdownFiles.length, count);
    for (let index = 0; index < count; index += 1) {
      const fileName = `批量笔记-${String(index).padStart(3, '0')}.md`;
      const text = readFileSync(path.join(vaultDir, fileName), 'utf8');
      assert.match(text, new RegExp(`正文 ${index}`));
      assert.match(text, /^---\nid: /);
    }

    // 第二次同步幂等：没有新增、没有清理。
    const second = await vault.syncNow();
    assert.equal(second.created, 0);
    assert.equal(second.imported, 0);
    assert.equal(second.removed, 0);
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    noteStore.close();
    cleanupDir(dir);
  }
});

test(
  'perf: 1000 文件扫描的最大事件循环停顿与总时长',
  { skip: process.env.PAPERQUAY_PERF !== '1' },
  async () => {
    const { dir, vaultDir, noteStore, vault } = setup();
    try {
      await vault.syncNow();
      const count = 1000;
      for (let index = 0; index < count; index += 1) {
        const name = `性能笔记-${String(index).padStart(4, '0')}`;
        writeFileSync(path.join(vaultDir, `${name}.md`), `#性能\n\n正文 ${index}\n`);
      }

      const monitor = monitorEventLoopDelay({ resolution: 1 });
      monitor.enable();
      const started = performance.now();
      const stats = await vault.syncNow();
      const totalMs = performance.now() - started;
      monitor.disable();
      const maxStallMs = monitor.max / 1e6;

      assert.equal(stats.created, count);
      assert.equal(readdirSync(vaultDir).filter((name) => name.endsWith('.md')).length, count);
      // 记录测量值，便于发布说明引用（不伪造目标）。
      console.log(
        `[noteVault perf] files=${count} total=${totalMs.toFixed(1)}ms ` +
        `maxEventLoopDelay=${maxStallMs.toFixed(2)}ms`,
      );
      assert.ok(
        Number.isFinite(maxStallMs),
        `expected a measured event-loop delay, got ${maxStallMs}`,
      );
    } finally {
      noteStore.close();
      cleanupDir(dir);
    }
  },
);

test('MCP note writes export to the vault and vault edits import back', async () => {
  const { dir, vaultDir, noteStore, vault } = setup();
  try {
    const { PaperQuayKnowledgeService } = require('../electron/mcp/knowledgeMcpService.cjs');
    const service = new PaperQuayKnowledgeService({ dataDir: dir, isAppRunning: () => false });
    const created = service.createNote({ title: 'MCP 同步笔记', content: '由 MCP 写入' });

    const exported = await vault.syncNow();
    assert.equal(exported.exported, 1);
    const filePath = path.join(vaultDir, 'MCP 同步笔记.md');
    assert.ok(existsSync(filePath));

    writeFileSync(filePath, readFileSync(filePath, 'utf8').replace('由 MCP 写入', '在 Vault 中编辑'));
    const future = new Date(Date.now() + 60_000);
    utimesSync(filePath, future, future);

    const imported = await vault.syncNow();
    assert.equal(imported.updated, 1);
    assert.match(noteStore.getNote({ id: created.noteId }).contentText, /在 Vault 中编辑/);
  } finally {
    noteStore.close();
    cleanupDir(dir);
  }
});
