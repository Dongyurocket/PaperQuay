import { invoke } from '../platform/electron/core';
import type {
  KnowledgeGraphAiOptions,
  KnowledgeGraphAiRelationSuggestion,
  KnowledgeGraphAiSuggestRequest,
  KnowledgeGraphRelation,
  KnowledgeGraphRelationCreateRequest,
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

  if (/upstream request failed|upstream_error|HTTP\s+502|bad gateway/i.test(cleaned)) {
    return '模型服务上游请求失败。PaperQuay 已尝试兼容模式；如果仍失败，请稍后重试，或把该模型预设的接口格式切换为 Chat Completions。';
  }

  if (/AI graph relation generation failed/i.test(cleaned)) {
    return cleaned.replace(/^AI graph relation generation failed:\s*/i, '生成知识图谱关系失败：');
  }

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

export async function listKnowledgeGraphRelations(): Promise<KnowledgeGraphRelation[]> {
  try {
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

export async function deleteKnowledgeGraphRelation(relationId: string): Promise<{ deleted: boolean }> {
  try {
    return await invoke<{ deleted: boolean }>('knowledge_graph_delete_relation', { relationId });
  } catch (error) {
    throw new Error(toErrorMessage(error, '删除知识图谱关系失败'));
  }
}

export async function suggestKnowledgeGraphRelations(
  request: KnowledgeGraphAiSuggestRequest,
  options: KnowledgeGraphAiOptions,
): Promise<KnowledgeGraphAiRelationSuggestion[]> {
  try {
    return await invoke<KnowledgeGraphAiRelationSuggestion[]>('knowledge_graph_suggest_relations', {
      request,
      options,
    });
  } catch (error) {
    throw new Error(toErrorMessage(error, '生成知识图谱关系失败'));
  }
}
