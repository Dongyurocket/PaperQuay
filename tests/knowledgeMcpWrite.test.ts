import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { PaperQuayKnowledgeService } = require('../electron/mcp/knowledgeMcpService.cjs');
const { createLibraryStore } = require('../electron/backend/libraryStore.cjs');

// Windows 上杀毒/索引软件可能短暂持有临时目录句柄，重试后仍失败则由 OS 兜底清理，
// 不让清理失败阻塞测试结果（与 tests/knowledgeMcp.test.ts 一致）。
function cleanupDir(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error: any) {
    console.warn(`cleanup skipped for ${dir}: ${error?.code ?? error}`);
  }
}

interface Fixture {
  dir: string;
  storageDir: string;
  service: any;
}

// 用真实 createLibraryStore 初始化空文库（含全部 schema 与系统分类），
// 与生产写路径完全一致；isAppRunning 注入 false 以绕开进程检测。
function setupFixture(): Fixture {
  const dir = mkdtempSync(path.join(tmpdir(), 'paperquay-mcp-write-test-'));
  const storageDir = path.join(dir, 'storage');
  const store = createLibraryStore({ dataDir: dir, libraryDatabasePath: path.join(dir, 'paperquay-library.sqlite') });
  const library = store.load();
  library.settings.storageDir = storageDir;
  store.save(library);
  store.close();

  const service = new PaperQuayKnowledgeService({ dataDir: dir, isAppRunning: () => false });
  return { dir, storageDir, service };
}

function writeFakePdf(dir: string, name: string, marker = name): string {
  const filePath = path.join(dir, name);
  writeFileSync(filePath, `%PDF-1.4 fake test bytes ${marker}`);
  return filePath;
}

test('写护栏：桌面应用运行时拒绝全部写工具，allowWhileAppRunning 可强制覆盖', () => {
  const { dir, service } = setupFixture();
  const guarded = new PaperQuayKnowledgeService({ dataDir: dir, isAppRunning: () => true });
  try {
    assert.throws(() => guarded.manageCategory({ action: 'create', name: 'X' }), /正在运行，已拒绝写入/);
    assert.throws(() => guarded.importPdfs({ paths: ['a.pdf'] }), /正在运行，已拒绝写入/);
    assert.throws(() => guarded.updatePaper({ paperId: 'p1', title: 'T' }), /正在运行，已拒绝写入/);
    assert.throws(() => guarded.setPaperCategories({ paperIds: ['p1'], add: ['c1'] }), /正在运行，已拒绝写入/);
    assert.throws(() => guarded.deletePapers({ paperIds: ['p1'] }), /正在运行，已拒绝写入/);

    const created = guarded.manageCategory({ action: 'create', name: 'X', allowWhileAppRunning: true });
    assert.ok(created.category.id.startsWith('cat_'));

    // PAPERQUAY_MCP_WRITE=off 是全局只读开关，优先级高于 allowWhileAppRunning
    process.env.PAPERQUAY_MCP_WRITE = 'off';
    try {
      assert.throws(
        () => service.manageCategory({ action: 'create', name: 'Y', allowWhileAppRunning: true }),
        /PAPERQUAY_MCP_WRITE=off/,
      );
    } finally {
      delete process.env.PAPERQUAY_MCP_WRITE;
    }
  } finally {
    cleanupDir(dir);
  }
});

test('list_categories 返回系统分类与用户分类（含 paperCount）', () => {
  const { dir, service } = setupFixture();
  try {
    const empty = service.listCategories();
    assert.equal(empty.total, 4);
    assert.ok(empty.categories.every((category: any) => category.isSystem));
    assert.equal(empty.categories.find((category: any) => category.systemKey === 'all').paperCount, 0);

    service.manageCategory({ action: 'create', name: '旋翼气动' });
    const listed = service.listCategories();
    assert.equal(listed.total, 5);
    const created = listed.categories.find((category: any) => category.name === '旋翼气动');
    assert.equal(created.isSystem, false);
    assert.equal(created.parentId, null);
    assert.equal(created.paperCount, 0);
  } finally {
    cleanupDir(dir);
  }
});

test('import_pdfs 导入新文献：文件复制到 storageDir，元数据与分类正确落库', () => {
  const { dir, storageDir, service } = setupFixture();
  const pdfPath = writeFakePdf(dir, 'sample.pdf');
  try {
    const result = service.importPdfs({
      paths: [pdfPath],
      metadata: {
        [pdfPath]: {
          title: 'Tilt Rotor Aeroacoustics',
          titleZh: '倾转旋翼气动声学',
          authors: ['Alice Zhang', 'Bob Li'],
          year: '2024',
          doi: '10.1000/tilt',
          keywords: ['tilt-rotor', 'noise'],
          tags: ['rotorcraft'],
        },
      },
      categoryName: '过渡段建模与性能',
    });

    assert.equal(result.summary.importedCount, 1);
    assert.equal(result.importMode, 'copy');
    const paperId = result.imported[0].id;
    const storedPath = result.imported[0].storedPath;
    assert.ok(storedPath.startsWith(storageDir));
    assert.ok(existsSync(storedPath));
    assert.equal(readFileSync(storedPath, 'utf8'), readFileSync(pdfPath, 'utf8'));

    const details = service.getPaperDetails({ paperId });
    assert.equal(details.title, 'Tilt Rotor Aeroacoustics');
    assert.equal(details.titleZh, '倾转旋翼气动声学');
    assert.deepEqual(details.authors, ['Alice Zhang', 'Bob Li']);
    assert.deepEqual(details.keywords, ['tilt-rotor', 'noise']);
    assert.deepEqual(details.tags, ['rotorcraft']);
    assert.equal(details.doi, '10.1000/tilt');
    assert.deepEqual(details.categoryIds, [result.categoryId]);

    const listed = service.listCategories();
    const category = listed.categories.find((item: any) => item.id === result.categoryId);
    assert.equal(category.name, '过渡段建模与性能');
    assert.equal(category.paperCount, 1);
  } finally {
    cleanupDir(dir);
  }
});

