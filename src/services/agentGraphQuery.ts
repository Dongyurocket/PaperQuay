/**
 * 图谱只读查询的纯计算层（方案第 7 节）。
 *
 * 输入均为已经取回的节点与边：零 IPC、零模型调用，便于 node --test 单测。
 * 节点 id 规则与后端一致：`paper:${paperId}`、`note:${noteId}`。
 */

export interface GraphRawNode {
  id: string;
  type: string;
  label: string;
  paperId?: string;
  noteId?: string;
}

export interface GraphRawEdge {
  id?: string;
  source: string;
  target: string;
  type: string;
  label?: string;
}

export interface GraphNeighborNode {
  id: string;
  type: string;
  label: string;
  paperId?: string;
  noteId?: string;
}

export interface GraphNeighborEdge {
  source: string;
  target: string;
  type: string;
  label: string;
}

export interface GraphNeighborResult {
  focusId: string;
  focusLabel: string;
  nodes: GraphNeighborNode[];
  edges: GraphNeighborEdge[];
  truncated: boolean;
}

export interface GraphMissingEdge {
  leftPaperId: string;
  rightPaperId: string;
  leftTitle: string;
  rightTitle: string;
  sharedTags: string[];
  sharedCategoryIds: string[];
  reason: 'shared-tag' | 'shared-category' | 'embedding-near';
}

export interface GraphConceptTopic {
  noteId: string;
  title: string;
  definitionSnippet: string;
  linkedPaperIds: string[];
  linkedPaperCount: number;
}

export interface GraphConceptNoteInput {
  id: string;
  title?: string | null;
  pageKind?: string | null;
  content?: string | null;
  contentText?: string | null;
  paperId?: string | null;
  linkedPaperIds?: string[] | null;
}

export const GRAPH_NEIGHBOR_MAX_NODES = 40;
export const GRAPH_NEIGHBOR_MAX_EDGES = 80;
export const GRAPH_MISSING_EDGE_MAX_PAPERS = 12;
export const GRAPH_MISSING_EDGE_MAX_PAIRS = 24;
export const GRAPH_CONCEPT_DEFINITION_SNIPPET_CHARS = 240;
export const DEFAULT_GRAPH_EXCLUDED_EDGE_TYPES: readonly string[] = [
  'co_author',
  'related_by_embedding',
];

/** 共作者与向量相似边数量大，默认不进邻域结果，避免淹没引用与笔记连接。 */
const CONNECTING_EDGE_TYPES: ReadonlySet<string> = new Set([
  'paper_cites_paper',
  'paper_reference',
  'custom_relation',
  'ai_suggested',
]);
const NOTE_BRIDGE_EDGE_TYPES: ReadonlySet<string> = new Set(['note_paper', 'note_link']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function cleanId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 工具参数使用论文 id 或笔记 id，不要求模型自己拼前缀。
 * 模型拼错前缀时先去掉已知前缀，再由调用方统一拼接。
 */
export function normalizeGraphPaperId(value: unknown): string {
  let id = cleanId(value);
  for (const prefix of ['native-library:', 'paper:']) {
    if (id.startsWith(prefix)) {
      id = id.slice(prefix.length);
    }
  }
  return id;
}

export function paperGraphNodeId(paperId: string): string {
  return `paper:${normalizeGraphPaperId(paperId)}`;
}

/**
 * 对图谱邻域做整形：默认排除共作者边与向量边，节点/边上限截断。
 * focusId 在节点列表中不存在时返回空结果（未知 id 不抛异常）。
 */
export function reshapeGraphNeighbors(
  rawGraph: { nodes?: GraphRawNode[]; edges?: GraphRawEdge[] } | null | undefined,
  options: {
    focusId?: string;
    maxNodes?: number;
    maxEdges?: number;
    excludeEdgeTypes?: readonly string[];
  } = {},
): GraphNeighborResult {
  const focusId = cleanId(options.focusId);
  const maxNodes = Math.max(1, Math.trunc(options.maxNodes ?? GRAPH_NEIGHBOR_MAX_NODES));
  const maxEdges = Math.max(1, Math.trunc(options.maxEdges ?? GRAPH_NEIGHBOR_MAX_EDGES));
  const excluded = new Set(options.excludeEdgeTypes ?? DEFAULT_GRAPH_EXCLUDED_EDGE_TYPES);
  const rawNodes = Array.isArray(rawGraph?.nodes) ? rawGraph.nodes : [];
  const rawEdges = Array.isArray(rawGraph?.edges) ? rawGraph.edges : [];

  const focusNode = focusId
    ? rawNodes.find((node) => isRecord(node) && node.id === focusId)
    : undefined;

  if (focusId && !focusNode) {
    return { focusId, focusLabel: '', nodes: [], edges: [], truncated: false };
  }

  const orderedNodes = focusNode
    ? [focusNode, ...rawNodes.filter((node) => node !== focusNode)]
    : rawNodes;
  const keptNodes = orderedNodes.slice(0, maxNodes);
  const keptNodeIds = new Set(keptNodes.map((node) => node.id));

  const filteredEdges = rawEdges.filter(
    (edge) =>
      isRecord(edge) &&
      !excluded.has(edge.type) &&
      keptNodeIds.has(edge.source) &&
      keptNodeIds.has(edge.target),
  );
  const keptEdges = filteredEdges.slice(0, maxEdges);
  const truncated = orderedNodes.length > keptNodes.length || filteredEdges.length > keptEdges.length;

  return {
    focusId,
    focusLabel: focusNode?.label ?? '',
    nodes: keptNodes.map((node) => ({
      id: node.id,
      type: node.type,
      label: node.label,
      ...(node.paperId ? { paperId: node.paperId } : {}),
      ...(node.noteId ? { noteId: node.noteId } : {}),
    })),
    edges: keptEdges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      type: edge.type,
      label: edge.label ?? '',
    })),
    truncated,
  };
}

