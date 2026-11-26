import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDocumentGeometry,
  listDocumentSimilarities,
} from '../electron/backend/rag/retrieval.cjs';

// 合成数据：所有向量共享一个强公共方向，两个真实主题各带自己的偏移，
// doc-0/doc-1 是近重复对。用来锁定 all-but-the-top + 互近邻的行为。
function createRows() {
  const dimension = 24;
  const rows = [];
  const topicA = new Float64Array(dimension);
  const topicB = new Float64Array(dimension);
  for (let axis = 0; axis < dimension; axis += 1) {
    topicA[axis] = axis === 0 ? 1 : 0;
    topicB[axis] = axis === 1 ? 1 : 0;
  }

  const push = (index, topicShift, noiseSeed) => {
    const vector = new Float32Array(dimension);
    for (let axis = 0; axis < dimension; axis += 1) {
      const shared = 1;
      const topic = topicShift ? (topicShift[axis] || 0) * 1.6 : 0;
      const noise = Math.sin((index + 1) * (axis + 1) * noiseSeed) * 0.06;
      vector[axis] = shared + topic + noise;
    }
    rows.push({
      documentKey: `doc-${String(index).padStart(3, '0')}`,
      dimension,
      embeddingModelKey: 'test-model',
      embedding: vector,
      sourceTypesJson: '["mineru-markdown"]',
      updatedAt: 1000 + index,
    });
  };

  for (let index = 0; index < 10; index += 1) push(index, topicA, 1.3);
  for (let index = 10; index < 20; index += 1) push(index, topicB, 1.7);
  // 近重复：把 doc-0 的向量复制给 doc-20，仅保留极小差异。
  rows.push({
    ...rows[0],
    documentKey: 'doc-020',
    embedding: Float32Array.from(rows[0].embedding),
    updatedAt: 2000,
  });
  return rows;
}

function createMockDb(rows) {
  return {
    prepare() {
      return {
        all(...params) {
          if (params.length === 0) return rows;
          const allowed = new Set(JSON.parse(params[0]));
          return rows.filter((row) => allowed.has(row.documentKey));
        },
      };
    },
  };
}

function cosine(left, right) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let axis = 0; axis < left.length; axis += 1) {
    dot += left[axis] * right[axis];
    leftNorm += left[axis] * left[axis];
    rightNorm += right[axis] * right[axis];
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

test('document geometry removes the shared direction but keeps near duplicates', () => {
  const rows = createRows();
  const geometry = buildDocumentGeometry(createMockDb(rows), { components: 2 });
  assert.equal(geometry.documents.length, rows.length);
  assert.ok(geometry.documents.every((document) => document.vector.every(Number.isFinite)));

  let total = 0;
  let count = 0;
  for (let left = 0; left < geometry.documents.length; left += 1) {
    for (let right = left + 1; right < geometry.documents.length; right += 1) {
      total += cosine(geometry.documents[left].vector, geometry.documents[right].vector);
      count += 1;
    }
  }
  assert.ok(total / count < 0.35, 'mean centered cosine should be near the baseline');

  const duplicate = cosine(geometry.documents[0].vector, geometry.documents[20].vector);
  const crossTopic = cosine(geometry.documents[0].vector, geometry.documents[10].vector);
  assert.ok(duplicate > 0.95, 'near duplicate must stay close');
  assert.ok(duplicate > crossTopic + 0.4, 'near duplicate must beat a cross-topic pair');
});

test('mutual-knn caps degree, removes hubness and bridges components', () => {
  const rows = createRows();
  const edges = listDocumentSimilarities(createMockDb(rows), {
    strategy: 'mutual-knn',
    k: 4,
  });

  const degree = new Map(rows.map((row) => [row.documentKey, 0]));
  const parent = new Map(rows.map((row) => [row.documentKey, row.documentKey]));
  const find = (key) => {
    let current = key;
    while (parent.get(current) !== current) {
      parent.set(current, parent.get(parent.get(current)));
      current = parent.get(current);
    }
    return current;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };

  for (const edge of edges) {
    assert.ok(Number.isFinite(edge.similarity));
    degree.set(edge.sourceDocumentKey, degree.get(edge.sourceDocumentKey) + 1);
    degree.set(edge.targetDocumentKey, degree.get(edge.targetDocumentKey) + 1);
    if (edge.rankWeight > 0) {
      assert.ok(degree.get(edge.sourceDocumentKey) <= 4);
      assert.ok(degree.get(edge.targetDocumentKey) <= 4);
    }
    union(edge.sourceDocumentKey, edge.targetDocumentKey);
  }

  assert.equal(new Set(rows.map((row) => find(row.documentKey))).size, 1);
  assert.ok(edges.length < rows.length * 4, 'mutual kNN should not approach the old global top-N density');
  assert.ok(edges.every((edge) => edge.sourceDocumentKey < edge.targetDocumentKey), 'pair orientation is deterministic');
});

test('geometry cache returns the same document set for the same key', () => {
  const rows = createRows();
  const db = createMockDb(rows);
  const first = buildDocumentGeometry(db, { components: 2 });
  const second = buildDocumentGeometry(db, { components: 2 });
  assert.equal(second.documents.length, first.documents.length);
  assert.deepEqual(
    second.documents.map((document) => document.documentKey),
    first.documents.map((document) => document.documentKey),
  );
});

test('mutual-knn clamps k to 1..20 and defaults to the same algorithm', () => {
  const rows = createRows();
  const db = createMockDb(rows);
  const degreeOf = (edges) => {
    const degree = new Map();
    for (const edge of edges) {
      if (!(edge.rankWeight > 0)) continue;
      degree.set(edge.sourceDocumentKey, (degree.get(edge.sourceDocumentKey) ?? 0) + 1);
      degree.set(edge.targetDocumentKey, (degree.get(edge.targetDocumentKey) ?? 0) + 1);
    }
    return Math.max(...degree.values());
  };

  const kOne = listDocumentSimilarities(db, { strategy: 'mutual-knn', k: 1 });
  assert.ok(kOne.length > 0);
  assert.ok(degreeOf(kOne) <= 1, 'k=1 must keep degree <= 1');

  const kHundred = listDocumentSimilarities(db, { strategy: 'mutual-knn', k: 100 });
  assert.ok(degreeOf(kHundred) <= 20, 'k must clamp at MAX_MUTUAL_NEIGHBORS=20');

  const defaultStrategy = listDocumentSimilarities(db, { k: 4 });
  const explicit = listDocumentSimilarities(db, { strategy: 'mutual-knn', k: 4 });
  assert.deepEqual(defaultStrategy, explicit);
});

test('bridge=false preserves disconnected components', () => {
  const rows = createRows();
  const db = createMockDb(rows);
  const bridged = listDocumentSimilarities(db, { strategy: 'mutual-knn', k: 1 });
  const unbridged = listDocumentSimilarities(db, { strategy: 'mutual-knn', k: 1, bridge: false });

  const components = (edges) => {
    const parent = new Map(rows.map((row) => [row.documentKey, row.documentKey]));
    const find = (key) => {
      let current = key;
      while (parent.get(current) !== current) {
        parent.set(current, parent.get(parent.get(current)));
        current = parent.get(current);
      }
      return current;
    };
    for (const edge of edges) {
      const left = find(edge.sourceDocumentKey);
      const right = find(edge.targetDocumentKey);
      if (left !== right) parent.set(right, left);
    }
    return new Set(rows.map((row) => find(row.documentKey))).size;
  };

  assert.equal(components(bridged), 1);
  assert.ok(components(unbridged) > 1, 'disabling bridge must expose genuine topic isolation');
});