test('import_pdfs 内容哈希查重：重复导入计入 duplicates，并补挂目标分类', () => {
  const { dir, service } = setupFixture();
  const first = writeFakePdf(dir, 'a.pdf', 'same-bytes');
  const second = writeFakePdf(dir, 'b.pdf', 'same-bytes');
  try {
    const firstResult = service.importPdfs({ paths: [first] });
    const paperId = firstResult.imported[0].id;

    const secondResult = service.importPdfs({ paths: [second], categoryName: '重复归组' });
    assert.equal(secondResult.summary.duplicateCount, 1);
    assert.equal(secondResult.summary.importedCount, 0);
    assert.equal(secondResult.duplicates[0].existingPaperId, paperId);

    const details = service.getPaperDetails({ paperId });
    assert.deepEqual(details.categoryIds, [secondResult.categoryId]);
  } finally {
    cleanupDir(dir);
  }
});

test('import_pdfs 参数校验：空 paths / 非 PDF / 分类参数互斥 / 系统分类拒绝', () => {
  const { dir, service } = setupFixture();
  const txtPath = path.join(dir, 'notes.txt');
  writeFileSync(txtPath, 'not a pdf');
  try {
    assert.throws(() => service.importPdfs({ paths: [] }), /non-empty array/);
    assert.throws(
      () => service.importPdfs({ paths: ['x.pdf'], targetCategoryId: 'c1', categoryName: 'N' }),
      /mutually exclusive/,
    );
    assert.throws(() => service.importPdfs({ paths: ['x.pdf'], importMode: 'link' }), /copy, move, keep/);
    assert.throws(
      () => service.importPdfs({ paths: ['x.pdf'], targetCategoryId: 'system-all' }),
      /系统分类/,
    );
    const result = service.importPdfs({ paths: [txtPath] });
    assert.equal(result.summary.failedCount, 1);
    assert.match(result.errors[0].error, /Only PDF files can be imported/);
  } finally {
    cleanupDir(dir);
  }
});

test('update_paper 白名单更新；未知字段与不存在的文献显式报错', () => {
  const { dir, service } = setupFixture();
  const pdfPath = writeFakePdf(dir, 'u.pdf');
  try {
    const imported = service.importPdfs({ paths: [pdfPath] });
    const paperId = imported.imported[0].id;

    const updated = service.updatePaper({
      paperId,
      title: 'Updated Title',
      titleZh: '更新后的标题',
      authors: ['Carol'],
      keywords: ['k1'],
      tags: ['t1'],
      isFavorite: true,
      year: '2020',
    });
    assert.equal(updated.paper.title, 'Updated Title');

    const details = service.getPaperDetails({ paperId });
    assert.equal(details.titleZh, '更新后的标题');
    assert.deepEqual(details.authors, ['Carol']);
    assert.deepEqual(details.keywords, ['k1']);
    assert.deepEqual(details.tags, ['t1']);
    assert.equal(details.isFavorite, true);
    assert.equal(details.year, '2020');

    assert.throws(() => service.updatePaper({ paperId, rating: 5 } as any), /Unsupported update fields: rating/);
    assert.throws(() => service.updatePaper({ paperId } as any), /No fields to update/);
    assert.throws(() => service.updatePaper({ paperId: 'paper_missing', title: 'X' }), /Paper does not exist/);
  } finally {
    cleanupDir(dir);
  }
});

