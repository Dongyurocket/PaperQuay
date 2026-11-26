import { invoke } from '../platform/electron/core.ts';
import type {
  KnowledgeGraphRelation,
  KnowledgeGraphRelationCreateRequest,
  KnowledgeGraphRelationUpdateRequest,
  KnowledgeGraphRequest,
  KnowledgeGraphSnapshot,
} from '../types/knowledgeGraph';

function toErrorMessage(error: unknown, fallback: string): string {
  const message =
    error instanceof Error && error.message
      ? error.message
      : typeof error === 'string'
        ? error
        : fallback;
  const cleaned = message
    .replace(/^Error invoking remote method 'paperquay:invoke':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim();

  return cleaned || fallback;
}

export async function getKnowledgeGraph(
  request: KnowledgeGraphRequest = {},
): Promise<KnowledgeGraphSnapshot> {
  try {
    return await invoke<KnowledgeGraphSnapshot>('knowledge_graph_get', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取知识图谱失败'));
  }
}

/**
 * 文献/笔记/RAG 变更后让主进程丢弃图谱快照缓存。
 * 失败不应阻断 UI 刷新：下一次 knowledge_graph_get 仍会因修订号/TTL 失效。
 */
export async function invalidateKnowledgeGraphCache(): Promise<void> {
  try {
    await invoke('knowledge_graph_invalidate_cache');
  } catch {
    // Cache invalidation is best-effort; the revision key still protects correctness.
  }
}

export async function listKnowledgeGraphRelations(): Promise<KnowledgeGraphRelation[]> {  try {
    return await invoke<KnowledgeGraphRelation[]>('knowledge_graph_list_relations');
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取知识图谱关系失败'));
  }
}

export async function createKnowledgeGraphRelation(
  request: KnowledgeGraphRelationCreateRequest,
): Promise<KnowledgeGraphRelation> {
  try {
    return await invoke<KnowledgeGraphRelation>('knowledge_graph_create_relation', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '创建知识图谱关系失败'));
  }
}

export async function updateKnowledgeGraphRelation(
  relationId: string,
  request: KnowledgeGraphRelationUpdateRequest,
): Promise<KnowledgeGraphRelation> {
  try {
    return await invoke<KnowledgeGraphRelation>('knowledge_graph_update_relation', { relationId, request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '更新知识图谱关系失败'));
  }
}

export async function deleteKnowledgeGraphRelation(relationId: string): Promise<{ deleted: boolean }> {
  try {
    return await invoke<{ deleted: boolean }>('knowledge_graph_delete_relation', { relationId });
  } catch (error) {
    throw new Error(toErrorMessage(error, '删除知识图谱关系失败'));
  }
}
