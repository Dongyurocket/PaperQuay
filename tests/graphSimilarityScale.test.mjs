import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_MAX_SIMILARITY_CANDIDATES,
  MAX_SIMILARITY_CANDIDATES,
  MAX_SIMILARITY_EDGE_LIMIT,
  buildDocumentGeometry,
  listDocumentSimilarities as listDocumentSimilaritiesWithStrategy,
} from '../electron/backend/rag/retrieval.cjs';

// 这组测试锁定旧的 global-top 算法与预算；互近邻语义单独在下方测试。
function listDocumentSimilarities(db, options = {}) {
  return listDocumentSimilaritiesWithStrategy(db, { ...options, strategy: 'global-top' });
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

function makeRows(count, dimensions = 4, options = {}) {
  const random = seededRandom(options.seed ?? 42);
  return Array.from({ length: count }, (_, index) => {
    const vector = new Float32Array(dimensions);
    for (let axis = 0; axis < dimensions; axis += 1) {
      vector[axis] = options.identical ? 1 : random() * 2 - 1;
    }
    return {
      documentKey: `doc-${String(index).padStart(5, '0')}`,
      dimension: dimensions,
      embedding: vector,
      sourceTypesJson: '[]',
    };
  });
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
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < length; index += 1) {
    const leftValue = Number(left[index]) || 0;
    const rightValue = Number(right[index]) || 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

// Reference implementation of the pre-S5-GRAPH-2 algorithm.
function bruteForce(rows, { limit = 80, minSimilarity = -1 } = {}) {
  const docs = rows.map((row) => ({
    documentKey: row.documentKey,
    dimension: row.dimension,
    vector: row.embedding,
  }));
  const edges = [];
  for (let leftIndex = 0; leftIndex < docs.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < docs.length; rightIndex += 1) {
      const left = docs[leftIndex];
      const right = docs[rightIndex];
      if (left.dimension !== right.dimension) continue;
      const similarity = cosine(left.vector, right.vector);
      if (similarity < minSimilarity) continue;
      edges.push({
        sourceDocumentKey: left.documentKey,
        targetDocumentKey: right.documentKey,
        similarity,
        sourceTypes: [],
      });
    }
  }
  return edges
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, limit);
}

test('small libraries produce byte-identical results to the previous pairwise loop', () => {
  const rows = makeRows(9, 4);
  for (const options of [
    { limit: 80, minSimilarity: -1 },
    { limit: 10, minSimilarity: 0.2 },
    { limit: 3, minSimilarity: 0.55 },
  ]) {
    const actual = listDocumentSimilarities(createMockDb(rows), options);
    assert.deepEqual(actual, bruteForce(rows, options));
  }
});

test('similarity output is deterministic across repeated runs', () => {
  const rows = makeRows(12, 5);
  const first = listDocumentSimilarities(createMockDb(rows), { limit: 20, minSimilarity: -1 });
  const second = listDocumentSimilarities(createMockDb(rows), { limit: 20, minSimilarity: -1 });
  assert.deepEqual(second, first);
});

test('candidate vectors are truncated deterministically by document_key', () => {
  const rows = makeRows(12, 4);
  const candidateKeys = rows.slice(0, 3).map((row) => row.documentKey);
  const edges = listDocumentSimilarities(createMockDb(rows), {
    limit: 100,
    minSimilarity: -1,
    maxCandidates: 3,
  });

  assert.equal(edges.length, 3);
  for (const edge of edges) {
    assert.ok(candidateKeys.includes(edge.sourceDocumentKey));
    assert.ok(candidateKeys.includes(edge.targetDocumentKey));
  }

  // maxCandidates below the hard minimum clamps to 2.
  const clamped = listDocumentSimilarities(
    createMockDb(makeRows(5, 4, { identical: true })),
    { limit: 100, minSimilarity: -1, maxCandidates: 1 },
  );
  assert.equal(clamped.length, 1);
  assert.equal(clamped[0].sourceDocumentKey, 'doc-00000');
  assert.equal(clamped[0].targetDocumentKey, 'doc-00001');
});

