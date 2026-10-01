/**
 * 笔记蒸馏能力（方案第 5.3 节）。
 *
 * 阶段编排：collect -> draft -> plan。只产出审批计划（AgentNoteWritePlan），不直接写库；
 * 批准后的落库仍走现有 applyAgentNoteWritePlan，不新增写入通道。
 *
 * 红线：
 * - 本能力拒绝创建/改写 excerpt 摘录卡：摘录卡必须经阅读器选区由系统写入锚点，
 *   Agent 不得伪造 anchors[]，也不得在正文编造 paperquay://anchor/ 链接；
 *   更新已有笔记时，正文中的锚点链接必须原样来自该笔记的 before 内容。
 * - 不调用阅读器的 distillExcerpt（它只服务阅读器选区）。
 * - collect 的 RAG 兜底片段只作证据线索，不得当成摘录卡原文快照。
 */

import type { NotePageKind } from '../types/notes';
import { assertEvidenceForNoteDraft, bindAnswerEvidence, type InputCitation } from './agentAnswerEvidence.ts';
import type { CitationAuditJudgeVerdict, CitationAuditSnippet } from './agentCitationAudit.ts';
import {
  createAgentNoteWritePlan,
  type AgentNoteWritePlan,
} from './agentNotePlan.ts';
import { getNote, searchNotes } from './notes.ts';

export const DISTILL_ALLOWED_PAGE_KINDS = ['concept', 'synthesis', 'qa', 'paper-card'] as const;

function requestsExcerptCreation(instruction: string): boolean {
  return /(?:生成|创建|写成|做成|制成|提炼为|转成|转换成|写一?张|做一?张)[^，。；\n]{0,36}(?:\bexcerpt\b|摘录卡)/i.test(instruction);
}

function requestedPageKind(instruction: string): string | null {
  if (/\b(?:synthesis|review)\b|综述|跨篇综合/.test(instruction)) return 'synthesis';
  if (/\bconcept\b|概念(?:页|卡|笔记)/.test(instruction)) return 'concept';
  if (/\bpaper-card\b|论文卡片/.test(instruction)) return 'paper-card';
  if (/\bqa\b|问答(?:页|卡|笔记)/.test(instruction)) return 'qa';
  return null;
}

function distillSearchQuery(instruction: string, papers: Array<{ id: string; title: string }>, scopeIds: string[]): string {
  const scoped = scopeIds.length > 0 ? papers.filter((paper) => scopeIds.includes(paper.id)) : [];
  if (scoped.length === 1) return scoped[0].title;
  const quoted = /[“「](.{4,80})[”」]/.exec(instruction)?.[1];
  if (quoted) return quoted;
  return instruction
    .replace(/(?:请|帮我|把|将|这篇|这些|论文|文献|核心|方法|结论|提炼|生成|写成|整理|阅读笔记|概念笔记|综述|问答卡|concept|synthesis|qa)/gi, ' ')
    .replace(/\s+/g, ' ').trim() || instruction;
}

function completeSourcePreview(value: string, limit = 1800): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  const prefix = normalized.slice(0, limit);
  const endings = [...prefix.matchAll(/[。！？；]|\.(?=\s|$)/g)];
  const lastEnd = endings[endings.length - 1]?.index;
  return lastEnd !== undefined && lastEnd > limit / 2
    ? prefix.slice(0, lastEnd + 1).trim()
    : `${prefix.trimEnd()}…（来源预览截断，末句不完整）`;
}

/** 蒸馏草稿（草稿器的输出契约）。 */
export interface AgentDistillDraft {
  pageKind: string;
  title: string;
  content: string;
  /** paper-card 必填；create 时挂到该文献。 */
  paperId?: string;
  /** update 目标；缺省为 create。 */
  noteId?: string;
  tags?: string[];
  reason?: string;
}

export interface ValidateAgentDistillDraftOptions {
  /** collect 收集到的摘录/问答页标题；concept 的 [[标题]] 必须链回其中。 */
  collectedNoteTitles?: string[];
  /** 可解析参考文献条目的文献表；synthesis 至少解析出两个不同 paperId。 */
  papers?: Array<{ id: string; title: string; doi?: string | null }>;
  /** update 模式下已有笔记的原文（before）；create 模式不传。 */
  before?: string;
}

export interface NoteDistillCollectedNote {
  id: string;
  title: string;
  pageKind: string | null;
  paperId: string | null;
  paperTitle?: string;
  excerpt: string | null;
  content: string;
}

export interface NoteDistillRagSnippet {
  paperId: string;
  paperTitle: string;
  /** 1 基显示页码（与 rag_search 工具一致）。 */
  page: number | null;
  blockId: string | null;
  snippet: string;
}

export interface NoteDistillDraftInput {
  instruction: string;
  collectedNotes: NoteDistillCollectedNote[];
  ragSnippets: NoteDistillRagSnippet[];
  /** 上一轮校验/门禁未通过的错误，喂回草稿器修正。 */
  previousErrors: string[];
  signal?: AbortSignal;
}

