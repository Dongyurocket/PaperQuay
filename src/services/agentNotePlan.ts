import type { Note, NoteAnchor, NotePageKind, NoteType } from '../types/notes';
import type { JSONContent } from '@tiptap/core';
import { parseMarkdownToTiptap } from '../shared/markdownToTiptap.cjs';
import { normalizeAgentCitationTokens, type InputCitation } from './agentAnswerEvidence.ts';
import {
  prepareSystemPageContent,
  shouldRefreshNavigationPages,
} from './noteSystemPages.ts';

// 运行时才加载 notes 服务：测试环境没有 Electron invoke 通道，
// 动态导入让纯计划构建逻辑保持可测，调用失败时按操作降级而非崩溃。
type NotesService = typeof import('./notes');
type LibraryService = typeof import('./library');

async function loadNotesService(): Promise<NotesService> {
  return import('./notes.ts');
}

async function loadLibraryService(): Promise<LibraryService> {
  return import('./library.ts');
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
  beforeUpdatedAt?: number;
  /** 该操作的目的说明。 */
  reason?: string;
  anchors?: NoteAnchor[];
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

export function assertNoteStructurePreserved(before: JSONContent | null | undefined, after: JSONContent): void {
  const collect = (root: JSONContent | null | undefined) => {
    const counts = new Map<string, number>();
    const visit = (node: JSONContent) => {
      let key = '';
      if (node.type === 'noteAnchorBlock' || node.type === 'noteAnchorLink') {
        key = `anchor:${String(node.attrs?.anchorId ?? '')}`;
      } else if (node.type === 'paperReference') {
        key = `paper:${String(node.attrs?.paperId ?? '')}`;
      } else if (node.type === 'wikiLink') {
        key = `note:${String(node.attrs?.id ?? '')}`;
      } else if (node.type === 'table') {
        key = `table:${JSON.stringify(node)}`;
      }
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
      for (const child of node.content ?? []) visit(child);
    };
    if (root) visit(root);
    return counts;
  };
  const previous = collect(before);
  const next = collect(after);
  for (const [key, count] of previous) {
    if ((next.get(key) ?? 0) < count) {
      throw new Error('笔记正文包含无法保留的锚点、引用、双链或表格，请在笔记编辑器中修改。');
    }
  }
}

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
    const pageKind = cleanString(value.pageKind) as NotePageKind || undefined;
    if (!title && content === undefined && !tags && !pageKind) return null;
    return {
      kind: 'update',
      noteId,
      title,
      content,
      tags,
      pageKind,
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
  citations?: Array<InputCitation & { sourceType?: string }>;
}): Promise<AgentNoteWritePlan> {
  const createdAt = Date.now();
  const planId = `agent-note:${createdAt}:${Math.random().toString(36).slice(2, 8)}`;
  const rawOperations = Array.isArray(input.operations) ? input.operations : [];
  const operations = rawOperations
    .map(normalizeOperation)
    .filter((operation): operation is AgentNoteWriteOperation => Boolean(operation))
    .slice(0, 20)
    .map((operation, operationIndex) => {
      if (operation.kind !== 'create' || !operation.content || !input.citations?.length) return operation;
      const bindings = normalizeAgentCitationTokens(operation.content, input.citations, { identityOnly: true });
      const resolved = bindings.filter((binding) => binding.reason === 'source-resolved');
      const anchors: NoteAnchor[] = [];
      const sources = new Map<string, string>();
      for (const binding of resolved) {
        if (sources.has(binding.citationId)) continue;
        const citation = input.citations.find((item) => item.id === binding.citationId);
        if (!citation?.paperId || !citation.paperTitle) continue;
        const pageIndex = Number.isInteger(citation.pageIndex) && Number(citation.pageIndex) >= 0 ? citation.pageIndex! : null;
        const blockId = typeof citation.blockId === 'string' && citation.blockId.trim() ? citation.blockId.trim() : null;
        const title = citation.paperTitle.replace(/[\r\n]+/g, ' ').trim();
        const label = `Source ${sources.size + 1}`;
        let location = `${title}${pageIndex === null ? '' : `, p. ${pageIndex + 1}`}`;
        if (pageIndex !== null || blockId) {
          const anchor: NoteAnchor = {
            id: `${planId}:${operationIndex}:${anchors.length}`,
            paperId: citation.paperId,
            label: pageIndex === null ? label : `P${pageIndex + 1}`,
            sourceTitle: title,
            excerpt: citation.previewText ?? '',
            source: citation.sourceType === 'pdf-text' ? 'pdf' : 'blocks',
            pageIndex,
            blockId,
            createdAt,
          };
          anchors.push(anchor);
          location += ` ([Open source](paperquay://anchor/${anchor.id}))`;
        } else {
          location += ' (location unavailable)';
        }
        sources.set(binding.citationId, `${label}: ${location}`);
      }
      if (!sources.size) return operation;
      let content = operation.content;
      for (const binding of [...resolved].reverse()) {
        const source = sources.get(binding.citationId);
        if (source) content = `${content.slice(0, binding.start)}[${source.split(':')[0]}]${content.slice(binding.end)}`;
      }
      content += `\n\n## Sources\n\n${[...sources.values()].map((source) => `- ${source}`).join('\n')}`;
      return { ...operation, content, anchors };
    });

  const withBefore = await Promise.all(
    operations.map(async (operation) => {
      if (operation.kind !== 'update' || !operation.noteId) return operation;
      try {
        const { getNote } = await loadNotesService();
        const note = await getNote(operation.noteId);
        if (!note || note.deletedAt) return operation;
        return { ...operation, before: (note.contentText ?? note.content ?? '').slice(0, NOTE_PLAN_CONTENT_LIMIT), beforeUpdatedAt: note.updatedAt };
      } catch {
        return operation;
      }
    }),
  );

  return {
    id: planId,
    summary: cleanString(input.summary) || `Update ${withBefore.length} note(s).`,
    operations: withBefore,
    createdAt,
  };
}