function normalizeTagName(value: unknown): string {
  return cleanId(value).toLocaleLowerCase();
}

function pairKeyOf(leftNodeId: string, rightNodeId: string): string {
  return leftNodeId < rightNodeId
    ? `${leftNodeId}${rightNodeId}`
    : `${rightNodeId}${leftNodeId}`;
}

/**
 * 识别有潜在关联但库内尚未连接的论文对。
 *
 * 「已连接」判定（红线：仅共享标签/分类自身不算已连接）：
 * - 存在直接引用（paper_cites_paper / paper_reference）；
 * - 存在自定义关系（custom_relation / ai_suggested）；
 * - 双方通过同一篇笔记桥接（都经 note_paper / note_link 连到同一个 note: 节点）。
 *
 * 缺边理由优先级：shared-tag > shared-category > embedding-near；
 * 无共享标签/分类或达阈值向量对的不报缺边。最多输出 24 对。
 */
export function findMissingPaperEdges(input: {
  papers: Array<{ id: string; title: string; tagNames: string[]; categoryIds: string[] }>;
  edges: Array<{ source: string; target: string; type: string }>;
  embeddingPairs?: Array<{ leftPaperId: string; rightPaperId: string; similarity: number }>;
  embeddingMinSimilarity?: number;
}): GraphMissingEdge[] {
  const papers = (Array.isArray(input?.papers) ? input.papers : [])
    .filter((paper) => isRecord(paper) && cleanId(paper.id))
    .slice(0, GRAPH_MISSING_EDGE_MAX_PAPERS);

  if (papers.length < 2) {
    return [];
  }

  const edges = Array.isArray(input?.edges) ? input.edges : [];
  const directlyConnectedPairs = new Set<string>();
  const bridgedNoteIdsByPaperNode = new Map<string, Set<string>>();

  for (const edge of edges) {
    if (!isRecord(edge)) {
      continue;
    }

    const source = cleanId(edge.source);
    const target = cleanId(edge.target);
    const type = cleanId(edge.type);

    if (!source || !target || source === target) {
      continue;
    }

    if (
      CONNECTING_EDGE_TYPES.has(type) &&
      source.startsWith('paper:') &&
      target.startsWith('paper:')
    ) {
      directlyConnectedPairs.add(pairKeyOf(source, target));
    }

    if (NOTE_BRIDGE_EDGE_TYPES.has(type)) {
      for (const [maybePaper, maybeNote] of [[source, target], [target, source]] as const) {
        if (maybePaper.startsWith('paper:') && maybeNote.startsWith('note:')) {
          const set = bridgedNoteIdsByPaperNode.get(maybePaper) ?? new Set<string>();
          set.add(maybeNote);
          bridgedNoteIdsByPaperNode.set(maybePaper, set);
        }
      }
    }
  }

  const minSimilarity = Number.isFinite(Number(input?.embeddingMinSimilarity))
    ? Number(input.embeddingMinSimilarity)
    : 0.82;
  const embeddingSimilarityByPair = new Map<string, number>();

  for (const pair of Array.isArray(input?.embeddingPairs) ? input.embeddingPairs : []) {
    if (!isRecord(pair)) {
      continue;
    }

    const leftNodeId = paperGraphNodeId(String(pair.leftPaperId ?? ''));
    const rightNodeId = paperGraphNodeId(String(pair.rightPaperId ?? ''));
    const similarity = Number(pair.similarity);

    if (!leftNodeId || !rightNodeId || leftNodeId === rightNodeId || !Number.isFinite(similarity)) {
      continue;
    }

    embeddingSimilarityByPair.set(pairKeyOf(leftNodeId, rightNodeId), similarity);
  }

  const isConnected = (leftNodeId: string, rightNodeId: string): boolean => {
    if (directlyConnectedPairs.has(pairKeyOf(leftNodeId, rightNodeId))) {
      return true;
    }

    const leftNotes = bridgedNoteIdsByPaperNode.get(leftNodeId);
    const rightNotes = bridgedNoteIdsByPaperNode.get(rightNodeId);

    if (!leftNotes || !rightNotes) {
      return false;
    }

    for (const noteNodeId of leftNotes) {
      if (rightNotes.has(noteNodeId)) {
        return true;
      }
    }

    return false;
  };

  const missing: GraphMissingEdge[] = [];

  for (let leftIndex = 0; leftIndex < papers.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < papers.length; rightIndex += 1) {
      const left = papers[leftIndex];
      const right = papers[rightIndex];
      const leftNodeId = paperGraphNodeId(left.id);
      const rightNodeId = paperGraphNodeId(right.id);

      if (leftNodeId === rightNodeId || isConnected(leftNodeId, rightNodeId)) {
        continue;
      }

      const rightTagNames = new Set(
        (Array.isArray(right.tagNames) ? right.tagNames : []).map(normalizeTagName).filter(Boolean),
      );
      const sharedTags: string[] = [];
      const seenSharedTags = new Set<string>();

      for (const tagName of Array.isArray(left.tagNames) ? left.tagNames : []) {
        const normalized = normalizeTagName(tagName);

        if (normalized && rightTagNames.has(normalized) && !seenSharedTags.has(normalized)) {
          seenSharedTags.add(normalized);
          sharedTags.push(cleanId(tagName));
        }
      }

      const rightCategoryIds = new Set(
        (Array.isArray(right.categoryIds) ? right.categoryIds : []).map(cleanId).filter(Boolean),
      );
      const sharedCategoryIds = [
        ...new Set(
          (Array.isArray(left.categoryIds) ? left.categoryIds : [])
            .map(cleanId)
            .filter((categoryId) => categoryId && rightCategoryIds.has(categoryId)),
        ),
      ];
      const embeddingSimilarity = embeddingSimilarityByPair.get(pairKeyOf(leftNodeId, rightNodeId));

      const reason: GraphMissingEdge['reason'] | null =
        sharedTags.length > 0
          ? 'shared-tag'
          : sharedCategoryIds.length > 0
            ? 'shared-category'
            : embeddingSimilarity !== undefined && embeddingSimilarity >= minSimilarity
              ? 'embedding-near'
              : null;

      if (!reason) {
        continue;
      }

      missing.push({
        leftPaperId: normalizeGraphPaperId(left.id),
        rightPaperId: normalizeGraphPaperId(right.id),
        leftTitle: cleanId(left.title) || leftPaperTitleFallback(left.id),
        rightTitle: cleanId(right.title) || leftPaperTitleFallback(right.id),
        sharedTags,
        sharedCategoryIds,
        reason,
      });
    }
  }

  return missing.slice(0, GRAPH_MISSING_EDGE_MAX_PAIRS);
}