test('allowed documentKeys are filtered in SQL before decoding', () => {
  let receivedParams = null;
  const rows = makeRows(10, 4);
  const db = {
    prepare() {
      return {
        all(...params) {
          receivedParams = params;
          const allowed = new Set(JSON.parse(params[0]));
          return rows.filter((row) => allowed.has(row.documentKey));
        },
      };
    },
  };

  const allowedKeys = ['doc-00002', 'doc-00005', 'doc-00007'];
  const edges = listDocumentSimilarities(db, {
    limit: 20,
    minSimilarity: -1,
    documentKeys: allowedKeys,
  });
  assert.ok(Array.isArray(receivedParams));
  assert.deepEqual(JSON.parse(receivedParams[0]), allowedKeys);
  assert.ok(edges.length > 0);
  for (const edge of edges) {
    assert.ok(allowedKeys.includes(edge.sourceDocumentKey));
    assert.ok(allowedKeys.includes(edge.targetDocumentKey));
  }
});

test('retained edges are hard-capped even when callers request more', () => {
  const rows = makeRows(60, 4, { identical: true });
  const edges = listDocumentSimilarities(createMockDb(rows), {
    limit: 1_000_000,
    minSimilarity: -1,
  });
  assert.equal(edges.length, MAX_SIMILARITY_EDGE_LIMIT);
  for (let index = 1; index < edges.length; index += 1) {
    assert.ok(edges[index - 1].similarity >= edges[index].similarity);
  }
});

test('candidate and edge budget constants match the documented defaults', () => {
  assert.equal(DEFAULT_MAX_SIMILARITY_CANDIDATES, 2000);
  assert.equal(MAX_SIMILARITY_CANDIDATES, 5000);
  assert.equal(MAX_SIMILARITY_EDGE_LIMIT, 1000);
});

// 真实 embedding 维度是 768（8 维基准远低于生产规模）。默认候选 2000 时，
// 两两配对约 2M 次点积 × 768 维 ≈ 15 亿次乘加，是 listDocumentSimilarities
// 在公开参数内最重的常规组合。maxCandidates 上限 5000 属显式放大请求：
// 5000×768 约 12.5M 对 × 768 维 ≈ 96 亿次乘加，耗时随 CI 机器波动大，
// 因此不压测该极端组合，改用 32 维单独验证「5000 候选上限确实先截断再配对」。
const SIMILARITY_BENCHMARK_DIMENSION = 768;
const SIMILARITY_BENCHMARK_DOCUMENTS = 2500;
const SIMILARITY_BENCHMARK_CANDIDATES = 2000;
const SIMILARITY_BENCHMARK_BUDGET_MS = 2000;
// 本机 node --test 内实测约 0.73-0.88s，预算留约 2.3 倍余量。
// 5000 候选 × 32 维实测约 0.26s；预算留约 7.5 倍余量。
const SIMILARITY_CANDIDATE_LIMIT_BUDGET_MS = 2000;

test('768-dim reference results stay byte-identical to the brute-force loop', () => {
  // 优化（内联点积、跳过零向量）必须保持精确结果与顺序：小规模 768 维直接对照：
  const rows = makeRows(45, SIMILARITY_BENCHMARK_DIMENSION, { seed: 13 });
  for (const options of [
    { limit: 25, minSimilarity: -1 },
    { limit: 10, minSimilarity: 0.05 },
    { limit: 80, minSimilarity: 0.3 },
  ]) {
    const actual = listDocumentSimilarities(createMockDb(rows), options);
    assert.deepEqual(actual, bruteForce(rows, options));
  }
});

test('zero vectors keep the brute-force similarity-0 semantics', () => {
  // 零向量不能直接整条跳过：minSimilarity <= 0 时零向量对仍是合法边（相似度 0）。
  const rows = makeRows(8, 6, { seed: 17 });
  rows[1].embedding = new Float32Array(6);
  rows[5].embedding = new Float32Array(6);
  for (const options of [
    { limit: 80, minSimilarity: -1 },
    { limit: 80, minSimilarity: 0 },
    { limit: 20, minSimilarity: 0.2 },
  ]) {
    const actual = listDocumentSimilarities(createMockDb(rows), options);
    assert.deepEqual(actual, bruteForce(rows, options));
  }
});