/** 用户批准计划后执行实际写入。逐操作独立执行，失败不中断其余操作。 */
export async function applyAgentNoteWritePlan(plan: AgentNoteWritePlan): Promise<ApplyAgentNoteWritePlanResult> {
  const result: ApplyAgentNoteWritePlanResult = { applied: 0, failed: 0, errors: [], noteIds: [] };
  const { createNote, updateNote, deleteNote, listNotes, getNote } = await loadNotesService();
  let knownPapers: Array<{ id: string; title: string; doi?: string }> = [];
  try {
    const { listLibraryPapers } = await loadLibraryService();
    knownPapers = (await listLibraryPapers()).map((paper) => ({
      id: paper.id,
      title: paper.title,
      doi: paper.doi || undefined,
    }));
  } catch {
    // Note writes remain usable when the library bridge is unavailable; unknown [n] stays text.
  }

  for (const operation of plan.operations) {
    try {
      if (operation.kind === 'create') {
        const notes = await listNotes({ includeDeleted: false });
        const parserOptions = {
          notes,
          papers: knownPapers,
          anchors: [...notes.flatMap((note) => note.anchors ?? []), ...(operation.anchors ?? [])],
        };
        const note = await createNote(
          {
            paperId: operation.paperId || 'global-notes',
            type: operation.type ?? 'standalone',
            pageKind: operation.pageKind ?? null,
            title: operation.title || 'Untitled Note',
            content: operation.content ?? '',
            contentText: operation.content ?? '',
            contentJson: parseMarkdownToTiptap(operation.content ?? '', parserOptions),
            anchors: operation.anchors ?? [],
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
        if (!Number.isFinite(operation.beforeUpdatedAt)) {
          throw new Error('无法确认审批时的笔记版本，请重新生成变更计划。');
        }
        const existing = await getNote(operation.noteId);
        if (!existing || existing.deletedAt || existing.updatedAt !== operation.beforeUpdatedAt) {
          throw new Error('笔记在审批后已被修改，请重新生成变更计划。');
        }
        const patch: Record<string, unknown> = {};
        if (operation.title) patch.title = operation.title;
        if (operation.content !== undefined) {
          patch.content = operation.content;
          patch.contentText = operation.content;
          if (operation.content === (existing.contentText ?? existing.content ?? '')) {
            patch.contentJson = existing.contentJson;
          } else {
            const notes = await listNotes({ includeDeleted: false });
            const contentJson = parseMarkdownToTiptap(operation.content, {
              notes,
              papers: knownPapers,
              anchors: existing.anchors ?? [],
            });
            assertNoteStructurePreserved(existing.contentJson, contentJson);
            patch.contentJson = contentJson;
          }
          patch.contentHtml = null;
        }
        if (operation.tags) patch.tags = operation.tags;
        if (operation.pageKind) patch.pageKind = operation.pageKind;
        const note = await updateNote(operation.noteId, patch, { sourceId: 'agent', expectedUpdatedAt: operation.beforeUpdatedAt });
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

  if (result.applied > 0) {
    try {
      const notes = await listNotes({ includeDeleted: false });
      const refreshNavigation = shouldRefreshNavigationPages(result.applied);
      const pageKinds: NotePageKind[] = ['log'];
      if (refreshNavigation) pageKinds.push('index', 'overview');
      const operationCounts = plan.operations.reduce<Record<string, number>>((counts, operation) => {
        counts[operation.kind] = (counts[operation.kind] ?? 0) + 1;
        return counts;
      }, {});
      const operationSummary = Object.entries(operationCounts)
        .map(([kind, count]) => `${kind}×${count}`)
        .join('、') || '批量写入';

      for (const pageKind of pageKinds) {
        const existing = notes.find((note) => note.pageKind === pageKind) ?? null;
        const prepared = prepareSystemPageContent(
          pageKind,
          existing,
          notes,
          result.noteIds,
          Date.now(),
          operationSummary,
        );
        if (prepared.action === 'skip' || !prepared.content) continue;
        const contentJson = parseMarkdownToTiptap(prepared.content, {
          notes,
          papers: knownPapers,
          anchors: notes.flatMap((note) => note.anchors ?? []),
        });
        if (prepared.action === 'create') {
          await createNote(
            {
              paperId: 'global-notes',
              type: 'standalone',
              pageKind,
              title: pageKind === 'log' ? '研究日志' : pageKind === 'index' ? '笔记索引' : '研究总览',
              content: prepared.content,
              contentText: prepared.content,
              contentJson,
            },
            { sourceId: 'agent-system-pages', silent: true },
          );
        } else if (existing) {
          await updateNote(
            existing.id,
            { content: prepared.content, contentText: prepared.content, contentJson, contentHtml: null },
            { sourceId: 'agent-system-pages', silent: true },
          );
        }
      }
    } catch (error) {
      result.failed += 1;
      result.errors.push(`系统页维护失败：${error instanceof Error ? error.message : String(error)}`);
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