function leftPaperTitleFallback(paperId: string): string {
  return normalizeGraphPaperId(paperId);
}

/**
 * 提取概念笔记列表（pageKind: 'concept'）：
 * 取正文前 240 字符为 definitionSnippet，统计关联文献数与 linkedPaperIds。
 */
export function groupConceptTopics(
  notes: GraphConceptNoteInput[] | null | undefined,
): GraphConceptTopic[] {
  return (Array.isArray(notes) ? notes : [])
    .filter((note) => isRecord(note) && note.pageKind === 'concept' && cleanId(note.id))
    .map((note) => {
      const body = (typeof note.contentText === 'string' && note.contentText.trim()
        ? note.contentText
        : typeof note.content === 'string'
          ? note.content
          : ''
      )
        .replace(/\s+/g, ' ')
        .trim();
      const linkedPaperIds = [
        ...new Set(
          [note.paperId, ...(Array.isArray(note.linkedPaperIds) ? note.linkedPaperIds : [])]
            .map(cleanId)
            .filter(Boolean),
        ),
      ];

      return {
        noteId: cleanId(note.id),
        title: cleanId(note.title) || 'Untitled Note',
        definitionSnippet: body.slice(0, GRAPH_CONCEPT_DEFINITION_SNIPPET_CHARS),
        linkedPaperIds,
        linkedPaperCount: linkedPaperIds.length,
      };
    });
}
