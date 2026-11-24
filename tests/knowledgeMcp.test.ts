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
const { hashString } = require('../src/shared/mineruCachePaths.cjs');

// Windows 上杀毒/索引软件可能短暂持有临时目录句柄，重试后仍失败则由 OS 兜底清理，
// 不让清理失败阻塞测试结果。
function cleanupDir(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error: any) {
    console.warn(`cleanup skipped for ${dir}: ${error?.code ?? error}`);
  }
}

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
      sort_order INTEGER NOT NULL,
      rag_enabled INTEGER NOT NULL DEFAULT 1
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
    CREATE TABLE paper_categories (
      paper_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      PRIMARY KEY (paper_id, category_id)
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
    UPDATE papers SET rag_enabled = 0 WHERE id = 'paper-2';
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
    assert.equal(searchByTitle.papers[0].ragEnabled, true);
    assert.equal(searchByTitle.papers[0].titleZh, '注意力即所需');
    assert.deepEqual(searchByTitle.papers[0].tags, ['transformer']);

    const searchByZh = service.searchPapers({ query: '残差' });
    assert.equal(searchByZh.total, 1);
    assert.equal(searchByZh.papers[0].id, 'paper-2');
    assert.equal(searchByZh.papers[0].ragEnabled, false);

    // 读取详情
    const details = service.getPaperDetails({ paperId: 'paper-1' });
    assert.ok(details);
    assert.equal(details.title, 'Attention Is All You Need');
    assert.deepEqual(details.authors, ['Ashish Vaswani']);
    assert.equal(details.isFavorite, true);
    assert.equal(details.ragEnabled, true);
    assert.equal(service.getPaperDetails({ paperId: 'paper-2' }).ragEnabled, false);
  } finally {
    cleanupDir(dataDir);
  }
});

test('PaperQuayKnowledgeService searches knowledge base chunks with citations', async () => {
  const dataDir = setupTestEnvironment();
  try {
    const service = new PaperQuayKnowledgeService({ dataDir });

    // 知识库分块检索
    const ragResult = await service.searchKnowledgeBase({ query: 'multi-head attention' });
    assert.ok(ragResult.total > 0);
    assert.equal(ragResult.retrievalMode, 'keyword');
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
    cleanupDir(dataDir);
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
    assert.equal(initRes.result.serverInfo.version, require('../package.json').version);
    assert.ok(initRes.result.capabilities.tools);

    // 2. tools/list
    const listRes = (await call(2, 'tools/list', {})) as any;
    const toolNames = listRes.result.tools.map((t: any) => t.name);
    assert.ok(toolNames.includes('search_papers'));
    assert.ok(toolNames.includes('get_paper_details'));
    assert.ok(toolNames.includes('search_knowledge_base'));
    assert.ok(toolNames.includes('read_paper_content'));
    assert.ok(toolNames.includes('search_notes'));
    assert.ok(toolNames.includes('get_note'));
    assert.ok(toolNames.includes('zotero_list_collections'));
    assert.ok(toolNames.includes('zotero_search_items'));
    assert.ok(toolNames.includes('zotero_preview_sync'));
    assert.ok(toolNames.includes('paperquay_sync_from_zotero'));
    assert.ok(toolNames.includes('import_pdfs'));
    assert.ok(toolNames.includes('list_categories'));
    assert.ok(toolNames.includes('manage_category'));
    assert.ok(toolNames.includes('set_paper_categories'));
    assert.ok(toolNames.includes('update_paper'));
    assert.ok(toolNames.includes('delete_papers'));
    assert.ok(toolNames.includes('attach_translated_pdf'));
    assert.ok(toolNames.includes('remove_translated_pdf'));
    assert.equal(new Set(toolNames).size, toolNames.length);
    const detailsSchema = listRes.result.tools.find((tool: any) => tool.name === 'get_paper_details').inputSchema;
    assert.equal(detailsSchema.properties.pageKind, undefined);
    const createNoteSchema = listRes.result.tools.find((tool: any) => tool.name === 'create_note').inputSchema;
    assert.equal(createNoteSchema.properties.pageKind.type, 'string');
    const updateNoteSchema = listRes.result.tools.find((tool: any) => tool.name === 'update_note').inputSchema;
    assert.equal(updateNoteSchema.properties.pageKind.type, 'string');
    assert.deepEqual(updateNoteSchema.properties.pageKind.enum, [
      '',
      'paper-card',
      'concept',
      'synthesis',
      'qa',
      'excerpt',
      'index',
      'log',
      'overview',
    ]);

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
    cleanupDir(dataDir);
  }
});