export type NoteDistillDrafter = (input: NoteDistillDraftInput) => Promise<AgentDistillDraft>;

export interface NoteDistillCallModel {
  (input: { system: string; user: string; signal?: AbortSignal }): Promise<{ content: string }>;
}

export type NoteDistillStage = 'collect' | 'draft' | 'plan';

export type NoteDistillEvent =
  | { kind: 'stage_start'; stage: NoteDistillStage; attempt: number }
  | { kind: 'stage_progress'; stage: NoteDistillStage; completed: number; total: number; detail?: string }
  | { kind: 'stage_end'; stage: NoteDistillStage }
  | { kind: 'stage_retry'; stage: NoteDistillStage; attempt: number; error: string };

export interface NoteDistillSearchRagResult {
  chunks: Array<{
    paperId: string;
    paperTitle?: string;
    page: number | null;
    blockId: string | null;
    snippet: string;
  }>;
  ragErrors?: string[];
}

/** 蒸馏结果引用的证据条目（用于回答证据绑定与界面引用展示）。 */
export type NoteDistillCitation = InputCitation;

export interface NoteDistillCapabilityResult {
  kind: 'note-plan';
  /** 校验未通过时为 null——只返回说明，不产审批卡。 */
  notePlan: AgentNoteWritePlan | null;
  answer: string;
  citations: NoteDistillCitation[];
}

const PAGE_KIND_LABELS: Record<string, string> = {
  concept: '概念页',
  synthesis: '综述页',
  qa: '问答页',
  'paper-card': '论文卡片',
};

/** 指令提到概念/跨篇时，collect 在 excerpt 之外追加 qa 页搜索。 */
const CONCEPT_OR_CROSS_PAPER_HINT = /概念|跨篇|跨文献|多篇|综述|对比|concept|synthesis/i;

function abortError(): Error {
  const error = new Error('Note distill cancelled');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw abortError();
  }
}

function truncateText(value: string, maxChars: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

/**
 * 切出实质句（与 bindAnswerEvidence 同一套口径：去代码块/标题/空行，
 * 按中英文句读切分，剔除短于 12 字、纯问句、只含链接或编号的行）。
 * [[双链]] 与 [n] 编号在长度判断前剥离。
 */
export function extractDistillSubstantiveSentences(content: string): string[] {
  const withoutCodeBlocks = content.replace(/```[\s\S]*?```/g, '');
  const sentences: string[] = [];

  for (const line of withoutCodeBlocks.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine || /^#{1,6}\s+/.test(trimmedLine)) {
      continue;
    }

    // 「……。[[摘录]]」被句读切开后，只含链接/编号的尾段要并回上一句，链接属于该句的证据。
    const merged: string[] = [];
    for (const segment of trimmedLine.split(/(?<=[。！？!?；;])|(?<=\.\s+)|(?<=\.$)/)) {
      const trimmed = segment.trim();
      if (!trimmed) {
        continue;
      }
      const stripped = trimmed.replace(/\[\[[^\]]*\]\]/g, '').replace(/\[\d+\]/g, '').trim();
      if (!stripped && merged.length > 0) {
        merged[merged.length - 1] = `${merged[merged.length - 1]} ${trimmed}`;
        continue;
      }
      merged.push(trimmed);
    }

    for (const sentence of merged) {
      const stripped = sentence.replace(/\[\[[^\]]*\]\]/g, '').replace(/\[\d+\]/g, '').trim();
      if (!stripped || stripped.length < 12) {
        continue;
      }
      if (stripped.endsWith('?') || stripped.endsWith('？')) {
        continue;
      }
      sentences.push(sentence.length > 240 ? sentence.slice(0, 240) : sentence);
    }
  }

  return sentences;
}

/**
 * 纯函数草稿校验：返回错误列表，空数组为通过。
 * 覆盖方案第 5.3 节校验表 + 摘录卡红线 + 锚点保真。
 */
