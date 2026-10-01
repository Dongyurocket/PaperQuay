/**
 * 图谱探索能力编排（方案第 5.4 / 7 节）。
 *
 * 按 neighbors -> gaps -> topics -> report 编排三个只读查询并生成报告。
 * 阶段 F 之前不做任何图谱写入：不调用 createKnowledgeGraphRelation，
 * 不写 paperquay-knowledge-graph-relations.json，报告仅留在当次运行。
 *
 * 取数 loader（loadGraphNeighbors / loadMissingPaperEdges / loadConceptTopics）
 * 同时被 agentTools.ts 的三个只读工具与本能力复用，保证 ReAct 临时查图与
 * 阶段报告不分裂成两套检索逻辑。纯计算全部在 agentGraphQuery.ts。
 */

import { getKnowledgeGraph } from './knowledgeGraph.ts';
import { searchNotes } from './notes.ts';
import {
  findMissingPaperEdges,
  groupConceptTopics,
  normalizeGraphPaperId,
  paperGraphNodeId,
  reshapeGraphNeighbors,
  GRAPH_MISSING_EDGE_MAX_PAPERS,
  type GraphConceptNoteInput,
  type GraphConceptTopic,
  type GraphMissingEdge,
  type GraphNeighborResult,
  type GraphRawEdge,
} from './agentGraphQuery.ts';
import type { KnowledgeGraphSnapshot } from '../types/knowledgeGraph.ts';

export type GraphExploreStage = 'neighbors' | 'gaps' | 'topics' | 'report';

export type GraphExploreEvent =
  | { kind: 'stage_start'; stage: GraphExploreStage; attempt: number }
  | { kind: 'stage_progress'; stage: GraphExploreStage; completed: number; total: number; detail?: string }
  | { kind: 'stage_end'; stage: GraphExploreStage }
  | { kind: 'stage_retry'; stage: GraphExploreStage; attempt: number; error: string };

export interface GraphExploreReport {
  markdown: string;
  neighbors: GraphNeighborResult[];
  missingEdges: GraphMissingEdge[];
  topics: GraphConceptTopic[];
}

/**
 * 报告中使用到的论文作为当次绑定输入（第 3.3 节）：
 * 由 graph-explore 把报告所用论文补进证据绑定，而不是让绑定函数去查库。
 */
export interface GraphExploreCitation {
  label: string;
  paperId: string;
  paperTitle: string;
  pageIndex: number | null;
  blockId: string | null;
  previewText: string;
}

export interface GraphExplorePaperInput {
  id: string;
  title: string;
  tagNames: string[];
  categoryIds: string[];
  /** 与 search_library 相同的检索文本（标题/作者/标签/摘要等拼接小写）。 */
  searchText?: string;
}

export type GraphExploreFetchGraph = (request: {
  localNodeId: string;
  localDepth: number;
  includeCoAuthors: boolean;
  includeEmbeddingEdges: boolean;
  includeReferences: boolean;
  embeddingEdgeLimit: number;
  includeNotes: boolean;
}) => Promise<KnowledgeGraphSnapshot>;

export interface GraphExploreDeps {
  /** 测试注入点；缺省走 knowledge_graph_get IPC。 */
  fetchGraph?: GraphExploreFetchGraph;
  /** 测试注入点；缺省走 notes_search IPC。 */
  searchConceptNotes?: (query: string) => Promise<GraphConceptNoteInput[]>;
}

function abortError(): Error {
  const error = new Error('Graph explore cancelled');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw abortError();
  }
}

/** 读取单篇论文的图谱邻域（只读）。深度上限 2，避免把全图拉进结果。 */
export async function loadGraphNeighbors(
  paperId: string,
  options: { depth?: 1 | 2; includeNotes?: boolean; fetchGraph?: GraphExploreFetchGraph } = {},
): Promise<GraphNeighborResult> {
  const normalizedPaperId = normalizeGraphPaperId(paperId);
  const focusId = paperGraphNodeId(normalizedPaperId);
  const fetchGraph = options.fetchGraph ?? getKnowledgeGraph;
  const snapshot = await fetchGraph({
    localNodeId: focusId,
    localDepth: options.depth === 2 ? 2 : 1,
    includeCoAuthors: false,
    includeEmbeddingEdges: false,
    includeReferences: true,
    embeddingEdgeLimit: 0,
    includeNotes: options.includeNotes !== false,
  });

  return reshapeGraphNeighbors(snapshot, { focusId });
}