test('set_paper_categories 支持 add/remove/replace，拒绝系统分类与缺失文献', () => {
  const { dir, service } = setupFixture();
  const pdfPath = writeFakePdf(dir, 'c.pdf');
  try {
    const paperId = service.importPdfs({ paths: [pdfPath] }).imported[0].id;
    const catA = service.manageCategory({ action: 'create', name: 'A' }).category.id;
    const catB = service.manageCategory({ action: 'create', name: 'B' }).category.id;

    const added = service.setPaperCategories({ paperIds: [paperId], add: [catA, catB] });
    assert.deepEqual(added.updated[0].categoryIds, [catA, catB]);

    const removed = service.setPaperCategories({ paperIds: [paperId], remove: [catA] });
    assert.deepEqual(removed.updated[0].categoryIds, [catB]);

    const replaced = service.setPaperCategories({ paperIds: [paperId], replace: [catA] });
    assert.deepEqual(replaced.updated[0].categoryIds, [catA]);

    assert.throws(
      () => service.setPaperCategories({ paperIds: [paperId], add: ['system-favorites'] }),
      /系统分类不可手动分配/,
    );
    assert.throws(
      () => service.setPaperCategories({ paperIds: ['paper_missing'], add: [catA] }),
      /Paper does not exist/,
    );
    assert.throws(
      () => service.setPaperCategories({ paperIds: [paperId], add: [catA], replace: [catB] }),
      /cannot be combined/,
    );
    // 失败的操作不得留下部分写入
    assert.deepEqual(service.getPaperDetails({ paperId }).categoryIds, [catA]);
  } finally {
    cleanupDir(dir);
  }
});

test('manage_category 全生命周期：create/rename/move/delete，含环检测与系统分类保护', () => {
  const { dir, service } = setupFixture();
  const pdfPath = writeFakePdf(dir, 'm.pdf');
  try {
    const paperId = service.importPdfs({ paths: [pdfPath] }).imported[0].id;
    const catA = service.manageCategory({ action: 'create', name: '气动' }).category.id;
    const catB = service.manageCategory({ action: 'create', name: '噪声', parentId: catA }).category.id;

    const renamed = service.manageCategory({ action: 'rename', categoryId: catA, name: '旋翼气动' });
    assert.equal(renamed.category.name, '旋翼气动');

    assert.throws(() => service.manageCategory({ action: 'move', categoryId: catA, parentId: catB }), /子分类之下/);
    assert.throws(() => service.manageCategory({ action: 'move', categoryId: catA, parentId: catA }), /自身之下/);
    assert.throws(() => service.manageCategory({ action: 'rename', categoryId: 'system-all', name: 'X' }), /系统分类/);
    assert.throws(() => service.manageCategory({ action: 'create', name: 'X', parentId: 'system-all' }), /系统分类/);
    assert.throws(() => service.manageCategory({ action: 'merge', categoryId: catA } as any), /action must be one of/);

    service.setPaperCategories({ paperIds: [paperId], add: [catB] });
    const deleted = service.manageCategory({ action: 'delete', categoryId: catA });
    assert.deepEqual(deleted.deletedCategoryIds.sort(), [catA, catB].sort());
    assert.deepEqual(service.getPaperDetails({ paperId }).categoryIds, []);
    assert.equal(service.listCategories().total, 4);
  } finally {
    cleanupDir(dir);
  }
});

test('delete_papers 默认保留文件，deleteFiles=true 时删除库内文件', () => {
  const { dir, service } = setupFixture();
  const pdfA = writeFakePdf(dir, 'keep.pdf');
  const pdfB = writeFakePdf(dir, 'remove.pdf');
  try {
    const paperA = service.importPdfs({ paths: [pdfA] }).imported[0];
    const paperB = service.importPdfs({ paths: [pdfB] }).imported[0];

    const kept = service.deletePapers({ paperIds: [paperA.id] });
    assert.equal(kept.total, 1);
    assert.equal(kept.deletedFileCount, 0);
    assert.ok(existsSync(paperA.storedPath));
    assert.equal(service.getPaperDetails({ paperId: paperA.id }), null);

    const removed = service.deletePapers({ paperIds: [paperB.id], deleteFiles: true });
    assert.equal(removed.deletedFileCount, 1);
    assert.ok(!existsSync(paperB.storedPath));

    assert.throws(() => service.deletePapers({ paperIds: ['paper_missing'] }), /Paper does not exist/);
  } finally {
    cleanupDir(dir);
  }
});

test('search_papers 支持 categoryId（含后代分类），get_paper_details 返回 categoryIds', () => {
  const { dir, service } = setupFixture();
  const pdfIn = writeFakePdf(dir, 'in.pdf');
  const pdfOut = writeFakePdf(dir, 'out.pdf');
  try {
    const parent = service.manageCategory({ action: 'create', name: '飞行器设计' }).category.id;
    const child = service.manageCategory({ action: 'create', name: '总体设计', parentId: parent }).category.id;

    const paperIn = service.importPdfs({ paths: [pdfIn], targetCategoryId: child }).imported[0].id;
    service.importPdfs({ paths: [pdfOut] });

    const byParent = service.searchPapers({ categoryId: parent });
    assert.equal(byParent.total, 1);
    assert.equal(byParent.papers[0].id, paperIn);

    const byChild = service.searchPapers({ categoryId: child });
    assert.equal(byChild.total, 1);

    const uncategorized = service.searchPapers({ categoryId: 'system-uncategorized' });
    assert.equal(uncategorized.total, 1);

    const all = service.searchPapers({ categoryId: 'system-all' });
    assert.equal(all.total, 2);

    assert.throws(() => service.searchPapers({ categoryId: 'cat_missing' }), /Category does not exist/);

    const details = service.getPaperDetails({ paperId: paperIn });
    assert.deepEqual(details.categoryIds, [child]);
  } finally {
    cleanupDir(dir);
  }
});
