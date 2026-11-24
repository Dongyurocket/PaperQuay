const fs = require('node:fs');
const path = require('node:path');
const {
  cleanString,
  id,
  writeJsonSync,
} = require('./utils.cjs');

const NATIVE_LIBRARY_PREFIX = 'native-library:';
const PAPER_NODE_PREFIX = 'paper:';
const RELATION_STORE_FILE = 'paperquay-knowledge-graph-relations.json';
const MAX_REFERENCE_NODES_PER_PAPER = 48;
const MAX_CO_AUTHOR_EDGES_PER_PAPER = 5;
// S5-GRAPH-2：图谱规模上限。节点用 top-degree 抽样，边按每个节点保留权重最高者。
// 默认 10k 节点 × 每节点 250 条边 → 输出无向边最坏 10,000 × 250 / 2 = 1.25M。
const DEFAULT_GRAPH_NODE_LIMIT = 10000;
const MAX_GRAPH_NODE_LIMIT = 50000;
const DEFAULT_GRAPH_EDGE_LIMIT_PER_NODE = 250;
const MAX_GRAPH_EDGE_LIMIT_PER_NODE = 1000;

function normalizeBoolean(value, fallback = true) {
  if (value === undefined || value === null) {
    return fallback;
  }

  return value !== false;
}