/**
 * 查找论文集合内的潜在缺边（只读）。
 * 对每篇论文各取一次深度 1 邻域并在本函数内合并；不调用不带 localNodeId 的全图快照。
 */
export async function loadMissingPaperEdges(
  papers: GraphExplorePaperInput[],
  options: { fetchGraph?: GraphExploreFetchGraph; signal?: AbortSignal } = {},
): Promise<GraphMissingEdge[]> {
  const targets = papers
    .filter((paper) => normalizeGraphPaperId(paper.id))
    .slice(0, GRAPH_MISSING_EDGE_MAX_PAPERS);

  if (targets.length < 2) {
    return [];
  }

  const fetchGraph = options.fetchGraph ?? getKnowledgeGraph;
  const mergedEdges = new Map<string, GraphRawEdge>();

  for (const paper of targets) {
    throwIfAborted(options.signal);
    const snapshot = await fetchGraph({
      localNodeId: paperGraphNodeId(paper.id),
      localDepth: 1,
      includeCoAuthors: false,
      includeEmbeddingEdges: false,
      includeReferences: true,
      embeddingEdgeLimit: 0,
      includeNotes: true,
    });

    for (const edge of snapshot.edges ?? []) {
      const key = edge.id || `${edge.type}:${edge.source}->${edge.target}`;

      if (!mergedEdges.has(key)) {
        mergedEdges.set(key, edge);
      }
    }
  }

  return findMissingPaperEdges({
    papers: targets.map((paper) => ({
      id: paper.id,
      title: paper.title,
      tagNames: paper.tagNames,
      categoryIds: paper.categoryIds,
    })),
    edges: [...mergedEdges.values()].map((edge) => ({
      source: edge.source,
      target: edge.target,
      type: edge.type,
    })),
  });
}

/** 聚合概念笔记主题（只读）。query 为空时列出最近的概念页。 */
export async function loadConceptTopics(
  query: string,
  options: { searchConceptNotes?: GraphExploreDeps['searchConceptNotes'] } = {},
): Promise<GraphConceptTopic[]> {
  const trimmedQuery = query.trim();
  const search = options.searchConceptNotes;

  if (search) {
    return groupConceptTopics(await search(trimmedQuery));
  }

  const result = await searchNotes({
    ...(trimmedQuery ? { query: trimmedQuery } : {}),
    pageKind: 'concept',
    limit: 15,
  });

  return groupConceptTopics(result.notes);
}

/**
 * 焦点论文：优先当前文献范围；未选择时按 search_library 的同一匹配逻辑
 * （检索文本包含查询 / 标题出现在指令中）从指令解析，最多 8 篇。
 */
export function resolveGraphExploreFocusPapers(input: {
  instruction: string;
  papers: GraphExplorePaperInput[];
  currentPaperScopeIds?: string[];
}): GraphExplorePaperInput[] {
  const scopeIds = new Set(
    (input.currentPaperScopeIds ?? []).map(normalizeGraphPaperId).filter(Boolean),
  );
  const scoped = input.papers.filter((paper) => scopeIds.has(normalizeGraphPaperId(paper.id)));

  if (scoped.length > 0) {
    return scoped.slice(0, 8);
  }

  const instruction = input.instruction.trim().toLocaleLowerCase();

  if (!instruction) {
    return [];
  }

  const matched = input.papers.filter((paper) => {
    const title = paper.title.trim().toLocaleLowerCase();

    if (title.length >= 4 && instruction.includes(title)) {
      return true;
    }

    return Boolean(paper.searchText && paper.searchText.includes(instruction));
  });

  return matched.slice(0, 8);
}

