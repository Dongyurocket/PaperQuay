import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('../electron/backend/nodeSqlite.cjs');
const { PaperQuayKnowledgeService } = require('../electron/mcp/knowledgeMcpService.cjs');

function setupTestEnvironment() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-mcp-test-'));
  const libraryDbPath = path.join(dataDir, 'paperquay-library.sqlite');
  const ragDbPath = path.join(dataDir, 'paperquay-rag.sqlite');
  const notesDbPath = path.join(dataDir, 'paperquay-notes.sqlite');

  // 1. 初始化 library 数据库
  const libDb = new DatabaseSync(libraryDbPath);
  libDb.exec(`
    CREATE TABLE papers (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      title_zh TEXT,
      year TEXT,
      publication TEXT,
      doi TEXT,
      url TEXT,
      abstract_text TEXT,
      item_type TEXT,
      imported_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_read_at INTEGER,
      reading_progress REAL NOT NULL,
      is_favorite INTEGER NOT NULL,
      user_note TEXT,
      ai_summary TEXT,
      citation TEXT,
      source TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );
    CREATE TABLE authors (
      id TEXT NOT NULL,
      paper_id TEXT NOT NULL,
      name TEXT NOT NULL,
      given_name TEXT,
      family_name TEXT,
      sort_order INTEGER NOT NULL
    );
    CREATE TABLE tags (
      id TEXT NOT NULL,
      paper_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT,
      sort_order INTEGER NOT NULL
    );
    CREATE TABLE paper_keywords (
      paper_id TEXT NOT NULL,
      keyword TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );
    CREATE TABLE attachments (
      id TEXT PRIMARY KEY,
      paper_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      original_path TEXT,
      stored_path TEXT NOT NULL,
      relative_path TEXT,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      content_hash TEXT,
      created_at INTEGER NOT NULL,
      missing INTEGER NOT NULL
    );
  `);

  libDb.exec(`
    INSERT INTO papers (id, title, title_zh, year, publication, doi, abstract_text, item_type, imported_at, updated_at, reading_progress, is_favorite, source, sort_order)
    VALUES
      ('paper-1', 'Attention Is All You Need', '注意力即所需', '2017', 'NeurIPS', '10.1000/transformer', 'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.', 'journalArticle', 1, 1, 0.5, 1, 'local', 0),
      ('paper-2', 'Deep Residual Learning for Image Recognition', '用于图像识别的深度残差学习', '2016', 'CVPR', '10.1000/resnet', 'Deeper neural networks are more difficult to train.', 'conferencePaper', 2, 2, 0.1, 0, 'local', 1);
    INSERT INTO authors (id, paper_id, name, sort_order) VALUES ('a1', 'paper-1', 'Ashish Vaswani', 0), ('a2', 'paper-2', 'Kaiming He', 0);
    INSERT INTO tags (id, paper_id, name, sort_order) VALUES ('t1', 'paper-1', 'transformer', 0), ('t2', 'paper-2', 'vision', 0);
  `);
  libDb.close();

  // 2. 初始化 RAG 数据库
  const ragDb = new DatabaseSync(ragDbPath);
  ragDb.exec(`
    CREATE TABLE rag_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_key TEXT NOT NULL,
      source_type TEXT NOT NULL,
      chunk_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      page_index INTEGER,
      block_id TEXT,
      text TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE rag_chunks_fts USING fts5(
      text,
      content='rag_chunks',
      content_rowid='id',
      tokenize='unicode61'
    );
    CREATE TRIGGER rag_chunks_ai AFTER INSERT ON rag_chunks BEGIN
      INSERT INTO rag_chunks_fts(rowid, text) VALUES (new.id, new.text);
    END;
  `);

  ragDb.exec(`
    INSERT INTO rag_chunks (document_key, source_type, chunk_id, chunk_index, page_index, block_id, text)
    VALUES
      ('paper-1', 'mineru-markdown', 'c-1', 0, 0, 'b-1', 'We propose the Transformer, a model architecture eschewing recurrence and instead relying entirely on an attention mechanism to draw global dependencies between input and output.'),
      ('paper-1', 'mineru-markdown', 'c-2', 1, 1, 'b-2', 'Multi-head attention allows the model to jointly attend to information from different representation subspaces at different positions.'),
      ('paper-2', 'mineru-markdown', 'c-3', 0, 0, 'b-3', 'We explicitly reformulate the layers as learning residual functions with reference to the layer inputs, instead of learning unreferenced functions.');
  `);
  ragDb.close();

  // 3. 初始化 notes 数据库
  const notesDb = new DatabaseSync(notesDbPath);
  notesDb.exec(`
    CREATE TABLE notes (
      id TEXT PRIMARY KEY,
      paper_id TEXT NOT NULL,
      linked_paper_id TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      content_text TEXT,
      excerpt TEXT,
      pdf_page_number INTEGER,
      highlight_color TEXT,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
  `);
  notesDb.exec(`
    INSERT INTO notes (id, paper_id, type, title, content, content_text, is_favorite, created_at, updated_at)
    VALUES
      ('n-1', 'paper-1', 'standalone', 'Transformer 核心原理', 'Multi-Head Attention 机制通过多组线性投影实现了多维特征交互。', 'Multi-Head Attention 机制通过多组线性投影实现了多维特征交互。', 1, 1, 1);
  `);
  notesDb.close();

  return dataDir;
}