function normalizeLimit(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function paperNodeId(paperId) {
  return `paper:${paperId}`;
}

function normalizePaperReferenceId(value) {
  const raw = cleanString(value);

  if (!raw) return '';

  if (raw.startsWith(NATIVE_LIBRARY_PREFIX)) {
    return raw.slice(NATIVE_LIBRARY_PREFIX.length);
  }

  if (raw.startsWith(PAPER_NODE_PREFIX)) {
    return raw.slice(PAPER_NODE_PREFIX.length);
  }

  return raw;
}

function noteNodeId(noteId) {
  return `note:${noteId}`;
}

function tagNodeId(tag) {
  return `tag:${tag.trim().toLowerCase()}`;
}

function categoryNodeId(categoryId) {
  return `category:${categoryId}`;
}

function uniqueEdgeId(type, source, target) {
  return `${type}:${source}->${target}`;
}

function normalizeDoi(value) {
  return cleanString(value)
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .replace(/[。.,;，；\s]+$/g, '')
    .toLowerCase();
}

function normalizeTitleKey(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/doi:\s*\S+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAuthorKey(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function relationStorePath(appPaths) {
  return path.join(appPaths.dataDir, RELATION_STORE_FILE);
}

let retiredAiRelationMigrationInFlight = false;

function readRelationStore(appPaths) {
  if (!retiredAiRelationMigrationInFlight) {
    retiredAiRelationMigrationInFlight = true;
    try {
      migrateRetiredAiRelations(appPaths);
    } finally {
      retiredAiRelationMigrationInFlight = false;
    }
  }
  const filePath = relationStorePath(appPaths);
  let rawText;
  try {
    rawText = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { version: 1, relations: [] };
    }
    throw Object.assign(
      new Error(`Unable to read the knowledge graph relation store: ${filePath}.`),
      { code: 'GRAPH_RELATION_STORE_UNREADABLE', cause: error },
    );
  }

  let raw;
  try {
    raw = JSON.parse(rawText);
  } catch {
    throw corruptedRelationStoreError(filePath);
  }

  return {
    version: 1,
    relations: Array.isArray(raw?.relations) ? raw.relations : [],
  };
}

/**
 * Keep the damaged bytes for manual recovery and surface an error instead of
 * silently treating the store as empty (a later write would erase every relation).
 * The first backup is never overwritten, so repeated reads do not stack copies.
 */
function corruptedRelationStoreError(filePath) {
  const backupPath = `${filePath}.corrupt.json`;
  let keptBackup = backupPath;
  try {
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(filePath, backupPath);
    }
  } catch (error) {
    keptBackup = null;
    console.warn('[paperquay] Failed to back up the corrupted knowledge graph relation store.', error);
  }
  const message = keptBackup
    ? `Knowledge graph relation store is corrupted: ${filePath}. The damaged file was kept at ${keptBackup}.`
    : `Knowledge graph relation store is corrupted: ${filePath}. A backup could not be created.`;
  return Object.assign(new Error(message), {
    code: 'GRAPH_RELATION_STORE_CORRUPT',
    backupPath: keptBackup,
  });
}

function writeRelationStore(appPaths, store) {
  writeJsonSync(relationStorePath(appPaths), {
    version: 1,
    relations: Array.isArray(store?.relations) ? store.relations : [],
  });
}

const MAX_RELATION_LABEL_LENGTH = 80;
const MAX_RELATION_DESCRIPTION_LENGTH = 2000;

function normalizeCustomRelation(input = {}) {
  const source = cleanString(input.source || input.sourceId);
  const target = cleanString(input.target || input.targetId);
  const label = cleanString(input.label) || 'related';

  if (!source || !target || source === target) {
    return null;
  }

  if (label.length > MAX_RELATION_LABEL_LENGTH) {
    throw new Error(`Relation label must be at most ${MAX_RELATION_LABEL_LENGTH} characters.`);
  }

  const description = cleanString(input.description);
  if (description.length > MAX_RELATION_DESCRIPTION_LENGTH) {
    throw new Error(`Relation description must be at most ${MAX_RELATION_DESCRIPTION_LENGTH} characters.`);
  }

  const createdAt = Number(input.createdAt) || Date.now();
  return {
    id: cleanString(input.id) || id('kgrel'),
    source,
    target,
    type: 'custom_relation',
    label,
    description,
    weight: Number.isFinite(Number(input.weight))
      ? Math.max(0.1, Math.min(1, Number(input.weight)))
      : 0.58,
    createdAt,
    updatedAt: Number(input.updatedAt) || createdAt,
  };
}

/**
 * 一次性清理已退役的 AI 关系（ai_suggested）。
 *
 * 先备份原 JSON，再过滤并写回；重复执行不会误删人工关系，也不会重复备份。
 * 仅处理 type === 'ai_suggested' 的条目，保留 custom_relation 与系统边。
 */
function migrateRetiredAiRelations(appPaths) {
  const filePath = relationStorePath(appPaths);
  let rawText;

  try {
    rawText = fs.readFileSync(filePath, 'utf8');
  } catch {
    return { cleaned: 0, backupPath: null };
  }

  let raw;
  try {
    raw = JSON.parse(rawText);
  } catch {
    return { cleaned: 0, backupPath: null };
  }

  const relations = Array.isArray(raw?.relations) ? raw.relations : [];
  const retired = relations.filter((relation) => cleanString(relation?.type) === 'ai_suggested');
  if (retired.length === 0) {
    return { cleaned: 0, backupPath: null };
  }

  const backupPath = `${filePath}.ai-suggested-backup-${Date.now()}.json`;
  try {
    fs.copyFileSync(filePath, backupPath);
  } catch (error) {
    console.warn('[paperquay] Failed to back up the retired AI relations; cleanup skipped.', error);
    return { cleaned: 0, backupPath: null };
  }

  // 人工关系原样保留（不重新规范化，避免旧标签/说明触发长度校验丢数据）。
  const kept = relations.filter((relation) => cleanString(relation?.type) !== 'ai_suggested');

  writeRelationStore(appPaths, { version: 1, relations: kept });
  console.info(`[paperquay] Removed ${retired.length} retired AI relation(s). Backup: ${backupPath}`);
  return { cleaned: retired.length, backupPath };
}

function listCustomRelations(appPaths) {
  return readRelationStore(appPaths)
    .relations
    .map(normalizeCustomRelation)
    .filter(Boolean);
}

function textValuesFromUnknown(value, depth = 0) {
  if (value == null || depth > 4) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((item) => textValuesFromUnknown(item, depth + 1));
  if (typeof value !== 'object') return [];

  return [
    value.title,
    value.displayName,
    value.articleTitle,
    value.doi,
    value.DOI,
    value.raw,
    value.text,
    value.unstructured,
    value.citation,
  ].flatMap((item) => textValuesFromUnknown(item, depth + 1));
}

function normalizeReferenceCandidate(value) {
  if (!value) return null;
  const rawText = textValuesFromUnknown(value).join(' ').replace(/\s+/g, ' ').trim();
  const doiMatch = rawText.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i);
  const doi = normalizeDoi(
    typeof value === 'object'
      ? value.doi || value.DOI || value.doiUrl || value.url
      : doiMatch?.[0],
  ) || normalizeDoi(doiMatch?.[0]);
  const objectTitle = typeof value === 'object'
    ? cleanString(value.title || value.displayName || value.articleTitle || value.name)
    : '';
  const title = objectTitle || rawText
    .replace(/^\s*(\[\d+\]|\d+\.|\(\d+\))\s*/, '')
    .replace(/\bdoi:\s*\S+/ig, '')
    .replace(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/ig, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!doi && !title) {
    return null;
  }

  return {
    doi,
    title: title.slice(0, 260),
    raw: rawText.slice(0, 600),
  };
}