// 在基础 fixture 上补充向量索引（rag_vec_dimensions + rag_indexes + vec0 表）与 embedding 配置。
function setupVectorFixture(dataDir: string) {
  const sqliteVec = require('sqlite-vec');
  const ragDbPath = path.join(dataDir, 'paperquay-rag.sqlite');
  const db = new DatabaseSync(ragDbPath, { allowExtension: true });
  db.enableLoadExtension(true);
  db.loadExtension(sqliteVec.getLoadablePath());
  db.enableLoadExtension(false);

  db.exec(`
    CREATE TABLE rag_vec_dimensions (dimension INTEGER PRIMARY KEY);
    INSERT INTO rag_vec_dimensions (dimension) VALUES (4);
    CREATE TABLE rag_indexes (
      document_key TEXT NOT NULL,
      source_type TEXT NOT NULL,
      status TEXT NOT NULL,
      embedding_model_key TEXT NOT NULL,
      embedding_dimension INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL
    );
    INSERT INTO rag_indexes VALUES
      ('paper-1', 'mineru-markdown', 'ready', 'http://localhost:11434/v1::test-embed::4', 4, 1),
      ('paper-2', 'mineru-markdown', 'ready', 'http://localhost:11434/v1::test-embed::4', 4, 2);
  `);
  db.exec(`
    CREATE VIRTUAL TABLE rag_vec_4 USING vec0(
      document_key TEXT partition key,
      source_type TEXT partition key,
      embedding float[4]
    );
  `);
  const insert = db.prepare(
    'INSERT INTO rag_vec_4 (rowid, document_key, source_type, embedding) VALUES (?, ?, ?, ?)',
  );
  // rowid 与 rag_chunks.id 对齐：c-1=1（Transformer 概述）、c-2=2（multi-head attention）、c-3=3（residual）
  // vec0 要求 rowid 严格为整数类型，node:sqlite 下 JS number 会绑定为 REAL，必须用 BigInt。
  insert.run(1n, 'paper-1', 'mineru-markdown', new Float32Array([1, 0, 0, 0]));
  insert.run(2n, 'paper-1', 'mineru-markdown', new Float32Array([0, 1, 0, 0]));
  insert.run(3n, 'paper-2', 'mineru-markdown', new Float32Array([0, 0, 1, 0]));
  db.close();

  const settingsDir = path.join(dataDir, '.settings');
  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(path.join(settingsDir, 'paperquay.config.json'), JSON.stringify({
    version: 1,
    settings: {
      embeddingBaseUrl: 'http://localhost:11434/v1',
      embeddingModel: 'test-embed',
      embeddingDimensions: 4,
    },
    secrets: { embeddingApiKey: 'test-key' },
  }));
}

test('RAG retrieval excludes disabled papers even when their old chunks remain', async () => {
  const dataDir = setupTestEnvironment();
  try {
    setupVectorFixture(dataDir);
    const service = new PaperQuayKnowledgeService({ dataDir, embedFn: async () => [0, 0, 1, 0] });
    for (const mode of ['keyword', 'hybrid']) {
      const result = await service.searchKnowledgeBase({ query: 'residual', mode });
      assert.ok(result.results.every((item: any) => item.paperId !== 'paper-2'));
      const scoped = await service.searchKnowledgeBase({ query: 'residual', mode, paperId: 'paper-2' });
      assert.equal(scoped.total, 0);
    }
    assert.equal(service.readPaperContent({ paperId: 'paper-2' }).total, 0);
  } finally {
    cleanupDir(dataDir);
  }
});

