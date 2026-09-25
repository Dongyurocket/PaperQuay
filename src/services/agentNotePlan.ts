import type { Note, NotePageKind, NoteType } from '../types/notes';

// 运行时才加载 notes 服务：测试环境没有 Electron invoke 通道，
// 动态导入让纯计划构建逻辑保持可测，调用失败时按操作降级而非崩溃。
type NotesService = typeof import('./notes');

async function loadNotesService(): Promise<NotesService> {
  return import('./notes');
}

export interface AgentNoteWriteOperation {
  kind: 'create' | 'update' | 'delete';
  /** update/delete 必填。 */
  noteId?: string;
  /** create/update 的标题。 */
  title?: string;
  /** create/update 的正文（Markdown/纯文本）。 */
  content?: string;
  /** create/update 的标签。 */
  tags?: string[];
  /** 关联文献 ID（create 时挂到文献，缺省为全局笔记）。 */
  paperId?: string;
  /** 笔记类型，缺省 standalone。 */
  type?: NoteType;
  pageKind?: NotePageKind;
  /** update 操作在生成计划时读到的原文，供审批卡做 diff 展示。 */
  before?: string;
  /** 该操作的目的说明。 */
  reason?: string;
}

export interface AgentNoteWritePlan {
  id: string;
  summary: string;
  operations: AgentNoteWriteOperation[];
  createdAt: number;
}

export interface ApplyAgentNoteWritePlanResult {
  applied: number;
  failed: number;
  errors: string[];
  noteIds: string[];
}

const NOTE_PLAN_CONTENT_LIMIT = 100_000;

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanString(item)).filter(Boolean))].slice(0, 30);
}

function normalizeOperation(raw: unknown): AgentNoteWriteOperation | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const kind = cleanString(value.kind);

  if (kind === 'create') {
    const title = cleanString(value.title);
    const content = typeof value.content === 'string' ? value.content.slice(0, NOTE_PLAN_CONTENT_LIMIT) : '';
    if (!title && !content.trim()) return null;
    return {
      kind: 'create',
      title: title || 'Untitled Note',
      content,
      tags: cleanStringList(value.tags),
      paperId: cleanString(value.paperId) || undefined,
      type: cleanString(value.type) === 'standalone' ? 'standalone' : 'standalone',
      pageKind: cleanString(value.pageKind) as NotePageKind || undefined,
      reason: cleanString(value.reason) || undefined,
    };
  }

  if (kind === 'update') {
    const noteId = cleanString(value.noteId);
    if (!noteId) return null;
    const content =
      typeof value.content === 'string' ? value.content.slice(0, NOTE_PLAN_CONTENT_LIMIT) : undefined;
    const title = cleanString(value.title) || undefined;
    const tags = Array.isArray(value.tags) ? cleanStringList(value.tags) : undefined;
    if (!title && content === undefined && !tags) return null;
    return {
      kind: 'update',
      noteId,
      title,
      content,
      tags,
      pageKind: cleanString(value.pageKind) as NotePageKind || undefined,
      reason: cleanString(value.reason) || undefined,
    };
  }

  if (kind === 'delete') {
    const noteId = cleanString(value.noteId);
    if (!noteId) return null;
    return {
      kind: 'delete',
      noteId,
      reason: cleanString(value.reason) || undefined,
    };
  }

  return null;
}

/**
 * 从工具参数构建可审批的笔记写计划。update 操作会顺带读取当前笔记正文
 * 作为 before，便于审批卡展示改动前后的差异。读取失败不阻塞计划生成。
 */
export async function createAgentNoteWritePlan(input: {
  summary?: unknown;
  operations?: unknown;
}): Promise<AgentNoteWritePlan> {
  const rawOperations = Array.isArray(input.operations) ? input.operations : [];
  const operations = rawOperations
    .map(normalizeOperation)
    .filter((operation): operation is AgentNoteWriteOperation => Boolean(operation))
    .slice(0, 20);

  const withBefore = await Promise.all(
    operations.map(async (operation) => {
      if (operation.kind !== 'update' || !operation.noteId) return operation;
      try {
        const { getNote } = await loadNotesService();
        const note = await getNote(operation.noteId);
        if (!note || note.deletedAt) return operation;
        return { ...operation, before: (note.contentText ?? note.content ?? '').slice(0, NOTE_PLAN_CONTENT_LIMIT) };
      } catch {
        return operation;
      }
    }),
  );

  return {
    id: `agent-note:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    summary: cleanString(input.summary) || `Update ${withBefore.length} note(s).`,
    operations: withBefore,
    createdAt: Date.now(),
  };
}

/** 用户批准计划后执行实际写入。逐操作独立执行，失败不中断其余操作。 */
export async function applyAgentNoteWritePlan(plan: AgentNoteWritePlan): Promise<ApplyAgentNoteWritePlanResult> {
  const result: ApplyAgentNoteWritePlanResult = { applied: 0, failed: 0, errors: [], noteIds: [] };
  const { createNote, updateNote, deleteNote } = await loadNotesService();

  for (const operation of plan.operations) {
    try {
      if (operation.kind === 'create') {
        const note = await createNote(
          {
            paperId: operation.paperId || 'global-notes',
            type: operation.type ?? 'standalone',
            pageKind: operation.pageKind ?? null,
            title: operation.title || 'Untitled Note',
            content: operation.content ?? '',
            contentText: operation.content ?? '',
            tags: operation.tags ?? [],
            linkedPaperId: operation.paperId ?? null,
          },
          { sourceId: 'agent' },
        );
        result.noteIds.push(note.id);
        result.applied += 1;
        continue;
      }

      if (operation.kind === 'update' && operation.noteId) {
        const patch: Record<string, unknown> = {};
        if (operation.title) patch.title = operation.title;
        if (operation.content !== undefined) {
          patch.content = operation.content;
          patch.contentText = operation.content;
          // 正文被替换时清空结构化 JSON，让编辑器从新文本重建，避免旧内容残留。
          patch.contentJson = null;
          patch.contentHtml = null;
        }
        if (operation.tags) patch.tags = operation.tags;
        if (operation.pageKind) patch.pageKind = operation.pageKind;
        const note = await updateNote(operation.noteId, patch, { sourceId: 'agent' });
        result.noteIds.push(note.id);
        result.applied += 1;
        continue;
      }

      if (operation.kind === 'delete' && operation.noteId) {
        await deleteNote(operation.noteId, { sourceId: 'agent' });
        result.noteIds.push(operation.noteId);
        result.applied += 1;
        continue;
      }

      result.failed += 1;
      result.errors.push(`Unsupported note operation: ${operation.kind}`);
    } catch (error) {
      result.failed += 1;
      result.errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return result;
}

export function describeNoteOperation(operation: AgentNoteWriteOperation, note?: Note | null): string {
  const target = note?.title || operation.title || operation.noteId || '';
  if (operation.kind === 'create') return `创建笔记「${operation.title}」`;
  if (operation.kind === 'update') return `更新笔记「${target}」`;
  return `删除笔记「${target || operation.noteId}」`;
}