function extractPaperReferenceCandidates(paper) {
  const sources = [
    paper.references,
    paper.referenceList,
    paper.referenceTitles,
    paper.referenceDois,
    paper.parsedReferences,
    paper.bibliography,
    paper.bibliographyText,
    paper.metadata?.references,
  ];
  const candidates = [];

  for (const source of sources) {
    if (Array.isArray(source)) {
      candidates.push(...source.map(normalizeReferenceCandidate).filter(Boolean));
      continue;
    }

    if (typeof source === 'string') {
      const parts = source
        .split(/\n(?=\s*(?:\[\d+\]|\d+\.|\(\d+\))\s+)/)
        .flatMap((part) => part.split(/\n{2,}/));
      candidates.push(...parts.map(normalizeReferenceCandidate).filter(Boolean));
    }
  }

  const seen = new Set();
  return candidates
    .filter((candidate) => {
      const key = candidate.doi || normalizeTitleKey(candidate.title);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_REFERENCE_NODES_PER_PAPER);
}

function referenceCandidatesFromCache(store, papers) {
  if (!store || typeof store.loadAllReferences !== 'function') {
    return new Map();
  }

  const paperIds = new Set(papers.map((paper) => paper.id));
  const grouped = new Map();

  for (const reference of store.loadAllReferences()) {
    const paperId = cleanString(reference.paperId || reference.paper_id);
    if (!paperIds.has(paperId)) continue;

    const candidate = normalizeReferenceCandidate({
      doi: reference.doi,
      title: reference.title,
      articleTitle: reference.title,
      unstructured: reference.unstructured,
    });
    if (!candidate) continue;

    candidate.authors = cleanString(reference.authors);
    candidate.year = cleanString(reference.year);
    candidate.journal = cleanString(reference.journal);
    candidate.volume = cleanString(reference.volume);
    candidate.issue = cleanString(reference.issue);
    candidate.pages = cleanString(reference.pages);

    if (!grouped.has(paperId)) grouped.set(paperId, []);
    grouped.get(paperId).push(candidate);
  }

  for (const [paperId, references] of grouped) {
    const seen = new Set();
    grouped.set(
      paperId,
      references.filter((reference) => {
        const key = reference.doi || normalizeTitleKey(reference.title);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, MAX_REFERENCE_NODES_PER_PAPER),
    );
  }

  return grouped;
}

function findReferencedPaper(candidate, paper, paperTitleEntries, paperByDoi, paperByTitle) {
  if (candidate.doi) {
    const target = paperByDoi.get(candidate.doi);
    if (target && target.id !== paper.id) return target;
  }

  const titleKey = normalizeTitleKey(candidate.title);
  if (titleKey) {
    const exact = paperByTitle.get(titleKey);
    if (exact && exact.id !== paper.id) return exact;

    // paperTitleEntries 预先规范化，避免每个候选引用都重新规范化全部标题。
    for (const target of paperTitleEntries) {
      if (target.id === paper.id) continue;
      const targetKey = target.key;
      if (targetKey.length >= 18 && titleKey.length >= 18 && (targetKey.includes(titleKey) || titleKey.includes(targetKey))) {
        return target.paper;
      }
    }
  }

  return null;
}

function authorsText(paper) {
  const authors = Array.isArray(paper.authors) ? paper.authors : [];
  if (authors.length === 0) return '';
  const names = authors.map((author) => cleanString(author.name)).filter(Boolean);
  if (names.length <= 2) return names.join(', ');
  return `${names[0]} et al.`;
}

function addCoAuthorEdges({ papers, nodes, edges }) {
  const authorPapers = new Map();
  const authorLabels = new Map();

  for (const paper of papers) {
    for (const author of paper.authors ?? []) {
      const name = cleanString(author.name || author);
      const key = normalizeAuthorKey(name);
      if (!key || key.length < 2) continue;
      if (!authorPapers.has(key)) authorPapers.set(key, new Set());
      authorPapers.get(key).add(paper.id);
      if (!authorLabels.has(key)) authorLabels.set(key, name);
    }
  }

  const pairAuthors = new Map();
  for (const [authorKey, paperIds] of authorPapers) {
    const ids = Array.from(paperIds).sort();
    if (ids.length < 2 || ids.length > 80) continue;

    for (let leftIndex = 0; leftIndex < ids.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < ids.length; rightIndex += 1) {
        const key = `${ids[leftIndex]}::${ids[rightIndex]}`;
        if (!pairAuthors.has(key)) pairAuthors.set(key, []);
        pairAuthors.get(key).push(authorLabels.get(authorKey) || authorKey);
      }
    }
  }

  const edgeCountsByPaper = new Map();
  const rankedPairs = Array.from(pairAuthors.entries())
    .map(([pairKey, authors]) => {
      const [leftPaperId, rightPaperId] = pairKey.split('::');
      return { leftPaperId, rightPaperId, authors };
    })
    .sort((left, right) => right.authors.length - left.authors.length);

  for (const pair of rankedPairs) {
    const leftCount = edgeCountsByPaper.get(pair.leftPaperId) ?? 0;
    const rightCount = edgeCountsByPaper.get(pair.rightPaperId) ?? 0;
    if (leftCount >= MAX_CO_AUTHOR_EDGES_PER_PAPER || rightCount >= MAX_CO_AUTHOR_EDGES_PER_PAPER) {
      continue;
    }

    const source = paperNodeId(pair.leftPaperId);
    const target = paperNodeId(pair.rightPaperId);
    if (!nodes.has(source) || !nodes.has(target)) continue;

    const label = pair.authors.slice(0, 3).join(', ');
    const edgeId = uniqueEdgeId('co_author', source, target);
    edges.set(edgeId, {
      id: edgeId,
      source,
      target,
      type: 'co_author',
      label,
      description: pair.authors.length > 3
        ? `${label} and ${pair.authors.length - 3} more shared author(s)`
        : `Shared author(s): ${label}`,
      weight: Math.min(0.86, 0.5 + pair.authors.length * 0.08),
    });
    edgeCountsByPaper.set(pair.leftPaperId, leftCount + 1);
    edgeCountsByPaper.set(pair.rightPaperId, rightCount + 1);
  }
}

function notePreview(note) {
  return cleanString(note.contentText || note.excerpt || note.content).slice(0, 160);
}

function matchesSearch(node, search) {
  if (!search) return true;
  return [
    node.label,
    node.subtitle,
    node.tag,
    node.paperId,
    node.noteId,
    node.categoryId,
    node.referenceId,
    node.doi,
  ].filter(Boolean).join('\n').toLowerCase().includes(search);
}

function filterLocalGraph(snapshot, localNodeId, depth) {
  if (!localNodeId || depth <= 0 || !snapshot.nodes.some((node) => node.id === localNodeId)) {
    return snapshot;
  }

  const adjacency = new Map();
  for (const edge of snapshot.edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
    adjacency.get(edge.source).add(edge.target);
    adjacency.get(edge.target).add(edge.source);
  }

  const included = new Set([localNodeId]);
  const queue = [{ id: localNodeId, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth >= depth) continue;

    for (const nextId of adjacency.get(current.id) ?? []) {
      if (included.has(nextId)) continue;
      included.add(nextId);
      queue.push({ id: nextId, depth: current.depth + 1 });
    }
  }

  return {
    ...snapshot,
    nodes: snapshot.nodes.filter((node) => included.has(node.id)),
    edges: snapshot.edges.filter((edge) => included.has(edge.source) && included.has(edge.target)),
  };
}

/**
 * S5-GRAPH-2：把最终快照限制在可控规模内。
 *
 * 1. 节点超过 nodeLimit 时按度数降序（度数相同按 id 升序）抽样，只保留
 *    最高度数节点及其两端都存活的边；抽样结果确定。
 * 2. 每个节点保留权重最高的 edgeLimitPerNode 条边（权重相同按 id 升序），
 *    避免标签/分类 hub 把前端布局与交互拖垮。
 *
 * 默认上限（见文件头常量）：nodeLimit = 10,000，edgeLimitPerNode = 250。
 * 最坏输出规模是无向边 10,000 × 250 / 2 = 1.25M 条；输入边数在裁剪前没有上限，
 * 这里只保证输出的节点/边规模可控。合成 hub 夹具基准（10k 节点、单测默认档
 * 125k 边，重档需 PAPERQUAY_PERF=1）实测：125k 输入边 → 110k 输出边约 84–109ms，
 * 500k → 425k 约 652ms，1.25M → 1.06M 约 1.67s（Node 24，2026-11-24 本机，
 * 见 tests/graphSnapshotScale.test.mjs）。热点是 O(E) 的 incident/keptEdges 扫描与
 * 每个超限节点的 O(deg log deg) 排序，没有 O(E·deg) 结构，故保持现有顺序与实现。
 *
 * 没有发生裁剪时原样返回，保证普通规模文献库的输出与旧版一致。
 */
function applyGraphBounds(snapshot, { nodeLimit, edgeLimitPerNode }) {
  const totalNodes = snapshot.nodes.length;
  const totalEdges = snapshot.edges.length;
  let nodes = snapshot.nodes;
  let edges = snapshot.edges;
  let sampled = false;

  if (Number.isFinite(nodeLimit) && nodes.length > nodeLimit) {
    const degree = new Map();
    for (const edge of edges) {
      degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
      degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    }

    const keptNodes = new Set(
      nodes
        .slice()
        .sort((left, right) => {
          const degreeDelta = (degree.get(right.id) ?? 0) - (degree.get(left.id) ?? 0);
          if (degreeDelta !== 0) return degreeDelta;
          return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
        })
        .slice(0, nodeLimit)
        .map((node) => node.id),
    );

    nodes = nodes.filter((node) => keptNodes.has(node.id));
    edges = edges.filter((edge) => keptNodes.has(edge.source) && keptNodes.has(edge.target));
    sampled = true;
  }

  let edgesCapped = false;
  if (Number.isFinite(edgeLimitPerNode) && edgeLimitPerNode > 0 && edges.length > 0) {
    const incident = new Map();
    const edgeById = new Map();
    for (const edge of edges) {
      edgeById.set(edge.id, edge);
      if (!incident.has(edge.source)) incident.set(edge.source, []);
      if (!incident.has(edge.target)) incident.set(edge.target, []);
      incident.get(edge.source).push(edge.id);
      incident.get(edge.target).push(edge.id);
    }

    const keptEdges = new Set(edges.map((edge) => edge.id));
    const nodeIds = nodes.map((node) => node.id).sort();
    const weightOf = (edgeId) => {
      const weight = Number(edgeById.get(edgeId)?.weight);
      return Number.isFinite(weight) ? weight : 0;
    };

    for (const nodeId of nodeIds) {
      const liveEdges = (incident.get(nodeId) ?? []).filter((edgeId) => keptEdges.has(edgeId));
      if (liveEdges.length <= edgeLimitPerNode) continue;

      liveEdges.sort((left, right) => {
        const weightDelta = weightOf(right) - weightOf(left);
        if (weightDelta !== 0) return weightDelta;
        return left < right ? -1 : left > right ? 1 : 0;
      });
      for (const edgeId of liveEdges.slice(edgeLimitPerNode)) {
        keptEdges.delete(edgeId);
      }
      edgesCapped = true;
    }

    if (edgesCapped) {
      edges = edges.filter((edge) => keptEdges.has(edge.id));
    }
  }

  if (!sampled && !edgesCapped) {
    return snapshot;
  }

  return {
    ...snapshot,
    nodes,
    edges,
    metadata: {
      sampled,
      truncated: true,
      nodeLimit,
      edgeLimitPerNode,
      totalNodes,
      returnedNodes: nodes.length,
      totalEdges,
      returnedEdges: edges.length,
    },
  };
}

async function createKnowledgeGraphSnapshot(context, request = {}) {
  const { appPaths, noteStore, ragStore, store } = context;
  const includePapers = normalizeBoolean(request.includePapers, true);
  const includeNotes = normalizeBoolean(request.includeNotes, true);
  const includeTags = normalizeBoolean(request.includeTags, true);
  const includeCategories = normalizeBoolean(request.includeCategories, true);
  const includeReferences = normalizeBoolean(request.includeReferences, true);
  const includeCoAuthors = normalizeBoolean(request.includeCoAuthors, false);
  const includeCustomRelations = normalizeBoolean(request.includeCustomRelations, true);
  const includeEmbeddingEdges = normalizeBoolean(request.includeEmbeddingEdges, true);
  const embeddingEdgeLimit = normalizeLimit(request.embeddingEdgeLimit, 80, 0, 300);
  const embeddingMinSimilarity = Number.isFinite(Number(request.embeddingMinSimilarity))
    ? Math.max(-1, Math.min(1, Number(request.embeddingMinSimilarity)))
    : 0.82;
  const search = cleanString(request.search).toLowerCase();
  const localNodeId = cleanString(request.localNodeId);
  const localDepth = normalizeLimit(request.localDepth, 1, 0, 4);
  const graphNodeLimit = normalizeLimit(
    request.graphNodeLimit,
    DEFAULT_GRAPH_NODE_LIMIT,
    1,
    MAX_GRAPH_NODE_LIMIT,
  );
  const graphEdgeLimitPerNode = normalizeLimit(
    request.graphEdgeLimitPerNode,
    DEFAULT_GRAPH_EDGE_LIMIT_PER_NODE,
    1,
    MAX_GRAPH_EDGE_LIMIT_PER_NODE,
  );
  const library = store.load();
  const notes = includeNotes ? noteStore.listNotes({ limit: 5000 }) : [];
  const nodes = new Map();
  const edges = new Map();
  const paperIds = new Set(library.papers.map((paper) => paper.id));
  const paperByDoi = new Map(
    library.papers
      .map((paper) => [normalizeDoi(paper.doi), paper])
      .filter(([doi]) => doi),
  );
  const paperTitleEntries = library.papers
    .map((paper) => ({ id: paper.id, key: normalizeTitleKey(paper.title), paper }))
    .filter((entry) => entry.key);
  const paperByTitle = new Map(
    paperTitleEntries.map((entry) => [entry.key, entry.paper]),
  );
  const paperIdByReference = new Map();

  for (const paper of library.papers) {
    paperIdByReference.set(paper.id, paper.id);
    paperIdByReference.set(`${NATIVE_LIBRARY_PREFIX}${paper.id}`, paper.id);
    paperIdByReference.set(paperNodeId(paper.id), paper.id);
  }

  const resolvePaperReference = (value) => {
    const raw = cleanString(value);
    const normalized = normalizePaperReferenceId(raw);

    return paperIdByReference.get(raw) || paperIdByReference.get(normalized) || '';
  };

  if (includePapers) {
    for (const paper of library.papers) {
      nodes.set(paperNodeId(paper.id), {
        id: paperNodeId(paper.id),
        type: 'paper',
        label: paper.title,
        subtitle: [authorsText(paper), paper.year, paper.publication].filter(Boolean).join(' · '),
        paperId: paper.id,
        size: 34 + Math.min(18, Math.max(0, Number(paper.readingProgress) || 0) * 18),
      });
    }
  }

  if (includeNotes) {
    for (const note of notes) {
      nodes.set(noteNodeId(note.id), {
        id: noteNodeId(note.id),
        type: 'note',
        // 空标题保持空串，由界面按语言显示未命名笔记；不把英文哨兵写进共享数据。
        label: note.title || '',
        subtitle: notePreview(note),
        noteId: note.id,
        paperId: resolvePaperReference(note.linkedPaperId || note.paperId) || undefined,
        size: note.isPinned ? 30 : 24,
      });

      const paperTargets = new Set([
        note.linkedPaperId,
        note.paperId,
        ...(Array.isArray(note.linkedPaperIds) ? note.linkedPaperIds : []),
        ...(Array.isArray(note.anchors) ? note.anchors.map((anchor) => anchor.paperId) : []),
      ].map(resolvePaperReference).filter((paperId) => paperId && paperIds.has(paperId)));

      for (const paperId of paperTargets) {
        const source = noteNodeId(note.id);
        const target = paperNodeId(paperId);
        if (nodes.has(target)) {
          edges.set(uniqueEdgeId('note_paper', source, target), {
            id: uniqueEdgeId('note_paper', source, target),
            source,
            target,
            type: 'note_paper',
            label: 'note',
            weight: 0.72,
          });
        }
      }

      for (const targetNoteId of note.linkedNoteIds ?? []) {
        const source = noteNodeId(note.id);
        const target = noteNodeId(targetNoteId);
        edges.set(uniqueEdgeId('note_link', source, target), {
          id: uniqueEdgeId('note_link', source, target),
          source,
          target,
          type: 'note_link',
          label: 'link',
          weight: 0.82,
        });
      }
    }
  }

  if (includeTags) {
    const tagCounts = new Map();
    for (const paper of library.papers) {
      for (const tag of paper.tags ?? []) {
        const name = cleanString(tag.name);
        if (!name) continue;
        tagCounts.set(name.toLowerCase(), {
          name,
          count: (tagCounts.get(name.toLowerCase())?.count ?? 0) + 1,
        });
      }
    }
    for (const note of notes) {
      for (const tag of note.tags ?? []) {
        const name = cleanString(tag);
        if (!name) continue;
        tagCounts.set(name.toLowerCase(), {
          name,
          count: (tagCounts.get(name.toLowerCase())?.count ?? 0) + 1,
        });
      }
    }

    for (const tag of tagCounts.values()) {
      nodes.set(tagNodeId(tag.name), {
        id: tagNodeId(tag.name),
        type: 'tag',
        label: `#${tag.name}`,
        subtitle: `${tag.count} item${tag.count === 1 ? '' : 's'}`,
        tag: tag.name,
        size: 20 + Math.min(16, tag.count * 2),
      });
    }

    for (const paper of library.papers) {
      for (const tag of paper.tags ?? []) {
        const source = paperNodeId(paper.id);
        const target = tagNodeId(cleanString(tag.name));
        if (!nodes.has(source) || !nodes.has(target)) continue;
        edges.set(uniqueEdgeId('paper_tag', source, target), {
          id: uniqueEdgeId('paper_tag', source, target),
          source,
          target,
          type: 'paper_tag',
          label: 'tag',
          weight: 0.42,
        });
      }
    }

    for (const note of notes) {
      for (const tag of note.tags ?? []) {
        const name = cleanString(tag);
        const source = noteNodeId(note.id);
        const target = tagNodeId(name);
        if (!name || !nodes.has(source) || !nodes.has(target)) continue;
        edges.set(uniqueEdgeId('note_tag', source, target), {
          id: uniqueEdgeId('note_tag', source, target),
          source,
          target,
          type: 'note_tag',
          label: 'tag',
          weight: 0.38,
        });
      }
    }
  }

  if (includeCategories) {
    const categoryById = new Map(library.categories.map((category) => [category.id, category]));
    for (const category of library.categories) {
      if (category.isSystem) continue;
      nodes.set(categoryNodeId(category.id), {
        id: categoryNodeId(category.id),
        type: 'category',
        label: category.name,
        subtitle: 'Collection',
        categoryId: category.id,
        size: 24 + Math.min(14, Number(category.paperCount) || 0),
      });
    }

    for (const paper of library.papers) {
      for (const categoryId of paper.categoryIds ?? []) {
        const category = categoryById.get(categoryId);
        if (!category || category.isSystem) continue;

        const source = paperNodeId(paper.id);
        const target = categoryNodeId(categoryId);
        if (!nodes.has(source) || !nodes.has(target)) continue;
        edges.set(uniqueEdgeId('paper_category', source, target), {
          id: uniqueEdgeId('paper_category', source, target),
          source,
          target,
          type: 'paper_category',
          label: 'category',
          weight: 0.48,
        });
      }
    }
  }

  if (includeReferences) {
    const referencesByPaperId = referenceCandidatesFromCache(store, library.papers);

    for (const paper of library.papers) {
      const source = paperNodeId(paper.id);
      if (!nodes.has(source)) continue;

      const references = referencesByPaperId.get(paper.id) ?? extractPaperReferenceCandidates(paper);
      for (const reference of references) {
        const targetPaper = findReferencedPaper(reference, paper, paperTitleEntries, paperByDoi, paperByTitle);

        if (targetPaper) {
          const target = paperNodeId(targetPaper.id);
          if (!nodes.has(target)) continue;
          const edgeId = uniqueEdgeId('paper_cites_paper', source, target);
          edges.set(edgeId, {
            id: edgeId,
            source,
            target,
            type: 'paper_cites_paper',
            label: 'cites',
            description: reference.raw || reference.title || reference.doi,
            weight: 0.78,
          });
          continue;
        }

        // Crossref may return many references that are outside the local library.
        // Keep them in the cache, but only surface references that resolve to local papers.
      }
    }
  }

  if (includeCoAuthors) {
    addCoAuthorEdges({ papers: library.papers, nodes, edges });
  }

  if (includeEmbeddingEdges && ragStore?.available !== false && typeof ragStore?.listDocumentSimilarities === 'function') {
    const documentKeys = library.papers.flatMap((paper) => [
      paper.id,
      `${NATIVE_LIBRARY_PREFIX}${paper.id}`,
    ]);
    const similarities = await Promise.resolve(ragStore.listDocumentSimilarities({
      documentKeys,
      limit: embeddingEdgeLimit,
      minSimilarity: embeddingMinSimilarity,
    }));
    for (const similarity of similarities) {
      const sourcePaperId = resolvePaperReference(similarity.sourceDocumentKey);
      const targetPaperId = resolvePaperReference(similarity.targetDocumentKey);

      if (!sourcePaperId || !targetPaperId || sourcePaperId === targetPaperId) {
        continue;
      }

      const source = paperNodeId(sourcePaperId);
      const target = paperNodeId(targetPaperId);
      if (!nodes.has(source) || !nodes.has(target)) continue;

      const id = uniqueEdgeId('related_by_embedding', source, target);
      edges.set(id, {
        id,
        source,
        target,
        type: 'related_by_embedding',
        label: 'similar',
        weight: similarity.similarity,
      });
    }
  }

  if (includeCustomRelations) {
    for (const relation of listCustomRelations(appPaths)) {
      if (!nodes.has(relation.source) || !nodes.has(relation.target)) continue;
      edges.set(relation.id, {
        id: relation.id,
        source: relation.source,
        target: relation.target,
        type: relation.type,
        label: relation.label,
        description: relation.description,
        confidence: relation.confidence,
        weight: relation.weight,
        createdAt: relation.createdAt,
        updatedAt: relation.updatedAt,
      });
    }
  }

  let snapshot = {
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()).filter((edge) => nodes.has(edge.source) && nodes.has(edge.target)),
    generatedAt: Date.now(),
  };

  if (search) {
    const matchedNodes = new Set(snapshot.nodes.filter((node) => matchesSearch(node, search)).map((node) => node.id));
    const neighborNodes = new Set(matchedNodes);
    for (const edge of snapshot.edges) {
      if (matchedNodes.has(edge.source)) neighborNodes.add(edge.target);
      if (matchedNodes.has(edge.target)) neighborNodes.add(edge.source);
    }

    snapshot = {
      ...snapshot,
      nodes: snapshot.nodes.filter((node) => neighborNodes.has(node.id)),
      edges: snapshot.edges.filter((edge) => neighborNodes.has(edge.source) && neighborNodes.has(edge.target)),
    };
  }

  return applyGraphBounds(filterLocalGraph(snapshot, localNodeId, localDepth), {
    nodeLimit: graphNodeLimit,
    edgeLimitPerNode: graphEdgeLimitPerNode,
  });
}