test('RAG retrieval rechecks exclusions after an asynchronous embedding request', async () => {
  const dataDir = setupTestEnvironment();
  try {
    setupVectorFixture(dataDir);
    const service = new PaperQuayKnowledgeService({
      dataDir,
      embedFn: async () => {
        const db = new DatabaseSync(path.join(dataDir, 'paperquay-library.sqlite'));
        try {
          db.prepare('UPDATE papers SET rag_enabled = 0 WHERE id = ?').run('paper-1');
        } finally {
          db.close();
        }
        return [1, 0, 0, 0];
      },
    });
    const result = await service.searchKnowledgeBase({ query: 'attention', mode: 'hybrid' });
    assert.equal(result.total, 0);
  } finally {
    cleanupDir(dataDir);
  }
});

test('keyword and LIKE searches handle large exclusion sets', async () => {
  const dataDir = setupTestEnvironment();
  try {
    const service = new PaperQuayKnowledgeService({ dataDir });
    const excluded = new Set(Array.from({ length: 33000 }, (_, index) => `excluded-${index}`));
    service.getExcludedPaperIds = () => excluded;
    const fts = await service.searchKnowledgeBase({ query: 'Transformer', mode: 'keyword' });
    assert.equal(fts.results[0].paperId, 'paper-1');
    const like = await service.searchKnowledgeBase({ query: 'multi-head attention allows', mode: 'keyword' });
    assert.ok(like.results.some((item: any) => item.paperId === 'paper-1'));
  } finally {
    cleanupDir(dataDir);
  }
});

test('search and paper reading do not return pending or failed index chunks', async () => {
  const dataDir = setupTestEnvironment();
  try {
    setupVectorFixture(dataDir);
    const rag = new DatabaseSync(path.join(dataDir, 'paperquay-rag.sqlite'));
    rag.prepare('UPDATE rag_indexes SET status = ? WHERE document_key = ?').run('pending', 'paper-1');
    rag.close();
    const service = new PaperQuayKnowledgeService({ dataDir, embedFn: async () => [1, 0, 0, 0] });
    for (const mode of ['keyword', 'hybrid']) {
      for (const query of ['Transformer', 'ransforme']) {
        const result = await service.searchKnowledgeBase({ query, paperId: 'paper-1', mode });
        assert.equal(result.total, 0);
      }
    }
    assert.equal(service.readPaperContent({ paperId: 'paper-1' }).total, 0);
  } finally {
    cleanupDir(dataDir);
  }
});

test('keyword hits are rechecked if an index becomes pending during embedding', async () => {
  const dataDir = setupTestEnvironment();
  try {
    setupVectorFixture(dataDir);
    const service = new PaperQuayKnowledgeService({ dataDir, embedFn: async () => {
      const rag = new DatabaseSync(path.join(dataDir, 'paperquay-rag.sqlite'));
      rag.prepare('UPDATE rag_indexes SET status = ? WHERE document_key = ?').run('pending', 'paper-1');
      rag.close();
      return [1, 0, 0, 0];
    } });
    const result = await service.searchKnowledgeBase({ query: 'Transformer', mode: 'hybrid' });
    assert.equal(result.total, 0);
  } finally {
    cleanupDir(dataDir);
  }
});

test('keyword hits are discarded when a ready source replaces a chunk during embedding', async () => {
  const dataDir = setupTestEnvironment();
  try {
    setupVectorFixture(dataDir);
    const service = new PaperQuayKnowledgeService({ dataDir, embedFn: async () => {
      const rag = new DatabaseSync(path.join(dataDir, 'paperquay-rag.sqlite'));
      rag.prepare('UPDATE rag_chunks SET text = ? WHERE id = 1').run('Replacement evidence');
      rag.close();
      return [1, 0, 0, 0];
    } });
    const result = await service.searchKnowledgeBase({ query: 'Transformer', mode: 'hybrid' });
    const replacement = result.results.find((item: any) => item.blockId === 'b-1');
    assert.ok(replacement);
    assert.deepEqual(replacement.channels, ['vector']);
    assert.match(replacement.snippet, /Replacement evidence/);
    assert.doesNotMatch(replacement.snippet, /We propose the Transformer/);
  } finally {
    cleanupDir(dataDir);
  }
});

