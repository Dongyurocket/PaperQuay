// S5-GRAPH-2: snapshot bounds reported by the backend. The shared snapshot
// type lives outside the graph feature, so this module reads the optional
// metadata defensively and formats the user-facing sampling notice.

import type { KnowledgeGraphSnapshot } from '../../types/knowledgeGraph.ts';

export interface KnowledgeGraphSnapshotMetadata {
  sampled: boolean;
  truncated: boolean;
  nodeLimit: number;
  edgeLimitPerNode: number;
  totalNodes: number;
  returnedNodes: number;
  totalEdges: number;
  returnedEdges: number;
}

function toFiniteInt(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : fallback;
}

export function readSnapshotMetadata(
  snapshot: KnowledgeGraphSnapshot & { metadata?: unknown },
): KnowledgeGraphSnapshotMetadata | null {
  const raw = snapshot?.metadata;
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const record = raw as Record<string, unknown>;
  return {
    sampled: record.sampled === true,
    truncated: record.truncated === true,
    nodeLimit: toFiniteInt(record.nodeLimit),
    edgeLimitPerNode: toFiniteInt(record.edgeLimitPerNode),
    totalNodes: toFiniteInt(record.totalNodes),
    returnedNodes: toFiniteInt(record.returnedNodes),
    totalEdges: toFiniteInt(record.totalEdges),
    returnedEdges: toFiniteInt(record.returnedEdges),
  };
}

export function formatGraphSamplingSummary(
  metadata: KnowledgeGraphSnapshotMetadata | null,
  language: 'zh' | 'en' = 'en',
): string {
  if (!metadata || !metadata.truncated) {
    return '';
  }

  if (language === 'zh') {
    return metadata.sampled
      ? `已抽样 ${metadata.returnedNodes}/${metadata.totalNodes} 个节点`
      : `已裁剪 ${metadata.returnedEdges}/${metadata.totalEdges} 条关系`;
  }

  return metadata.sampled
    ? `Sampled ${metadata.returnedNodes}/${metadata.totalNodes} nodes`
    : `Trimmed ${metadata.returnedEdges}/${metadata.totalEdges} edges`;
}