function edgeTypeCounts(result: GraphNeighborResult): string {
  const counts = new Map<string, number>();

  for (const edge of result.edges) {
    counts.set(edge.type, (counts.get(edge.type) ?? 0) + 1);
  }

  const labels: Record<string, string> = {
    paper_cites_paper: '引用',
    paper_reference: '参考文献',
    note_paper: '笔记',
    note_link: '笔记链接',
    paper_tag: '标签',
    paper_category: '分类',
    custom_relation: '自定义关系',
    ai_suggested: 'AI 建议',
  };

  return [...counts.entries()]
    .map(([type, count]) => `${labels[type] ?? type} ${count}`)
    .join(' · ');
}

function buildGraphExploreMarkdown(input: {
  focusPapers: GraphExplorePaperInput[];
  hasPaperScope: boolean;
  neighbors: GraphNeighborResult[];
  missingEdges: GraphMissingEdge[];
  topics: GraphConceptTopic[];
}): string {
  const parts: string[] = ['# 图谱探索报告', ''];

  parts.push('## 焦点文献', '');

  if (input.focusPapers.length > 0) {
    for (const paper of input.focusPapers) {
      parts.push(`- 《${paper.title}》`);
    }
  } else {
    parts.push(
      input.hasPaperScope
        ? '当前文献范围内没有可用文献。'
        : '未识别到论文焦点：未选择文献，且指令中没有匹配到库内文献标题。本次仅汇总概念主题。',
    );
  }

  if (input.neighbors.length > 0) {
    parts.push('', '## 邻域概览', '');

    for (const neighbor of input.neighbors) {
      const summary = edgeTypeCounts(neighbor);
      parts.push(
        `- 《${neighbor.focusLabel || neighbor.focusId}》：${neighbor.nodes.length} 个节点、${neighbor.edges.length} 条边` +
        `${summary ? `（${summary}）` : ''}${neighbor.truncated ? '（结果已按上限截断）' : ''}`,
      );
    }
  }

  parts.push('', '## 潜在缺边', '');

  if (input.missingEdges.length > 0) {
    parts.push('以下论文对共享标签或分类，但当前库内没有这些关系（这不代表两篇论文无关）：', '');

    input.missingEdges.forEach((edge, index) => {
      const details = [
        edge.sharedTags.length > 0 ? `共享标签：${edge.sharedTags.join('、')}` : '',
        edge.sharedCategoryIds.length > 0 ? `共享分类：${edge.sharedCategoryIds.join('、')}` : '',
      ].filter(Boolean).join('；');
      parts.push(`${index + 1}. 《${edge.leftTitle}》 × 《${edge.rightTitle}》${details ? ` — ${details}` : ''}`);
    });
  } else if (input.focusPapers.length >= 2) {
    parts.push('焦点文献之间没有发现共享标签或分类的未连接论文对。');
  } else {
    parts.push('无论文焦点，跳过缺边分析。');
  }

  parts.push('', '## 概念主题', '');

  if (input.topics.length > 0) {
    for (const topic of input.topics) {
      const suffix = topic.linkedPaperCount > 0 ? `关联 ${topic.linkedPaperCount} 篇文献` : '未关联文献';
      parts.push(`- **${topic.title}**（${suffix}）${topic.definitionSnippet ? `：${topic.definitionSnippet}` : ''}`);
    }
  } else {
    parts.push('库内暂无概念页（pageKind: concept）。');
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

function collectReportCitations(input: {
  focusPapers: GraphExplorePaperInput[];
  neighbors: GraphNeighborResult[];
  missingEdges: GraphMissingEdge[];
  topics: GraphConceptTopic[];
  papers: GraphExplorePaperInput[];
}): GraphExploreCitation[] {
  const citations: GraphExploreCitation[] = [];
  const seen = new Set<string>();
  const titleById = new Map(input.papers.map((paper) => [normalizeGraphPaperId(paper.id), paper.title]));

  const push = (paperId: string, title?: string) => {
    const normalizedId = normalizeGraphPaperId(paperId);

    if (!normalizedId || seen.has(normalizedId)) {
      return;
    }

    seen.add(normalizedId);
    citations.push({
      label: String(citations.length + 1),
      paperId: normalizedId,
      paperTitle: title?.trim() || titleById.get(normalizedId) || normalizedId,
      pageIndex: null,
      blockId: null,
      previewText: '',
    });
  };

  for (const paper of input.focusPapers) {
    push(paper.id, paper.title);
  }

  for (const neighbor of input.neighbors) {
    for (const node of neighbor.nodes) {
      if (node.type === 'paper' && node.paperId) {
        push(node.paperId, node.label);
      }
    }
  }

  for (const edge of input.missingEdges) {
    push(edge.leftPaperId, edge.leftTitle);
    push(edge.rightPaperId, edge.rightTitle);
  }

  for (const topic of input.topics) {
    for (const paperId of topic.linkedPaperIds) {
      push(paperId);
    }
  }

  return citations;
}

/**
 * graph-explore 能力入口：编排三个只读查询并生成结构化报告。
 * 不调用 suggestKnowledgeGraphRelations / createKnowledgeGraphRelation，不发起模型调用。
 */
export async function runGraphExploreCapability(input: {
  instruction: string;
  papers: GraphExplorePaperInput[];
  currentPaperScopeIds?: string[];
  signal?: AbortSignal;
  onEvent?: (event: GraphExploreEvent) => void;
  fetchGraph?: GraphExploreFetchGraph;
  searchConceptNotes?: GraphExploreDeps['searchConceptNotes'];
}): Promise<{ kind: 'graph-report'; report: GraphExploreReport; citations: GraphExploreCitation[] }> {
  const emit = (event: GraphExploreEvent) => input.onEvent?.(event);
  const papers = Array.isArray(input.papers) ? input.papers : [];
  const focusPapers = resolveGraphExploreFocusPapers({
    instruction: input.instruction,
    papers,
    currentPaperScopeIds: input.currentPaperScopeIds,
  });

  throwIfAborted(input.signal);

  // neighbors
  emit({ kind: 'stage_start', stage: 'neighbors', attempt: 1 });
  const neighbors: GraphNeighborResult[] = [];

  for (const [index, paper] of focusPapers.entries()) {
    throwIfAborted(input.signal);
    neighbors.push(await loadGraphNeighbors(paper.id, {
      depth: 1,
      includeNotes: true,
      fetchGraph: input.fetchGraph,
    }));
    emit({
      kind: 'stage_progress',
      stage: 'neighbors',
      completed: index + 1,
      total: focusPapers.length,
      detail: paper.title,
    });
  }

  emit({ kind: 'stage_end', stage: 'neighbors' });

  // gaps
  emit({ kind: 'stage_start', stage: 'gaps', attempt: 1 });
  const missingEdges = focusPapers.length >= 2
    ? await loadMissingPaperEdges(focusPapers, { fetchGraph: input.fetchGraph, signal: input.signal })
    : [];
  emit({ kind: 'stage_end', stage: 'gaps' });

  // topics
  throwIfAborted(input.signal);
  emit({ kind: 'stage_start', stage: 'topics', attempt: 1 });
  const topics = await loadConceptTopics(input.instruction, {
    searchConceptNotes: input.searchConceptNotes,
  });
  emit({ kind: 'stage_end', stage: 'topics' });

  // report
  emit({ kind: 'stage_start', stage: 'report', attempt: 1 });
  const report: GraphExploreReport = {
    markdown: buildGraphExploreMarkdown({
      focusPapers,
      hasPaperScope: (input.currentPaperScopeIds ?? []).length > 0,
      neighbors,
      missingEdges,
      topics,
    }),
    neighbors,
    missingEdges,
    topics,
  };
  const citations = collectReportCitations({
    focusPapers,
    neighbors,
    missingEdges,
    topics,
    papers,
  });
  emit({ kind: 'stage_end', stage: 'report' });

  return { kind: 'graph-report', report, citations };
}