test('hybrid search does not mix vectors from different embedding models', async () => {
  const dataDir = setupTestEnvironment();
  try {
    setupVectorFixture(dataDir);
    const library = new DatabaseSync(path.join(dataDir, 'paperquay-library.sqlite'));
    library.prepare('UPDATE papers SET rag_enabled = 1 WHERE id = ?').run('paper-2');
    library.close();
    const rag = new DatabaseSync(path.join(dataDir, 'paperquay-rag.sqlite'));
    rag.prepare('UPDATE rag_indexes SET embedding_model_key = ? WHERE document_key = ?')
      .run('http://localhost:11434/v1::other-model::4', 'paper-2');
    rag.close();
    const service = new PaperQuayKnowledgeService({ dataDir, embedFn: async () => [0, 0, 1, 0] });
    const mixed = await service.searchKnowledgeBase({ query: 'nonexistentkeyword', mode: 'hybrid' });
    assert.equal(mixed.retrievalMode, 'hybrid');
    assert.ok(mixed.results.length > 0);
    assert.ok(mixed.results.every((item: any) => item.paperId === 'paper-1'));

    const changed = new DatabaseSync(path.join(dataDir, 'paperquay-rag.sqlite'));
    changed.prepare('UPDATE rag_indexes SET embedding_model_key = ?').run('http://localhost:11434/v1::other-model::4');
    changed.close();
    const incompatible = await service.searchKnowledgeBase({ query: 'attention', mode: 'hybrid' });
    assert.equal(incompatible.retrievalMode, 'keyword');
    assert.match(incompatible.warning, /模型/);
    assert.ok(incompatible.results.every((item: any) => !item.channels.includes('vector')));
  } finally {
    cleanupDir(dataDir);
  }
});

test('MCP vector retrieval does not lose matching sources to closer incompatible vectors', async () => {
  const dataDir = setupTestEnvironment();
  try {
    setupVectorFixture(dataDir);
    const sqliteVec = require('sqlite-vec');
    const rag = new DatabaseSync(path.join(dataDir, 'paperquay-rag.sqlite'), { allowExtension: true });
    rag.enableLoadExtension(true);
    rag.loadExtension(sqliteVec.getLoadablePath());
    rag.enableLoadExtension(false);
    rag.prepare('INSERT INTO rag_indexes VALUES (?, ?, ?, ?, ?, ?)')
      .run('paper-1', 'pdf-text', 'ready', 'http://localhost:11434/v1::other-model::4', 4, 3);
    const insertChunk = rag.prepare('INSERT INTO rag_chunks (id, document_key, source_type, chunk_id, chunk_index, text) VALUES (?, ?, ?, ?, ?, ?)');
    const insertVector = rag.prepare('INSERT INTO rag_vec_4 (rowid, document_key, source_type, embedding) VALUES (?, ?, ?, ?)');
    rag.exec('BEGIN');
    for (let index = 0; index < 40; index += 1) {
      const id = BigInt(index + 10);
      insertChunk.run(id, 'paper-1', 'pdf-text', `foreign-${index}`, index, 'unrelated');
      insertVector.run(id, 'paper-1', 'pdf-text', new Float32Array([0, 0, 1, 0]));
    }
    rag.exec('COMMIT');
    rag.close();
    const service = new PaperQuayKnowledgeService({ dataDir, embedFn: async () => [0, 0, 1, 0] });
    for (const paperId of ['', 'paper-1']) {
      const result = await service.searchKnowledgeBase({ query: 'nonexistentkeyword', mode: 'hybrid', paperId, limit: 2 });
      assert.equal(result.retrievalMode, 'hybrid');
      assert.equal(result.total, 2);
      assert.ok(result.results.every((item: any) => item.paperId === 'paper-1' && item.sourceType === 'mineru-markdown'));
    }
  } finally {
    cleanupDir(dataDir);
  }
});

