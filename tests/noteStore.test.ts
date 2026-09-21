import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createNoteStore } = require('../electron/backend/noteStore.cjs');

function createStore() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-notes-store-test-'));
  const store = createNoteStore({
    dataDir,
    notesDatabasePath: path.join(dataDir, 'paperquay-notes.sqlite'),
  });

  return { dataDir, store };
}

test('anchors keep blockId/pageIndex across a save and reload', () => {
  const { dataDir, store } = createStore();

  try {
    const created = store.createNote({
      paperId: 'native-library:paper-1',
      type: 'standalone',
      title: '飞机设计的三个阶段',
      content: '正文',
      anchors: [
        {
          id: 'note-polish:paper-1:mineru:page-20-block-3:0',
          paperId: 'paper-1',
          label: 'P20',
          sourceTitle: '民用飞机总体设计',
          excerpt: '飞机这样一个复杂的工程系统的设计过程是一个不断迭代的过程',
          source: 'blocks',
          blockId: 'page-20-block-3',
          pageIndex: 19,
          createdAt: 1,
        },
      ],
    });

    assert.equal(created.anchors.length, 1);
    assert.equal(created.anchors[0].blockId, 'page-20-block-3');
    assert.equal(created.anchors[0].pageIndex, 19);

    // 读回来仍要带上位置，否则引用芯片只能打开文献、无法定位。
    const reloaded = store.getNote({ id: created.id });
    assert.equal(reloaded.anchors.length, 1);
    assert.equal(reloaded.anchors[0].blockId, 'page-20-block-3');
    assert.equal(reloaded.anchors[0].pageIndex, 19);
    assert.equal(reloaded.anchors[0].label, 'P20');
    assert.equal(reloaded.anchors[0].source, 'blocks');
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('anchors keep pdfLocation and normalize invalid position fields', () => {
  const { dataDir, store } = createStore();

  try {
    const created = store.createNote({
      paperId: 'native-library:paper-1',
      type: 'highlight',
      title: 'Note',
      content: '',
      anchors: [
        {
          id: 'anchor-pdf',
          paperId: 'paper-1',
          label: 'P8',
          excerpt: 'quoted',
          source: 'pdf',
          blockId: '   ',
          pageIndex: -3,
          pdfLocation: { pageNumber: 8, bbox: [1, 2, 3, 4], bboxCoordinateSystem: 'pdf' },
          createdAt: 1,
        },
      ],
    });

    const [storedAnchor] = created.anchors;
    assert.equal(storedAnchor.blockId, undefined);
    assert.equal(storedAnchor.pageIndex, undefined);
    assert.equal(storedAnchor.pdfLocation.pageNumber, 8);
    assert.deepEqual(storedAnchor.pdfLocation.bbox, [1, 2, 3, 4]);
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
