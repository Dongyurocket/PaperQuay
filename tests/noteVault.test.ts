import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

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
  const library = { settings: { notesVaultDir: vaultDir } };
  const store = {
    load: () => library,
    save: async () => undefined,
  };
  const vault = createNoteVault({ noteStore, store } as any);
  return { dir, vaultDir, noteStore, vault };
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

test('同步导出笔记到 vault，frontmatter 带 id/anchors，目录跟随文件夹', () => {
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

    const stats = vault.syncNow();
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
    const stats2 = vault.syncNow();
    assert.equal(stats2.exported, 0);
    assert.equal(stats2.imported, 0);
  } finally {
    noteStore.close();
    cleanupDir(dir);
  }
});

test('vault 侧编辑（mtime 更新）会导回 DB，且锚点不被覆盖', () => {
  const { dir, vaultDir, noteStore, vault } = setup();
  try {
    const note = noteStore.createNote({
      paperId: 'global-notes',
      type: 'standalone',
      title: '概念页',
      content: '旧内容',
      anchors: [{ id: 'a1', paperId: 'p1', label: 'P3', excerpt: '原文', source: 'pdf', createdAt: 1 }],
    });
    vault.syncNow();

    const filePath = path.join(vaultDir, '概念页.md');
    const original = readFileSync(filePath, 'utf8');
    writeFileSync(filePath, original.replace('旧内容', '在 Obsidian 里改的新内容'));
    // 文件系统精度：强制把 mtime 推到未来，模拟外部编辑晚于 DB 更新。
    const future = new Date(Date.now() + 60_000);
    utimesSync(filePath, future, future);

    const stats = vault.syncNow();
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

test('vault 里无 id 的新文件导入为新笔记，目录结构映射为文件夹', () => {
  const { dir, vaultDir, noteStore, vault } = setup();
  try {
    vault.syncNow(); // 建 vault 目录
    const nested = path.join(vaultDir, '研究', 'LLM');
    rmSync(nested, { recursive: true, force: true });
    require('node:fs').mkdirSync(nested, { recursive: true });
    writeFileSync(path.join(nested, '外部新笔记.md'), '#tag1\n\n外部写的内容\n');

    const stats = vault.syncNow();
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
    const stats2 = vault.syncNow();
    assert.equal(stats2.created, 0);
    assert.equal(stats2.imported, 0);
  } finally {
    noteStore.close();
    cleanupDir(dir);
  }
});

test('应用内删除笔记后，manifest 记录的文件被清理；非受管文件不动', () => {
  const { dir, vaultDir, noteStore, vault } = setup();
  try {
    const note = noteStore.createNote({
      paperId: 'global-notes',
      type: 'standalone',
      title: '会删除',
      content: 'x',
    });
    vault.syncNow();
    assert.ok(existsSync(path.join(vaultDir, '会删除.md')));

    // 用户自己的 Obsidian 文件（不在 manifest、也无 id）不应被删除
    writeFileSync(path.join(vaultDir, '我自己的文件.md'), '用户内容');

    noteStore.deleteNote({ id: note.id });
    const stats = vault.syncNow();
    assert.equal(stats.removed, 1);
    assert.ok(!existsSync(path.join(vaultDir, '会删除.md')));
    assert.ok(existsSync(path.join(vaultDir, '我自己的文件.md')));
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

test('serializeNoteMarkdown：无 contentJson 时退化为纯文本', () => {
  assert.equal(serializeNoteMarkdown({ contentText: '纯文本内容' }, new Map()), '纯文本内容');
  assert.equal(serializeNoteMarkdown({ content: '兜底字段' }, new Map()), '兜底字段');
});