test('hybrid search attributes channels to the correct paper when chunk IDs repeat', async () => {
  const dataDir = setupTestEnvironment();
  try {
    setupVectorFixture(dataDir);
    const library = new DatabaseSync(path.join(dataDir, 'paperquay-library.sqlite'));
    library.prepare('UPDATE papers SET rag_enabled = 1 WHERE id = ?').run('paper-2');
    library.close();
    const service = new PaperQuayKnowledgeService({ dataDir, embedFn: async () => [1, 0, 0, 0] });
    service.retrieveVectorChunks = () => ({ rows: [{ paperId: 'paper-2', chunkId: 'c-1',
      sourceType: 'mineru-markdown', pageIndex: 0, blockId: 'b-3', text: 'Residual evidence', score: 0 }], truncated: false });
    const result = await service.searchKnowledgeBase({ query: 'transformer', mode: 'hybrid' });
    assert.deepEqual(result.results.find((item: any) => item.paperId === 'paper-1')?.channels, ['fts']);
    assert.deepEqual(result.results.find((item: any) => item.paperId === 'paper-2')?.channels, ['vector']);
  } finally {
    cleanupDir(dataDir);
  }
});

test('PaperQuayKnowledgeService fuses vector and FTS channels in hybrid mode', async () => {
  const dataDir = setupTestEnvironment();
  try {
    setupVectorFixture(dataDir);
    const embedCalls: string[] = [];
    const service = new PaperQuayKnowledgeService({
      dataDir,
      embedFn: async (text: string) => {
        embedCalls.push(text);
        return [1, 0, 0, 0]; // 与 c-1 的向量完全一致
      },
    });

    const result = await service.searchKnowledgeBase({ query: 'multi-head attention' });
    assert.equal(result.retrievalMode, 'hybrid');
    assert.equal(result.embeddingModel, 'test-embed');
    assert.equal(embedCalls.length, 1);
    assert.ok(result.results.length > 0);

    const c1 = result.results.find((row: any) => row.blockId === 'b-1');
    const c2 = result.results.find((row: any) => row.blockId === 'b-2');
    // c-1 向量距离为 0（向量通道第一）且 FTS 也命中 attention，双通道融合后应排第一
    assert.ok(c1, 'expected the Transformer overview chunk in results');
    assert.deepEqual([...c1.channels].sort(), ['fts', 'vector']);
    assert.ok(c2, 'expected the multi-head attention chunk in results');
    assert.ok(c2.channels.includes('fts'));
    assert.equal(result.results[0].blockId, 'b-1');

    // keyword 模式不触发 embedding 请求
    const keywordResult = await service.searchKnowledgeBase({ query: 'multi-head attention', mode: 'keyword' });
    assert.equal(keywordResult.retrievalMode, 'keyword');
    assert.equal(embedCalls.length, 1);
    assert.ok(keywordResult.results.length > 0);
  } finally {
    cleanupDir(dataDir);
  }
});

test('PaperQuayKnowledgeService degrades to keyword retrieval when embedding fails or mismatches', async () => {
  const dataDir = setupTestEnvironment();
  try {
    setupVectorFixture(dataDir);

    // embedding 接口失败：降级为关键词检索并给出 warning
    const failingService = new PaperQuayKnowledgeService({
      dataDir,
      embedFn: async () => {
        throw new Error('embedding endpoint unreachable');
      },
    });
    const degraded = await failingService.searchKnowledgeBase({ query: 'multi-head attention' });
    assert.equal(degraded.retrievalMode, 'keyword');
    assert.match(degraded.warning, /向量检索失败/);
    assert.ok(degraded.results.length > 0);

    // 查询向量维度与索引不一致：降级并给出 warning
    const mismatchService = new PaperQuayKnowledgeService({
      dataDir,
      embedFn: async () => [1, 0, 0],
    });
    const mismatched = await mismatchService.searchKnowledgeBase({ query: 'multi-head attention' });
    assert.equal(mismatched.retrievalMode, 'keyword');
    assert.match(mismatched.warning, /维度/);
  } finally {
    cleanupDir(dataDir);
  }
});

test('PaperQuayKnowledgeService reports a warning for hybrid mode without embedding config', async () => {
  const dataDir = setupTestEnvironment();
  try {
    const service = new PaperQuayKnowledgeService({ dataDir });
    const result = await service.searchKnowledgeBase({ query: 'multi-head attention', mode: 'hybrid' });
    assert.equal(result.retrievalMode, 'keyword');
    assert.match(result.warning, /Embedding/);
    assert.ok(result.results.length > 0);
  } finally {
    cleanupDir(dataDir);
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

  const service = new PaperQuayKnowledgeService({ dataDir, isAppRunning: () => false });

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
    cleanupDir(dataDir);
    cleanupDir(zoteroDir);
  }
});