test('PaperQuayKnowledgeService searches papers and reads details', () => {
  const dataDir = setupTestEnvironment();
  try {
    const service = new PaperQuayKnowledgeService({ dataDir });

    // 搜索英文与中文标题
    const searchByTitle = service.searchPapers({ query: 'Transformer' });
    assert.equal(searchByTitle.total, 1);
    assert.equal(searchByTitle.papers[0].id, 'paper-1');
    assert.equal(searchByTitle.papers[0].titleZh, '注意力即所需');
    assert.deepEqual(searchByTitle.papers[0].tags, ['transformer']);

    const searchByZh = service.searchPapers({ query: '残差' });
    assert.equal(searchByZh.total, 1);
    assert.equal(searchByZh.papers[0].id, 'paper-2');

    // 读取详情
    const details = service.getPaperDetails({ paperId: 'paper-1' });
    assert.ok(details);
    assert.equal(details.title, 'Attention Is All You Need');
    assert.deepEqual(details.authors, ['Ashish Vaswani']);
    assert.equal(details.isFavorite, true);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('PaperQuayKnowledgeService searches knowledge base chunks with citations', () => {
  const dataDir = setupTestEnvironment();
  try {
    const service = new PaperQuayKnowledgeService({ dataDir });

    // 知识库分块检索
    const ragResult = service.searchKnowledgeBase({ query: 'multi-head attention' });
    assert.ok(ragResult.total > 0);
    assert.equal(ragResult.results[0].paperId, 'paper-1');
    assert.equal(ragResult.results[0].pageNumber, 2); // page_index 1 -> pageNumber 2
    assert.equal(ragResult.results[0].blockId, 'b-2');
    assert.match(ragResult.results[0].snippet, /Multi-head attention/);

    // 读取分块
    const chunks = service.readPaperContent({ paperId: 'paper-1' });
    assert.equal(chunks.total, 2);
    assert.equal(chunks.chunks[0].chunkIndex, 0);

    // 搜索笔记
    const notes = service.searchNotes({ query: '线性投影' });
    assert.equal(notes.total, 1);
    assert.equal(notes.notes[0].id, 'n-1');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('paperquay-mcp stdio server handles JSON-RPC 2.0 requests', async () => {
  const dataDir = setupTestEnvironment();
  const scriptPath = path.resolve('bin/paperquay-mcp.cjs');

  try {
    const child = spawn(process.execPath, [scriptPath, `--data-dir=${dataDir}`], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let buffer = '';
    const pendingRequests = new Map();

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        const msg = JSON.parse(line.trim());
        if (msg.id !== undefined && pendingRequests.has(msg.id)) {
          const resolver = pendingRequests.get(msg.id);
          pendingRequests.delete(msg.id);
          resolver(msg);
        }
      }
    });

    function call(id, method, params = {}) {
      return new Promise((resolve) => {
        pendingRequests.set(id, resolve);
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });
    }

    // 1. initialize
    const initRes = (await call(1, 'initialize', {})) as any;
    assert.equal(initRes.result.serverInfo.name, 'paperquay-knowledge-mcp');
    assert.ok(initRes.result.capabilities.tools);

    // 2. tools/list
    const listRes = (await call(2, 'tools/list', {})) as any;
    const toolNames = listRes.result.tools.map((t: any) => t.name);
    assert.ok(toolNames.includes('search_papers'));
    assert.ok(toolNames.includes('get_paper_details'));
    assert.ok(toolNames.includes('search_knowledge_base'));
    assert.ok(toolNames.includes('read_paper_content'));
    assert.ok(toolNames.includes('search_notes'));
    assert.ok(toolNames.includes('zotero_list_collections'));
    assert.ok(toolNames.includes('zotero_search_items'));
    assert.ok(toolNames.includes('zotero_preview_sync'));
    assert.ok(toolNames.includes('paperquay_sync_from_zotero'));

    // 3. tools/call search_knowledge_base
    const callRes = (await call(3, 'tools/call', {
      name: 'search_knowledge_base',
      arguments: { query: 'Transformer' },
    })) as any;

    assert.equal(callRes.result.isError, false);
    const parsedData = JSON.parse(callRes.result.content[0].text);
    assert.ok(parsedData.results.length > 0);
    assert.equal(parsedData.results[0].paperId, 'paper-1');

    child.stdin.end();
    await new Promise((resolve) => child.on('close', resolve));
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('PaperQuayKnowledgeService handles selective Zotero sync workflow', async () => {
  const initSqlJs = require('sql.js');
  const { createLibraryStore } = require('../electron/backend/libraryStore.cjs');
  const { resolveAppPaths } = require('../electron/mcp/knowledgeMcpService.cjs');

  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-mcp-sync-'));
  const zoteroDir = mkdtempSync(path.join(tmpdir(), 'paperquay-zotero-sync-'));
  const appPaths = resolveAppPaths(dataDir);

  // 初始化 library
  const store = createLibraryStore(appPaths);
  const library = store.load();
  library.papers.push({
    id: 'paper-existing-1',
    title: 'Attention Is All You Need',
    titleZh: null,
    year: '2017',
    publication: 'NeurIPS',
    doi: '10.1000/transformer',
    url: null,
    abstractText: 'Transformer architecture',
    itemType: 'journalArticle',
    publisher: null,
    institution: null,
    reportNumber: null,
    volume: null,
    issue: null,
    pages: null,
    isbn: null,
    issn: null,
    keywords: [],
    importedAt: Date.now(),
    updatedAt: Date.now(),
    lastReadAt: null,
    readingProgress: 0,
    isFavorite: false,
    userNote: null,
    aiSummary: null,
    citation: null,
    source: 'local',
    sortOrder: 0,
    authors: [],
    tags: [],
    categoryIds: [],
    attachments: [],
  });
  store.save(library);
  store.close();

  // 构建 Zotero 数据库 fixture
  const SQL = await initSqlJs({
    locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm'),
  });
  const zdb = new SQL.Database();

  zdb.run(`
    create table itemAttachments (itemID integer, parentItemID integer, contentType text, path text);
    create table items (itemID integer primary key, key text, itemTypeID integer, dateModified text);
    create table itemTypes (itemTypeID integer primary key, typeName text);
    create table fields (fieldID integer primary key, fieldName text);
    create table itemData (itemID integer, fieldID integer, valueID integer);
    create table itemDataValues (valueID integer primary key, value text);
    create table itemCreators (itemID integer, creatorID integer, orderIndex integer);
    create table creators (creatorID integer primary key, firstName text, lastName text);
    create table collections (collectionID integer primary key, key text, collectionName text, parentCollectionID integer);
    create table collectionItems (collectionID integer, itemID integer);
    create table deletedItems (itemID integer primary key, dateDeleted text);
  `);
  zdb.run("insert into itemTypes values (1, 'journalArticle'), (2, 'attachment')");
  zdb.run("insert into fields values (1, 'title'), (2, 'date'), (3, 'DOI')");
  zdb.run("insert into collections values (10, 'COLL_AI', 'AI Papers', null)");

  // Item 1: 新文献，有本地 PDF
  const storage1 = path.join(zoteroDir, 'storage', 'ATT_1');
  mkdirSync(storage1, { recursive: true });
  writeFileSync(path.join(storage1, 'rl.pdf'), '%PDF-1.7\nSample RL Content');
  zdb.run("insert into items values (1, 'PARENT_RL', 1, '2026-01-01')");
  zdb.run("insert into items values (101, 'ATT_1', 2, '2026-01-01')");
  zdb.run("insert into itemAttachments values (101, 1, 'application/pdf', 'storage:rl.pdf')");
  zdb.run('insert into collectionItems values (10, 1)');
  zdb.run("insert into itemDataValues values (1, 'Reinforcement Learning at Scale'), (2, '2025'), (3, '10.1000/rl-scale')");
  zdb.run('insert into itemData values (1, 1, 1), (1, 2, 2), (1, 3, 3)');

  // Item 2: 重复文献 (DOI 10.1000/transformer)
  const storage2 = path.join(zoteroDir, 'storage', 'ATT_2');
  mkdirSync(storage2, { recursive: true });
  writeFileSync(path.join(storage2, 'transformer.pdf'), '%PDF-1.7\nTransformer duplicate');
  zdb.run("insert into items values (2, 'PARENT_TRANSFORMER', 1, '2026-01-01')");
  zdb.run("insert into items values (102, 'ATT_2', 2, '2026-01-01')");
  zdb.run("insert into itemAttachments values (102, 2, 'application/pdf', 'storage:transformer.pdf')");
  zdb.run('insert into collectionItems values (10, 2)');
  zdb.run("insert into itemDataValues values (4, 'Attention Is All You Need'), (5, '10.1000/transformer')");
  zdb.run('insert into itemData values (2, 1, 4), (2, 3, 5)');

  // Item 3: 缺少本地 PDF 附件
  zdb.run("insert into items values (3, 'PARENT_NO_PDF', 1, '2026-01-01')");
  zdb.run('insert into collectionItems values (10, 3)');
  zdb.run("insert into itemDataValues values (6, 'Paper Without PDF')");
  zdb.run('insert into itemData values (3, 1, 6)');

  writeFileSync(path.join(zoteroDir, 'zotero.sqlite'), Buffer.from(zdb.export()));
  zdb.close();

  const service = new PaperQuayKnowledgeService({ dataDir });

  try {
    // 1. 测试列出分类
    const collectionsResult = await service.zoteroListCollections({ dataDir: zoteroDir });
    assert.equal(collectionsResult.total, 1);
    assert.equal(collectionsResult.collections[0].name, 'AI Papers');
    assert.equal(collectionsResult.collections[0].collectionKey, 'COLL_AI');

    // 2. 测试搜索条目
    const searchResult = await service.zoteroSearchItems({
      dataDir: zoteroDir,
      query: 'Reinforcement',
    });
    assert.equal(searchResult.total, 1);
    assert.equal(searchResult.items[0].title, 'Reinforcement Learning at Scale');
    assert.equal(searchResult.items[0].hasLocalPdf, true);

    // 3. 测试同步预检 (preview)
    const preview = await service.zoteroPreviewSync({
      dataDir: zoteroDir,
      collectionKey: 'COLL_AI',
    });
    assert.equal(preview.summary.total, 2); // 2 个带 PDF 的条目
    assert.equal(preview.summary.readyCount, 1); // 1 个新文献可同步
    assert.equal(preview.summary.alreadyExistsCount, 1); // 1 个与现有重复
    assert.equal(preview.ready[0].itemKey, 'PARENT_RL');
    assert.equal(preview.alreadyExists[0].itemKey, 'PARENT_TRANSFORMER');

    // 4. 测试执行精准同步
    const syncResult = await service.paperquaySyncFromZotero({
      dataDir: zoteroDir,
      itemKeys: ['PARENT_RL'],
      collectionKey: 'COLL_AI',
      createCollectionCategory: true,
    });
    assert.equal(syncResult.summary.importedCount, 1);
    assert.equal(syncResult.summary.duplicateCount, 0);
    assert.equal(syncResult.importedPapers[0].title, 'Reinforcement Learning at Scale');

    // 5. 验证入库后能够被普通 searchPapers 检索到
    const queryAfterSync = service.searchPapers({ query: 'Reinforcement' });
    assert.equal(queryAfterSync.total, 1);
    assert.equal(queryAfterSync.papers[0].title, 'Reinforcement Learning at Scale');

    // 6. 再次预检，PARENT_RL 应该变成 alreadyExists
    const previewAfter = await service.zoteroPreviewSync({
      dataDir: zoteroDir,
      itemKeys: ['PARENT_RL'],
    });
    assert.equal(previewAfter.summary.readyCount, 0);
    assert.equal(previewAfter.summary.alreadyExistsCount, 1);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(zoteroDir, { recursive: true, force: true });
  }
});