test('2000 candidates x 768 dims stays within the documented budget', {
  skip: process.env.CI ? 'shared CI runners do not meet the local 2s budget' : false,
}, () => {
  const rows = makeRows(SIMILARITY_BENCHMARK_DOCUMENTS, SIMILARITY_BENCHMARK_DIMENSION, { seed: 11 });
  const startedAt = performance.now();
  const edges = listDocumentSimilarities(createMockDb(rows), {
    limit: 80,
    minSimilarity: 0.1,
  });
  const elapsedMs = performance.now() - startedAt;
  const lastCandidateKey = rows[SIMILARITY_BENCHMARK_CANDIDATES - 1].documentKey;

  assert.ok(edges.length <= 80);
  for (const edge of edges) {
    assert.ok(edge.sourceDocumentKey <= lastCandidateKey);
    assert.ok(edge.targetDocumentKey <= lastCandidateKey);
  }
  assert.ok(
    elapsedMs < SIMILARITY_BENCHMARK_BUDGET_MS,
    `768-dim similarity took ${elapsedMs.toFixed(0)}ms (budget ${SIMILARITY_BENCHMARK_BUDGET_MS}ms)`,
  );
  console.log(
    `[graph benchmark] similarity candidates=2000 of 2500, dims=768, edges=${edges.length}: ${elapsedMs.toFixed(0)}ms`,
  );
});

test('maxCandidates truncates to 5000 before pairwise comparison', () => {
  // 前 5000 条是低相似度随机向量，其中 doc-00000/doc-00001 被替换成相同向量；
  // 5000 之后的 100 条是彼此完全相同的高相似度向量。minSimilarity=0.99 会滤掉
  // 绝大多数随机配对，只有「截断内的人造配对」与「截断外的高相似簇」可能命中。
  // 若候选上限失效，top-K 会被截断外的高相似簇占满；截断生效时，唯一一条边
  // 只能来自 doc-00000..doc-04999。用 32 维而不是 768 维：5000×768 约
  // 96 亿次乘加，属显式放大请求下的极端组合，不适合放进常规测试预算。
  const rows = makeRows(MAX_SIMILARITY_CANDIDATES, 32, { seed: 23 });
  rows[0].embedding = new Float32Array(32).fill(1);
  rows[1].embedding = new Float32Array(32).fill(1);
  for (let index = 0; index < 100; index += 1) {
    rows.push({
      documentKey: `doc-${String(MAX_SIMILARITY_CANDIDATES + index).padStart(5, '0')}`,
      dimension: 32,
      embedding: new Float32Array(32).fill(1),
      sourceTypesJson: '[]',
    });
  }

  const startedAt = performance.now();
  const edges = listDocumentSimilarities(createMockDb(rows), {
    limit: 80,
    minSimilarity: 0.99,
    maxCandidates: MAX_SIMILARITY_CANDIDATES,
  });
  const elapsedMs = performance.now() - startedAt;
  const lastCandidateKey = `doc-${String(MAX_SIMILARITY_CANDIDATES - 1).padStart(5, '0')}`;

  assert.equal(edges.length, 1, 'only the planted pair inside the candidate cap may qualify');
  assert.equal(edges[0].sourceDocumentKey, 'doc-00000');
  assert.equal(edges[0].targetDocumentKey, 'doc-00001');
  for (const edge of edges) {
    assert.ok(
      edge.sourceDocumentKey <= lastCandidateKey,
      `${edge.sourceDocumentKey} is beyond the ${MAX_SIMILARITY_CANDIDATES}-candidate cap`,
    );
    assert.ok(
      edge.targetDocumentKey <= lastCandidateKey,
      `${edge.targetDocumentKey} is beyond the ${MAX_SIMILARITY_CANDIDATES}-candidate cap`,
    );
  }
  assert.ok(
    elapsedMs < SIMILARITY_CANDIDATE_LIMIT_BUDGET_MS,
    `5000-candidate similarity took ${elapsedMs.toFixed(0)}ms (budget ${SIMILARITY_CANDIDATE_LIMIT_BUDGET_MS}ms)`,
  );
  console.log(
    `[graph benchmark] similarity candidates=5000 of 5100, dims=32, edges=${edges.length}: ${elapsedMs.toFixed(0)}ms`,
  );
});