test('search_knowledge_base retrieves formula chunks for mixed Chinese-English queries and bridges captions', async () => {
  const dataDir = setupTestEnvironment();
  try {
    const rag = new DatabaseSync(path.join(dataDir, 'paperquay-rag.sqlite'));
    rag.exec(`
      DELETE FROM rag_chunks WHERE document_key = 'paper-1';
      INSERT INTO rag_chunks (document_key, source_type, chunk_id, chunk_index, page_index, block_id, text)
      VALUES
        ('paper-1', 'mineru-markdown', 'm-1', 0, 5, 'p6-16', 'Post-stall performance uses Eqs. 5-7 [18].'),
        ('paper-1', 'mineru-markdown', 'm-2', 1, 6, 'p7-1', '(a) twin-tiltrotor'),
        ('paper-1', 'mineru-markdown', 'm-3', 2, 6, 'p7-2', '(b) quad-tiltrotor'),
        ('paper-1', 'mineru-markdown', 'm-4', 3, 6, 'p7-6', 'C _{m} = - 0. 5 \\sin (\\alpha - \\alpha_{0}) + 0. 1 1 \\sin 2 (\\alpha - \\alpha_{0}),\\tag{6}');
    `);
    rag.close();

    const service = new PaperQuayKnowledgeService({ dataDir });
    const res = await service.searchKnowledgeBase({
      paperId: 'paper-1',
      query: '公式(6)，cm的计算公式是哪里来的',
      mode: 'keyword',
    });

    assert.ok(res.total > 0);
    assert.ok(res.results.some((item: any) => item.blockId === 'p7-6'));
    const eqHit = res.results.find((item: any) => item.blockId === 'p7-6');
    assert.match(eqHit.snippet, /Eqs\. 5-7/);
    assert.match(eqHit.snippet, /\\tag\{6\}/);
  } finally {
    cleanupDir(dataDir);
  }
});

test('read_paper_figure rejects image assets outside the current MinerU cache directory', () => {
  const dataDir = setupTestEnvironment();
  try {
    const cacheDir = path.join(dataDir, '.mineru-cache', `document-${hashString('paper-1')}`);
    mkdirSync(path.join(cacheDir, 'images'), { recursive: true });
    const outside = path.join(dataDir, 'outside.png');
    writeFileSync(outside, Buffer.from('89504e470d0a1a0a', 'hex'));
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    writeFileSync(path.join(cacheDir, 'images', 'figure.png'), png);
    const writeContentList = (assetPath: string) => writeFileSync(
      path.join(cacheDir, 'content_list_v2.json'),
      JSON.stringify([[
        { type: 'image', content: { image_source: { path: assetPath }, image_caption: [{ content: 'Figure' }] } },
      ]]),
      'utf8',
    );
    const service = new PaperQuayKnowledgeService({ dataDir });
    const rejected = [
      outside,
      path.join(cacheDir, 'images', 'figure.png'),
      String.raw`\\127.0.0.1\nonexistent-share\secret.png`,
      String.raw`..\outside.png`,
      'images/../../outside.png',
      String.raw`C:\Windows\win.ini`,
      String.raw`images\figure.png:stream`,
    ];
    for (const assetPath of rejected) {
      writeContentList(assetPath);
      const result = service.readPaperFigure({ paperId: 'paper-1', blockId: 'page-1-block-1' });
      assert.equal(result.found, true);
      assert.equal(result.imageAvailable, false, `asset must be rejected: ${assetPath}`);
      assert.match(result.note, /invalid|outside the MinerU cache directory/i, `rejected=${JSON.stringify(assetPath)} note=${result.note}`);
    }

    writeContentList('images/figure.png');
    const valid = service.readPaperFigure({ paperId: 'paper-1', blockId: 'page-1-block-1' });
    assert.equal(valid.imageAvailable, true);
    assert.equal(Buffer.from(valid.base64, 'base64').toString('hex'), png.toString('hex'));
  } finally {
    cleanupDir(dataDir);
  }
});
