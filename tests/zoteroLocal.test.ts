import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');
const { DatabaseSync } = require('../electron/backend/nodeSqlite.cjs');
const {
  listLocalCollections,
  listLocalCollectionItems,
  listLocalLibraryItems,
  getLocalItemsByKeys,
  searchLocalLibraryItems,
} = require('../electron/backend/zoteroLocal.cjs');

function prefsString(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

async function createZoteroFixture(count: number) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-zotero-test-'));
  const SQL = await initSqlJs({
    locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm'),
  });
  const db = new SQL.Database();

  db.run(`
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
  db.run("insert into itemTypes values (1, 'journalArticle'), (2, 'attachment')");
  db.run("insert into fields values (1, 'title'), (2, 'date')");
  db.run("insert into collections values (10, 'COLL', 'Collection', null)");

  for (let index = 1; index <= count; index += 1) {
    const parentId = index;
    const attachmentId = 1000 + index;
    const parentKey = `PARENT_${index}`;
    const attachmentKey = `ATT_${index}`;
    const filename = `paper-${index}.pdf`;
    const storageDir = path.join(dataDir, 'storage', attachmentKey);

    mkdirSync(storageDir, { recursive: true });
    writeFileSync(path.join(storageDir, filename), '%PDF-1.7\n');

    db.run(`insert into items values (${parentId}, '${parentKey}', 1, '2026-01-01')`);
    db.run(`insert into items values (${attachmentId}, '${attachmentKey}', 2, '2026-01-01')`);
    db.run(`insert into itemAttachments values (${attachmentId}, ${parentId}, 'application/pdf', 'storage:${filename}')`);
    db.run(`insert into collectionItems values (10, ${parentId})`);
    db.run(`insert into itemDataValues values (${index}, 'Paper ${index}')`);
    db.run(`insert into itemData values (${parentId}, 1, ${index})`);
  }

  db.run("insert into deletedItems values (1001, '2026-01-02')");
  writeFileSync(path.join(dataDir, 'zotero.sqlite'), Buffer.from(db.export()));
  db.close();

  return dataDir;
}

async function createLinkedAttachmentFixture() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-zotero-test-'));
  const linkedBaseDir = mkdtempSync(path.join(tmpdir(), 'paperquay-zotero-linked-'));
  const linkedPdfPath = path.join(linkedBaseDir, 'nested', 'linked.pdf');
  const SQL = await initSqlJs({
    locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm'),
  });
  const db = new SQL.Database();

  mkdirSync(path.dirname(linkedPdfPath), { recursive: true });
  writeFileSync(linkedPdfPath, '%PDF-1.7\n');
  writeFileSync(
    path.join(dataDir, 'prefs.js'),
    `user_pref("extensions.zotero.baseAttachmentPath", "${prefsString(linkedBaseDir)}");\n`,
  );

  db.run(`
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
  db.run("insert into itemTypes values (1, 'journalArticle'), (2, 'attachment')");
  db.run("insert into fields values (1, 'title'), (2, 'date')");
  db.run("insert into collections values (10, 'COLL', 'Collection', null)");
  db.run('insert into items values (?, ?, 1, ?)', [1, 'PARENT_LINKED', '2026-01-01']);
  db.run('insert into items values (?, ?, 2, ?)', [2, 'ATT_LINKED', '2026-01-01']);
  db.run('insert into itemAttachments values (?, ?, ?, ?)', [
    2,
    1,
    null,
    'attachments:nested/linked.pdf',
  ]);
  db.run('insert into collectionItems values (10, 1)');

  writeFileSync(path.join(dataDir, 'zotero.sqlite'), Buffer.from(db.export()));
  db.close();

  return { dataDir, linkedBaseDir, linkedPdfPath };
}

test('local Zotero queries return all PDFs by default and still support explicit limits', async () => {
  const dataDir = await createZoteroFixture(405);

  try {
    const allItems = await listLocalLibraryItems({ dataDir });
    const limitedItems = await listLocalLibraryItems({ dataDir, limit: 10 });
    const collectionItems = await listLocalCollectionItems({ dataDir, collectionKey: 'COLL' });
    const collections = await listLocalCollections({ dataDir });

    assert.equal(allItems.length, 404);
    assert.equal(limitedItems.length, 10);
    assert.equal(collectionItems.length, 404);
    assert.equal(collections[0].itemCount, 404);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('local Zotero queries resolve linked attachment base paths and pdf extensions', async () => {
  const { dataDir, linkedBaseDir, linkedPdfPath } = await createLinkedAttachmentFixture();

  try {
    const collectionItems = await listLocalCollectionItems({ dataDir, collectionKey: 'COLL' });
    const libraryItems = await listLocalLibraryItems({ dataDir });

    assert.equal(collectionItems.length, 1);
    assert.equal(collectionItems[0].localPdfPath, linkedPdfPath);
    assert.equal(collectionItems[0].attachmentFilename, 'linked.pdf');
    assert.equal(libraryItems.length, 1);
    assert.equal(libraryItems[0].localPdfPath, linkedPdfPath);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(linkedBaseDir, { recursive: true, force: true });
  }
});

test('local Zotero queries support getLocalItemsByKeys and searchLocalLibraryItems', async () => {
  const dataDir = await createZoteroFixture(20);

  try {
    const keysResult = await getLocalItemsByKeys({
      dataDir,
      itemKeys: ['PARENT_2', 'PARENT_5', 'UNKNOWN_KEY'],
    });
    assert.equal(keysResult.length, 2);
    assert.ok(keysResult.some((item: any) => item.itemKey === 'PARENT_2'));
    assert.ok(keysResult.some((item: any) => item.itemKey === 'PARENT_5'));

    const searchResult = await searchLocalLibraryItems({
      dataDir,
      query: 'Paper 15',
    });
    assert.equal(searchResult.length, 1);
    assert.equal(searchResult[0].title, 'Paper 15');

    const collectionSearchResult = await searchLocalLibraryItems({
      dataDir,
      collectionKey: 'COLL',
      query: 'Paper',
      limit: 5,
    });
    assert.equal(collectionSearchResult.length, 5);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

/**
 * Zotero 运行时用 WAL：新行先写入 -wal，主库文件不更新。这里保持写入连接
 * 打开（且关闭 autocheckpoint），模拟“未 checkpoint”的真实状态。
 */
function createWalZoteroFixture() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-zotero-wal-test-'));
  const db = new DatabaseSync(path.join(dataDir, 'zotero.sqlite'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA wal_autocheckpoint = 0');
  db.exec(`
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
  db.exec("insert into itemTypes values (1, 'journalArticle'), (2, 'attachment')");
  db.exec("insert into fields values (1, 'title'), (2, 'date')");
  db.exec("insert into collections values (10, 'COLL', 'Collection', null)");

  const storageDir = path.join(dataDir, 'storage', 'ATT_WAL');
  mkdirSync(storageDir, { recursive: true });
  writeFileSync(path.join(storageDir, 'wal-paper.pdf'), '%PDF-1.7\n');

  db.exec("insert into items values (1, 'PARENT_WAL', 1, '2026-01-01')");
  db.exec("insert into items values (2, 'ATT_WAL', 2, '2026-01-01')");
  db.exec("insert into itemAttachments values (2, 1, 'application/pdf', 'storage:wal-paper.pdf')");
  db.exec('insert into collectionItems values (10, 1)');
  db.exec("insert into itemDataValues values (1, 'WAL Paper')");
  db.exec('insert into itemData values (1, 1, 1)');

  return { dataDir, db };
}

test('local Zotero reads rows still uncheckpointed in the WAL', async () => {
  const { dataDir, db } = createWalZoteroFixture();

  try {
    assert.ok(statSync(path.join(dataDir, 'zotero.sqlite-wal')).size > 0);
    const items = await listLocalLibraryItems({ dataDir });
    assert.equal(items.length, 1);
    assert.equal(items[0].title, 'WAL Paper');
  } finally {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('local Zotero reads use node:sqlite instead of loading the database into WASM', async () => {
  const dataDir = await createZoteroFixture(30);

  try {
    const moduleLoader = require('node:module');
    const originalLoad = moduleLoader._load;
    moduleLoader._load = function patchedLoad(request: string, ...args: any[]) {
      if (request === 'sql.js') {
        throw new Error('sql.js must not be used for local Zotero reads');
      }
      return originalLoad.call(this, request, ...args);
    };

    try {
      const items = await listLocalLibraryItems({ dataDir });
      assert.equal(items.length, 29);
    } finally {
      moduleLoader._load = originalLoad;
    }
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('local Zotero bounds concurrent snapshot creation', async () => {
  const dataDir = await createZoteroFixture(12);

  try {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => listLocalLibraryItems({ dataDir })),
    );
    assert.deepEqual(results.map((items: any[]) => items.length), [11, 11, 11, 11, 11, 11]);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