function createKnowledgeGraphCommands(context) {
  return {
    async knowledge_graph_get({ request = {} }) {
      return createKnowledgeGraphSnapshot(context, request);
    },
    knowledge_graph_list_relations() {
      return listCustomRelations(context.appPaths);
    },
    knowledge_graph_create_relation({ request = {} }) {
      if (request.type && request.type !== 'custom_relation') {
        throw new Error('Invalid graph relation type.');
      }
      const relation = normalizeCustomRelation(request);

      if (!relation) {
        throw new Error('Invalid graph relation.');
      }

      const store = readRelationStore(context.appPaths);
      const duplicate = store.relations.find((item) =>
        cleanString(item.id) !== relation.id
        && cleanString(item.source) === relation.source
        && cleanString(item.target) === relation.target);
      if (duplicate) {
        throw new Error('A custom relation already exists between these two nodes.');
      }

      const nextRelations = [
        ...store.relations.filter((item) => cleanString(item.id) !== relation.id),
        relation,
      ];
      writeRelationStore(context.appPaths, { version: 1, relations: nextRelations });
      return relation;
    },
    knowledge_graph_update_relation({ relationId = '', request = {} }) {
      const targetId = cleanString(relationId);
      if (!targetId) throw new Error('relationId is required');

      const store = readRelationStore(context.appPaths);
      const existing = store.relations.find((item) => cleanString(item.id) === targetId);
      if (!existing) throw new Error(`Relation does not exist: ${targetId}`);
      if (cleanString(existing.type) === 'ai_suggested') {
        throw new Error('AI relations are retired and cannot be edited.');
      }

      const label = request.label === undefined ? cleanString(existing.label) : cleanString(request.label);
      if (!label) throw new Error('Relation label cannot be empty.');
      if (label.length > MAX_RELATION_LABEL_LENGTH) {
        throw new Error(`Relation label must be at most ${MAX_RELATION_LABEL_LENGTH} characters.`);
      }
      const description = request.description === undefined
        ? cleanString(existing.description)
        : cleanString(request.description);
      if (description.length > MAX_RELATION_DESCRIPTION_LENGTH) {
        throw new Error(`Relation description must be at most ${MAX_RELATION_DESCRIPTION_LENGTH} characters.`);
      }
      const weight = request.weight === undefined
        ? Number(existing.weight) || 0.58
        : Number(request.weight);
      if (!Number.isFinite(weight)) throw new Error('Relation weight must be a number between 0.1 and 1.');

      const updatedAt = Math.max(Date.now(), (Number(existing.updatedAt) || 0) + 1);
      const nextRelation = {
        ...existing,
        // 端点固定：首版只允许改标签、说明与权重。
        source: existing.source,
        target: existing.target,
        type: 'custom_relation',
        label,
        description,
        weight: Math.max(0.1, Math.min(1, weight)),
        updatedAt,
      };

      writeRelationStore(context.appPaths, {
        version: 1,
        relations: store.relations.map((item) =>
          cleanString(item.id) === targetId ? nextRelation : item),
      });
      return nextRelation;
    },
    knowledge_graph_delete_relation({ relationId }) {
      const targetId = cleanString(relationId);
      const store = readRelationStore(context.appPaths);
      const nextRelations = store.relations.filter((item) => cleanString(item.id) !== targetId);
      writeRelationStore(context.appPaths, { version: 1, relations: nextRelations });
      return { deleted: nextRelations.length !== store.relations.length };
    },
  };
}

module.exports = {
  DEFAULT_GRAPH_EDGE_LIMIT_PER_NODE,
  DEFAULT_GRAPH_NODE_LIMIT,
  MAX_GRAPH_EDGE_LIMIT_PER_NODE,
  MAX_GRAPH_NODE_LIMIT,
  MAX_RELATION_DESCRIPTION_LENGTH,
  MAX_RELATION_LABEL_LENGTH,
  applyGraphBounds,
  createKnowledgeGraphCommands,
  createKnowledgeGraphSnapshot,
  extractPaperReferenceCandidates,
  migrateRetiredAiRelations,
};