export function validateAgentDistillDraft(
  draft: AgentDistillDraft,
  options: ValidateAgentDistillDraftOptions = {},
): string[] {
  const errors: string[] = [];
  const pageKind = String(draft?.pageKind ?? '').trim();
  const title = String(draft?.title ?? '').trim();
  const content = String(draft?.content ?? '').trim();

  if (!title) {
    errors.push('草稿缺少标题。');
  }
  if (!content) {
    errors.push('草稿缺少正文内容。');
  }

  // 红线：excerpt 直接拒绝——摘录卡必须经阅读器选区生成系统锚点。
  if (pageKind === 'excerpt') {
    errors.push('笔记蒸馏不允许创建或改写摘录卡（excerpt）：摘录卡必须经阅读器选区提炼，由系统写入锚点，Agent 不得伪造 anchors[]。');
    return errors;
  }

  if (!(DISTILL_ALLOWED_PAGE_KINDS as readonly string[]).includes(pageKind)) {
    errors.push(`笔记蒸馏只允许 concept / synthesis / qa / paper-card 页面类型，当前为「${pageKind || '未设置'}」。`);
    return errors;
  }

  if (!content) {
    return errors;
  }

  // 锚点保真：create 不允许出现任何锚点链接；update 只允许原样来自 before 的锚点链接。
  const anchorRefs = [...new Set(
    Array.from(content.matchAll(/paperquay:\/\/anchor\/[A-Za-z0-9_-]+/g)).map((match) => match[0]),
  )];
  if (typeof options.before === 'string') {
    for (const ref of new Set(Array.from(options.before.matchAll(/paperquay:\/\/anchor\/[A-Za-z0-9_-]+/g)).map((match) => match[0]))) {
      if (!anchorRefs.includes(ref)) {
        errors.push(`更新笔记不得删除已有锚点链接 ${ref}。`);
      }
    }
  }
  if (anchorRefs.length > 0) {
    if (typeof options.before !== 'string') {
      errors.push('草稿包含 paperquay://anchor/ 锚点链接，但没有已有笔记原文可对照：没有系统锚点时 Agent 不得发明锚点。');
    } else {
      for (const ref of anchorRefs) {
        if (!options.before.includes(ref)) {
          errors.push(`草稿中的锚点链接 ${ref} 并非原样来自已有笔记的 before 内容，禁止伪造或篡改锚点。`);
        }
      }
    }
  }

  if (pageKind === 'concept') {
    if (/笔记|总结/.test(title)) {
      errors.push('概念页标题不得带「笔记」「总结」等冗余词。');
    }
    if (!/^#{1,6}\s+[^\n]*定义/m.test(content)) {
      errors.push('概念页必须包含概念定义段（如「## 定义」小节）。');
    }
    const sentences = extractDistillSubstantiveSentences(content);
    if (sentences.length === 0) {
      errors.push('概念页缺少实质内容句。');
    }
    const collectedTitles = (options.collectedNoteTitles ?? []).map((item) => item.trim()).filter(Boolean);
    for (const sentence of sentences) {
      const links = Array.from(sentence.matchAll(/\[\[([^\]]+)\]\]/g))
        .map((match) => match[1].trim())
        .filter(Boolean);
      if (links.length === 0) {
        errors.push(`概念页实质句必须使用 [[笔记标题]] 链回收集到的摘录或问答页：「${truncateText(sentence, 48)}」。`);
        continue;
      }
      if (collectedTitles.length > 0 && !links.some((link) => collectedTitles.includes(link))) {
        errors.push(`概念页实质句的 ${links.map((link) => `[[${link}]]`).join('')} 未链回 collect 收集到的笔记：「${truncateText(sentence, 48)}」。`);
      }
    }
  }

  if (pageKind === 'synthesis') {
    const referencesMatch = /(^|\n)#{1,6}\s*参考文献/.exec(content);
    if (!referencesMatch) {
      errors.push('综述页正文引用必须遵守 [n] 编号 + 文末「## 参考文献」规则：缺少参考文献列表。');
    } else {
      const referenceSection = content.slice(referencesMatch.index + referencesMatch[1].length);
      const entries = referenceSection
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /^[-*+]\s+/.test(line) || /^\d+[.、)）]\s*/.test(line) || /^\[\d+\]\s*/.test(line));
      if (entries.length < 2) {
        errors.push('综述页参考文献列表至少需要 2 条文献条目。');
      }
      const papers = options.papers ?? [];
      const resolvedPaperIds = new Set<string>();
      for (const entry of entries) {
        const normalizedEntry = entry.toLocaleLowerCase();
        for (const paper of papers) {
          const titleHit = paper.title.trim().length >= 4 && entry.includes(paper.title.trim());
          const doiHit = Boolean(paper.doi?.trim()) && normalizedEntry.includes(paper.doi!.trim().toLocaleLowerCase());
          if (titleHit || doiHit) {
            resolvedPaperIds.add(paper.id);
          }
        }
      }
      if (resolvedPaperIds.size < 2) {
        errors.push(`综述页必须引用至少两篇不同文献（按标题/DOI 解析到 ${resolvedPaperIds.size} 篇）。`);
      }

      const body = content.slice(0, referencesMatch.index);
      const citedNumbers = new Set(Array.from(body.matchAll(/\[(\d+)\]/g)).map((match) => match[1]));
      if (citedNumbers.size < 2) {
        errors.push('综述正文必须至少使用两个不同的 [n] 引用编号（对应文末参考文献条目）。');
      }
    }
  }

  if (pageKind === 'qa') {
    const section = /^#{1,6}\s+证据位置\s*$/m.exec(content);
    if (!section) {
      errors.push('问答页答案必须包含「证据位置」段。');
    } else {
      const rows = content.slice(section.index + section[0].length).split(/\r?\n(?=#{1,6}\s)/)[0]
        .split(/\r?\n/).map((line) => line.trim()).filter((line) => /^[-*+]\s+/.test(line));
      if (rows.length === 0 || rows.some((row) => !/paperId\s*[:：]\s*\S+/i.test(row)
        || !/(?:\b(?:page|blockId)\s*[:：]\s*\S+|第\s*\d+\s*页)/i.test(row))) {
        errors.push('问答页每条证据必须标注 paperId 与页码或 blockId。');
      }
    }
  }

  if (pageKind === 'paper-card') {
    if (!String(draft.paperId ?? '').trim()) {
      errors.push('论文卡片必须绑定 paperId。');
    }
    if (!content.includes('我的判断')) {
      errors.push('论文卡片正文必须包含「我的判断」。');
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// collect / draft / plan 阶段编排
// ---------------------------------------------------------------------------

/** 默认 search_notes 通道（与 ReAct 工具同一个 notes_search IPC）。 */
async function defaultSearchNotes(input: {
  query: string;
  pageKind: 'excerpt' | 'qa';
  limit: number;
}): Promise<NoteDistillCollectedNote[]> {
  const result = await searchNotes({ query: input.query, pageKind: input.pageKind, limit: input.limit });
  return result.notes.map((note) => ({
    id: note.id,
    title: note.title,
    pageKind: note.pageKind ?? null,
    paperId: note.paperId || null,
    excerpt: note.excerpt?.trim() || null,
    content: (note.contentText ?? note.content ?? '').slice(0, 2000),
  }));
}

async function defaultReadNoteContent(noteId: string): Promise<{ content: string; pageKind: string | null }> {
  const note = await getNote(noteId);
  if (!note || note.deletedAt) {
    throw new Error(`笔记 ${noteId} 不存在或已删除。`);
  }
  return { content: note.contentText ?? note.content ?? '', pageKind: note.pageKind ?? null };
}

/**
 * 笔记蒸馏能力入口。
 * 产出 { kind: 'note-plan', notePlan, answer, citations }；
 * 校验/门禁两轮仍不通过时 notePlan 为 null，answer 为友好说明，不产审批卡。
 */
export async function runNoteDistillCapability(input: {
  instruction: string;
  draft: NoteDistillDrafter;
  papers?: Array<{ id: string; title: string; doi?: string | null }>;
  currentPaperScopeIds?: string[];
  searchNotesFn?: (input: { query: string; pageKind: 'excerpt' | 'qa'; limit: number }) => Promise<NoteDistillCollectedNote[]>;
  searchRag?: (input: { query: string; paperIds?: string[]; topK?: number }) => Promise<NoteDistillSearchRagResult>;
  readNoteContent?: (noteId: string) => Promise<{ content: string; pageKind: string | null }>;
  createPlan?: (input: { summary: string; operations: Array<Record<string, unknown>> }) => Promise<AgentNoteWritePlan>;
  judgeSynthesisClaim?: (input: { claim: string; snippets: CitationAuditSnippet[] }) => Promise<CitationAuditJudgeVerdict>;
  signal?: AbortSignal;
  onEvent?: (event: NoteDistillEvent) => void;
}): Promise<NoteDistillCapabilityResult> {
  const emit = (event: NoteDistillEvent) => input.onEvent?.(event);
  const instruction = input.instruction.trim();
  const papers = Array.isArray(input.papers) ? input.papers : [];
  const expectedPageKind = requestedPageKind(instruction);
  const searchQuery = distillSearchQuery(instruction, papers, input.currentPaperScopeIds ?? []);

  throwIfAborted(input.signal);
  if (requestsExcerptCreation(instruction)) {
    return {
      kind: 'note-plan',
      notePlan: null,
      answer: '摘录卡必须在阅读器中通过选区提炼，由系统写入文献锚点。本次没有生成笔记审批卡。',
      citations: [],
    };
  }
  if (expectedPageKind === 'synthesis' && new Set(input.currentPaperScopeIds ?? []).size === 1) {
    return {
      kind: 'note-plan',
      notePlan: null,
      answer: '综述页需要至少两篇不同文献的当次证据。当前仅选中一篇文献，请扩大文献范围后重试；本次没有生成笔记审批卡。',
      citations: [],
    };
  }

  // ---- collect：默认搜摘录页；涉及概念/跨篇时追加问答页；无命中允许一次 RAG 兜底 ----
  emit({ kind: 'stage_start', stage: 'collect', attempt: 1 });
  const searchNotesFn = input.searchNotesFn ?? defaultSearchNotes;
  const collectedNotes: NoteDistillCollectedNote[] = [];
  const seenNoteIds = new Set<string>();
  const titleById = new Map(papers.map((paper) => [paper.id, paper.title]));
  const selectedIds = new Set((input.currentPaperScopeIds ?? []).filter(Boolean));
  const pushNotes = (notes: NoteDistillCollectedNote[]) => {
    for (const note of notes) {
      if (expectedPageKind === 'synthesis' && selectedIds.size > 0 && (!note.paperId || !selectedIds.has(note.paperId))) {
        continue;
      }
      if (note?.id && !seenNoteIds.has(note.id)) {
        seenNoteIds.add(note.id);
        collectedNotes.push({ ...note, paperTitle: note.paperId ? titleById.get(note.paperId) : undefined });
      }
    }
  };

  pushNotes(await searchNotesFn({ query: searchQuery, pageKind: 'excerpt', limit: 10 }));
  if (CONCEPT_OR_CROSS_PAPER_HINT.test(instruction)) {
    pushNotes(await searchNotesFn({ query: searchQuery, pageKind: 'qa', limit: 10 }));
  }
  throwIfAborted(input.signal);

  let ragSnippets: NoteDistillRagSnippet[] = [];
  const scopeIds = [...new Set((input.currentPaperScopeIds ?? []).filter(Boolean))];
  if (input.searchRag && (collectedNotes.length === 0 || (expectedPageKind === 'synthesis' && scopeIds.length >= 2))) {
    // A selected multi-paper synthesis needs evidence from each paper even when one note matched.
    const targetIds = scopeIds.length > 0 ? scopeIds : papers.map((paper) => paper.id);
    const perPaperIds = expectedPageKind === 'synthesis' && scopeIds.length >= 2
      ? scopeIds.slice(0, 8).map((id) => [id])
      : [targetIds];
    const perSearchLimit = Math.max(1, Math.floor(8 / perPaperIds.length));
    for (const paperIds of perPaperIds) {
      if (paperIds.length === 0) continue;
      throwIfAborted(input.signal);
      const ragResult = await input.searchRag({ query: searchQuery, paperIds, topK: perSearchLimit });
      ragSnippets.push(...(ragResult.chunks ?? []).slice(0, perSearchLimit).map((chunk) => ({
        paperId: chunk.paperId,
        paperTitle: chunk.paperTitle?.trim() || titleById.get(chunk.paperId) || chunk.paperId,
        page: chunk.page ?? null,
        blockId: chunk.blockId ?? null,
        snippet: chunk.snippet ?? '',
      })));
    }
  }
  emit({
    kind: 'stage_progress',
    stage: 'collect',
    completed: collectedNotes.length,
    total: collectedNotes.length,
    detail: `笔记 ${collectedNotes.length} 条 · RAG 片段 ${ragSnippets.length} 条`,
  });
  emit({ kind: 'stage_end', stage: 'collect' });

  if (expectedPageKind === 'synthesis') {
    const evidencedPaperIds = new Set([
      ...collectedNotes.map((note) => note.paperId).filter((id): id is string => Boolean(id)),
      ...ragSnippets.map((snippet) => snippet.paperId),
    ]);
    if (evidencedPaperIds.size < 2) {
      return {
        kind: 'note-plan',
        notePlan: null,
        answer: '综述页需要至少两篇不同文献的当次证据；本次只收集到不足两篇，未生成笔记审批卡。请补充已解析文献或阅读笔记后重试。',
        citations: [],
      };
    }
  }

  if (collectedNotes.length === 0 && ragSnippets.length === 0) {
    return {
      kind: 'note-plan',
      notePlan: null,
      answer: [
        '未在笔记库中检索到与指令相关的摘录或问答笔记，也没有可用的 RAG 片段作为证据线索。',
        '请先在阅读器中划线生成摘录卡，或选择文献后重试。本次未产生笔记审批卡。',
      ].join('\n\n'),
      citations: [],
    };
  }

  // 证据绑定的当次引用集合：收集到的笔记 + RAG 片段，编号即展示给草稿器的来源编号。
  const citations: NoteDistillCitation[] = [];
  for (const note of collectedNotes) {
    citations.push({
      label: String(citations.length + 1),
      paperId: note.paperId ?? `note:${note.id}`,
      paperTitle: note.title,
      pageIndex: null,
      blockId: null,
      previewText: completeSourcePreview(note.excerpt ?? note.content),
    });
  }
  for (const snippet of ragSnippets) {
    citations.push({
      label: String(citations.length + 1),
      paperId: snippet.paperId,
      paperTitle: snippet.paperTitle,
      pageIndex: snippet.page === null ? null : snippet.page - 1,
      blockId: snippet.blockId,
      previewText: completeSourcePreview(snippet.snippet, 600),
    });
  }
  const collectedNoteTitles = collectedNotes.map((note) => note.title);

  // ---- draft：校验不通过把错误喂回草稿器重试一次 ----
  let previousErrors: string[] = [];
  let draft: AgentDistillDraft | null = null;
  let before: string | undefined;
  let attempt = 0;
  const readNoteContent = input.readNoteContent ?? defaultReadNoteContent;

  const draftAndValidate = async (): Promise<string[]> => {
    attempt += 1;
    throwIfAborted(input.signal);
    if (attempt > 1) {
      emit({ kind: 'stage_retry', stage: 'draft', attempt, error: previousErrors[0] ?? '上一轮校验未通过' });
    } else {
      emit({ kind: 'stage_start', stage: 'draft', attempt });
    }

    try {
      draft = await input.draft({ instruction, collectedNotes, ragSnippets, previousErrors, signal: input.signal });
    } catch (error) {
      if (input.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw abortError();
      }
      return [`草稿器调用失败：${error instanceof Error ? error.message : String(error)}`];
    }

    throwIfAborted(input.signal);
    if (draft.pageKind === 'synthesis') {
      const heading = /(^|\n)#{1,6}\s*参考文献\s*(?:\r?\n|$)/.exec(draft.content);
      if (heading) {
        const body = draft.content.slice(0, heading.index + heading[1].length).trimEnd();
        const labels = [...new Set(Array.from(body.matchAll(/\[(\d+)\]/g)).map((match) => match[1]))];
        const entries = labels.map((label) => {
          const citation = citations.find((item) => item.label === label);
          const title = citation && (titleById.get(citation.paperId) ??
            (citation.paperId.startsWith('note:') ? undefined : citation.paperTitle));
          return title ? `- [${label}] ${title}` : null;
        });
        if (entries.every((entry): entry is string => entry !== null)) {
          draft = { ...draft, content: `${body}\n\n## 参考文献\n${entries.join('\n')}` };
        }
      }
    }
    if (expectedPageKind && draft.pageKind !== expectedPageKind) {
      return [`本次明确要求 ${expectedPageKind}，草稿却返回 ${draft.pageKind || '未设置'}；重试不得改变页面类型。`];
    }
    before = undefined;
    const noteId = String(draft.noteId ?? '').trim();
    if (noteId && collectedNotes.some((note) => note.id === noteId && note.pageKind === 'excerpt')) {
      return ['摘录卡必须由阅读器管理，不允许更新已有 excerpt 笔记。'];
    }
    if (noteId) {
      try {
        const existing = await readNoteContent(noteId);
        if (existing.pageKind === 'excerpt') {
          return ['摘录卡必须由阅读器管理，不允许更新已有 excerpt 笔记。'];
        }
        before = existing.content;
      } catch (error) {
        return [`无法读取待更新笔记（${noteId}）的原文，无法校验锚点保真：${error instanceof Error ? error.message : String(error)}`];
      }
    }

    return validateAgentDistillDraft(draft, {
      collectedNoteTitles,
      // RAG 兜底片段的文献标题也允许解析参考文献条目（标题真实来自库内文献）。
      papers: [
        ...papers,
        ...ragSnippets.map((snippet) => ({ id: snippet.paperId, title: snippet.paperTitle })),
      ],
      before,
    });
  };

  let lastErrors = await draftAndValidate();
  if (lastErrors.length > 0) {
    previousErrors = lastErrors;
    lastErrors = await draftAndValidate();
  }
  if (lastErrors.length > 0 || !draft) {
    return {
      kind: 'note-plan',
      notePlan: null,
      answer: buildDistillFailureAnswer(lastErrors),
      citations,
    };
  }
  emit({ kind: 'stage_end', stage: 'draft' });

  // ---- plan：证据门禁（assertEvidenceForNoteDraft），不通过喂回一次；通过则生成写计划 ----
  emit({ kind: 'stage_start', stage: 'plan', attempt: 1 });
  // 参考文献列表是引用索引而非实质句，送证据门前剥离；正文实质句仍全量过门。
  const stripReferencesSection = (content: string) => content.replace(/\n#{1,6}\s+参考文献[\s\S]*$/, '');
  const checkEvidence = async (current: AgentDistillDraft): Promise<string | null> => {
    try {
      if (current.pageKind === 'synthesis') {
        const body = stripReferencesSection(current.content);
        const refs = current.content.split(/\n#{1,6}\s+参考文献/)[1] ?? '';
        const citedPaperIds = new Set<string>();
        for (const label of new Set(Array.from(body.matchAll(/\[(\d+)\]/g)).map((match) => match[1]))) {
          const citation = citations.find((item) => item.label === label);
          const entry = refs.split(/\r?\n/).find((line) => new RegExp(`^\\s*(?:[-*+]\\s*)?\\[${label}\\]\\s*`).test(line));
          const sourcePaper = citation && papers.find((paper) => paper.id === citation.paperId);
          const paperTitle = sourcePaper?.title ?? citation?.paperTitle;
          if (!citation || !entry || !paperTitle || !entry.includes(paperTitle) || citation.paperId.startsWith('note:')) {
            return `综述引用 [${label}] 必须对应本次收集到的文献与参考文献条目。`;
          }
          citedPaperIds.add(citation.paperId);
        }
        if (citedPaperIds.size < 2) {
          return '综述正文必须引用至少两篇不同 paperId 的当次证据。';
        }
      }
      const content = stripReferencesSection(current.content);
      if (current.pageKind === 'synthesis' && input.judgeSynthesisClaim) {
        const claims = bindAnswerEvidence({ answer: content, citations }).claims;
        if (claims.length === 0) return '综述正文没有可核对的实质句。';
        for (const claim of claims) {
          if (claim.status === 'not-in-library' || claim.text.endsWith('…')) {
            return `综述句子缺少可解析的当次引用或过长："${claim.text}"。`;
          }
          const snippets = claim.citations.map((citation) => ({
            paperId: citation.paperId,
            paperTitle: citation.paperTitle,
            pageIndex: citation.pageIndex,
            blockId: citation.blockId,
            snippet: citation.snippet,
          }));
          const numbers: string[] = claim.text.replace(/\[\d+\]/g, '').match(/\d+(?:\.\d+)?/g) ?? [];
          if (numbers.some((number) => !snippets.some((item) => {
            const sourceNumbers: string[] = item.snippet.match(/\d+(?:\.\d+)?/g) ?? [];
            return sourceNumbers.includes(number);
          }))) {
            return `综述句子中的数值未在对应来源中出现："${claim.text}"。`;
          }
          const verdict = await input.judgeSynthesisClaim({ claim: claim.text, snippets });
          const verdictPapers = new Set((verdict.snippetIndexes ?? [])
            .filter((index) => Number.isInteger(index) && index >= 1 && index <= snippets.length)
            .map((index) => snippets[index - 1].paperId));
          if (verdict.status !== 'supported' ||
            snippets.some((snippet) => !verdictPapers.has(snippet.paperId))) {
            return `综述句子未获对应来源充分支持（${verdict.status}）："${claim.text}"。${verdict.reason}`;
          }
        }
      } else {
        assertEvidenceForNoteDraft(
          { title: current.title, content, pageKind: current.pageKind },
          citations,
        );
      }
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };

  let gateError = await checkEvidence(draft);
  if (gateError) {
    if (attempt >= 2) {
      return { kind: 'note-plan', notePlan: null, answer: buildDistillFailureAnswer([gateError]), citations };
    }
    previousErrors = [gateError];
    lastErrors = await draftAndValidate();
    if (lastErrors.length > 0 || !draft) {
      return {
        kind: 'note-plan',
        notePlan: null,
        answer: buildDistillFailureAnswer(lastErrors),
        citations,
      };
    }
    gateError = await checkEvidence(draft);
    if (gateError) {
      return {
        kind: 'note-plan',
        notePlan: null,
        answer: buildDistillFailureAnswer([gateError]),
        citations,
      };
    }
  }

  throwIfAborted(input.signal);
  // The drafter assigns this value inside an async closure; TS cannot narrow that assignment here.
  const finalDraft = draft as AgentDistillDraft;
  const noteId = String(finalDraft.noteId ?? '').trim();
  const createPlan = input.createPlan ?? createAgentNoteWritePlan;
  const notePlan = await createPlan({
    summary: `笔记蒸馏：${noteId ? '更新' : '创建'}${PAGE_KIND_LABELS[finalDraft.pageKind] ?? finalDraft.pageKind}「${finalDraft.title}」（未批准前不会写入）`,
    operations: [
      noteId
        ? {
          kind: 'update',
          noteId,
          title: finalDraft.title,
          content: finalDraft.content,
          pageKind: finalDraft.pageKind,
          reason: finalDraft.reason ?? '笔记蒸馏更新已有笔记。',
        }
        : {
          kind: 'create',
          title: finalDraft.title,
          content: finalDraft.content,
          tags: finalDraft.tags ?? [],
          paperId: finalDraft.paperId,
          pageKind: finalDraft.pageKind,
          reason: finalDraft.reason ?? '笔记蒸馏创建新笔记。',
        },
    ],
  });
  emit({ kind: 'stage_end', stage: 'plan' });

  const answer = [
    `已根据 ${collectedNotes.length} 条笔记${ragSnippets.length > 0 ? `与 ${ragSnippets.length} 条 RAG 片段` : ''}生成${PAGE_KIND_LABELS[finalDraft.pageKind] ?? finalDraft.pageKind}草稿「${finalDraft.title}」。`,
    '草稿已通过结构校验与证据绑定门禁，请在下方审批卡中确认后写入笔记库；取消则笔记库不变。',
  ].join('\n\n');

  return {
    kind: 'note-plan',
    notePlan,
    answer,
    citations,
  };
}

function buildDistillFailureAnswer(errors: string[]): string {
  return [
    '笔记蒸馏未能生成可通过校验的草稿，本次未产生笔记审批卡。',
    '',
    '未通过的原因：',
    ...errors.slice(0, 6).map((error) => `- ${error}`),
    '',
    '你可以调整指令后重试；摘录卡请在阅读器中通过选区提炼生成。',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// 草稿器适配器：用真实 callModel 生成草稿 JSON。
// ---------------------------------------------------------------------------

const DRAFTER_SYSTEM_PROMPT = `你是 PaperQuay 的笔记蒸馏草稿器。根据用户指令与收集到的来源（摘录/问答笔记，可能附带 RAG 片段），产出一张笔记草稿。
只输出一个 JSON 对象，不要输出任何其他内容：
{
  "pageKind": "concept" | "synthesis" | "qa" | "paper-card",
  "title": "笔记标题",
  "content": "Markdown 正文",
  "paperId": "仅 paper-card 必填",
  "noteId": "仅当任务明显是更新某篇已有笔记时填其 id，否则省略",
  "tags": ["可选标签"],
  "reason": "一句话说明"
}
硬性约束：
- 禁止 pageKind=excerpt：摘录卡只能由阅读器选区生成，你不得创建，也不得在正文中编造 paperquay://anchor/ 锚点链接；更新已有笔记时只能原样保留其已有的锚点链接。
- concept：必须有「## 定义」定义段；正文每个实质句都要用 [[笔记标题]] 链回来源列表中的摘录或问答页标题；标题不得含「笔记」「总结」等冗余词。
- synthesis：正文实质句必须带 [n] 引用，n 只能取输入的 allowedRefs，不能沿用来源正文里出现的参考文献编号；文末必须有「## 参考文献」，每条 [n] 使用该来源的 paperTitle 原样填写文献标题，至少对应 2 篇不同文献。来源的 title 可能只是笔记标题，不能当成文献标题。实质陈述尽量保留来源原句中的关键词和数值，不要把一条来源扩写成多项未经证实的结论。
- qa：答案必须包含「证据位置」段，逐条列出证据的 [n] 编号（与来源列表 ref 一致）、paperId 以及 page 页码或 blockId；只有来源中存在的位置才能填写。
- paper-card：必须填 paperId，正文必须包含「我的判断」段。
- 推断内容必须明确标注「我的推断」；RAG 片段只作证据线索，不得当作摘录卡原文快照。
- 若 previousErrors 非空，必须逐条修正后重新产出完整 JSON。`;

interface DraftSourceRow {
  ref: number;
  kind: string;
  noteId?: string;
  title?: string;
  paperTitle?: string;
  paperId: string;
  page?: number | null;
  text: string;
}

function buildDraftSources(input: NoteDistillDraftInput): DraftSourceRow[] {
  const sources: DraftSourceRow[] = [];
  for (const note of input.collectedNotes) {
    sources.push({
      ref: sources.length + 1,
      kind: note.pageKind ?? 'note',
      noteId: note.id,
      title: note.title,
      paperTitle: note.paperTitle,
      paperId: note.paperId ?? '',
      text: completeSourcePreview(note.excerpt ?? note.content),
    });
  }
  for (const snippet of input.ragSnippets) {
    sources.push({
      ref: sources.length + 1,
      kind: 'rag-snippet',
      title: snippet.paperTitle,
      paperTitle: snippet.paperTitle,
      paperId: snippet.paperId,
      page: snippet.page,
      text: completeSourcePreview(snippet.snippet),
    });
  }
  return sources;
}

function parseDraftFromModelOutput(raw: string): AgentDistillDraft {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const candidate = fenced ? fenced[1] : (/\{[\s\S]*\}/.exec(raw)?.[0] ?? '');

  if (!candidate.trim()) {
    throw new Error('草稿器输出中没有可解析的 JSON 对象。');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new Error('草稿器输出的 JSON 无法解析。');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('草稿器输出的 JSON 不是对象。');
  }

  const record = parsed as Record<string, unknown>;
  const stringField = (key: string) => (typeof record[key] === 'string' ? (record[key] as string) : undefined);
  const tags = Array.isArray(record.tags)
    ? record.tags.filter((tag): tag is string => typeof tag === 'string' && Boolean(tag.trim())).map((tag) => tag.trim())
    : undefined;

  return {
    pageKind: stringField('pageKind')?.trim() ?? '',
    title: stringField('title')?.trim() ?? '',
    content: typeof record.content === 'string' ? record.content : '',
    ...(stringField('paperId')?.trim() ? { paperId: stringField('paperId')!.trim() } : {}),
    ...(stringField('noteId')?.trim() ? { noteId: stringField('noteId')!.trim() } : {}),
    ...(tags && tags.length > 0 ? { tags } : {}),
    ...(stringField('reason')?.trim() ? { reason: stringField('reason')!.trim() } : {}),
  };
}

/** 用真实模型调用构建笔记蒸馏草稿器。 */
export function createNoteDistillDrafter(callModel: NoteDistillCallModel): NoteDistillDrafter {
  return async (input) => {
    const sources = buildDraftSources(input);
    const response = await callModel({
      system: DRAFTER_SYSTEM_PROMPT,
      user: JSON.stringify({
        instruction: input.instruction,
        sources,
        allowedRefs: sources.map((source) => source.ref),
        previousErrors: input.previousErrors,
      }),
      signal: input.signal,
    });
    return parseDraftFromModelOutput(response.content);
  };
}