test('2500-document similarity stays bounded and fast', () => {
  const rows = makeRows(2500, 8, { seed: 7 });
  const startedAt = performance.now();
  const edges = listDocumentSimilarities(createMockDb(rows), {
    limit: 80,
    minSimilarity: 0.5,
  });
  const elapsedMs = performance.now() - startedAt;
  const lastCandidateKey = rows[DEFAULT_MAX_SIMILARITY_CANDIDATES - 1].documentKey;

  assert.ok(edges.length <= 80);
  for (const edge of edges) {
    assert.ok(edge.sourceDocumentKey <= lastCandidateKey);
    assert.ok(edge.targetDocumentKey <= lastCandidateKey);
  }
  assert.ok(elapsedMs < 5000, `similarity candidates took ${elapsedMs.toFixed(0)}ms`);
  console.log(`[graph benchmark] similarity candidates=2000 of 2500, dims=8, edges=${edges.length}: ${elapsedMs.toFixed(0)}ms`);
});

test('mutual-knn caps non-bridge degree and bridges all components', () => {
  const rows = makeRows(40, 8, { seed: 23 });
  const edges = listDocumentSimilaritiesWithStrategy(createMockDb(rows), {
    strategy: 'mutual-knn',
    k: 5,
  });

  const degree = new Map(rows.map((row) => [row.documentKey, 0]));
  const parent = new Map(rows.map((row) => [row.documentKey, row.documentKey]));
  const find = (key) => {
    let current = key;
    while (parent.get(current) !== current) current = parent.get(current);
    return current;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };

  for (const edge of edges) {
    assert.ok(Number.isFinite(edge.similarity), 'similarity must be finite');
    degree.set(edge.sourceDocumentKey, degree.get(edge.sourceDocumentKey) + 1);
    degree.set(edge.targetDocumentKey, degree.get(edge.targetDocumentKey) + 1);
    if (edge.rankWeight > 0) {
      assert.ok(degree.get(edge.sourceDocumentKey) <= 5);
      assert.ok(degree.get(edge.targetDocumentKey) <= 5);
    }
    union(edge.sourceDocumentKey, edge.targetDocumentKey);
  }

  const roots = new Set(rows.map((row) => find(row.documentKey)));
  assert.equal(roots.size, 1, 'bridge edges must connect every component');
  assert.ok(edges.length <= 40 * 5 + 39);
});

test('all-but-the-top removes the shared direction without breaking near duplicates', () => {
  const dimension = 24;
  const random = seededRandom(31);
  const rows = [];
  for (let index = 0; index < 24; index += 1) {
    const vector = new Float32Array(dimension);
    for (let axis = 0; axis < dimension; axis += 1) vector[axis] = 1;
    // 每篇带自己的噪声；0/1 两篇共享同一份噪声，作为近重复对。
    if (index === 1) {
      vector.set(rows[0].embedding);
      vector[0] += 1.1;
      rows.push({
        documentKey: `doc-${String(index).padStart(5, '0')}`,
        dimension,
        embedding: vector,
        sourceTypesJson: '[]',
      });
      continue;
    }
    for (let axis = 0; axis < dimension; axis += 1) vector[axis] += random() * 0.4 - 0.2;
    rows.push({
      documentKey: `doc-${String(index).padStart(5, '0')}`,
      dimension,
      embedding: vector,
      sourceTypesJson: '[]',
    });
  }

  const geometry = buildDocumentGeometry(createMockDb(rows), { components: 2 });
  const cosine = (left, right) => {
    let dot = 0;
    for (let axis = 0; axis < left.length; axis += 1) dot += left[axis] * right[axis];
    return dot;
  };

  let total = 0;
  let count = 0;
  for (let left = 0; left < geometry.documents.length; left += 1) {
    for (let right = left + 1; right < geometry.documents.length; right += 1) {
      total += cosine(geometry.documents[left].vector, geometry.documents[right].vector);
      count += 1;
    }
  }

  const nearDuplicate = cosine(geometry.documents[0].vector, geometry.documents[1].vector);
  const unrelated = cosine(geometry.documents[2].vector, geometry.documents[3].vector);
  assert.ok(geometry.documents.every((document) => document.vector.every(Number.isFinite)));
  assert.ok(total / count < 0.25, 'shared direction should be mostly removed');
  assert.ok(nearDuplicate > unrelated + 0.2, 'near duplicate should stay closer than unrelated papers');
});
