import type { Note } from '../types/notes';

export type NoteAggregationMode = 'paper-card' | 'concept';

export interface NoteAggregationDraft {
  title: string;
  pageKind: NoteAggregationMode;
  paperId?: string;
  content: string;
  sourceNoteIds: string[];
}

export interface NoteAggregationPaper {
  id: string;
  title: string;
  doi?: string | null;
  citation?: string | null;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function linkFor(note: Note): string {
  return `[[${clean(note.title) || '未命名笔记'}]]`;
}

function bodyFor(note: Note): string {
  return clean(note.contentText ?? note.content).replace(/\s+/g, ' ').slice(0, 500);
}

function citationEntry(paper: NoteAggregationPaper, index: number): string {
  const citation = clean(paper.citation);
  if (citation) return `${index}. ${citation}`;
  const doi = clean(paper.doi);
  return `${index}. ${paper.title}${doi ? `，DOI: ${doi}` : ''}`;
}

export function buildNoteAggregationDraft(input: {
  notes: Note[];
  mode: NoteAggregationMode;
  title: string;
  paperId?: string;
  topic?: string;
  papers?: NoteAggregationPaper[];
}): NoteAggregationDraft {
  const notes = input.notes.filter((note) => note.pageKind === 'excerpt' || note.type === 'highlight');
  const sourceLinks = notes.map(linkFor);
  const papers = input.papers ?? [];
  const paperById = new Map(papers.map((paper) => [paper.id, paper]));
  const referencedPaperIds = [
    ...new Set(
      notes
        .map((note) => note.linkedPaperId || (note.paperId !== 'global-notes' ? note.paperId : '') || '')
        .filter((paperId) => paperById.has(paperId)),
    ),
  ];
  const referenceNumberByPaperId = new Map(
    referencedPaperIds.map((paperId, index) => [paperId, index + 1]),
  );
  const referenceMarks = (note: Note) => {
    const paperId = note.linkedPaperId || (note.paperId !== 'global-notes' ? note.paperId : '') || '';
    const number = referenceNumberByPaperId.get(paperId);
    return number ? ` [${number}]` : '';
  };
  const bullets = notes.map(
    (note) => `- ${bodyFor(note)}${referenceMarks(note)}（来源：${linkFor(note)}）`,
  );
  const title = clean(input.title) || (input.mode === 'paper-card' ? '文献精读卡' : clean(input.topic) || '概念页');
  const references = referencedPaperIds.map((paperId, index) =>
    citationEntry(paperById.get(paperId)!, index + 1),
  );

  if (input.mode === 'paper-card') {
    return {
      title,
      pageKind: 'paper-card',
      paperId: input.paperId,
      sourceNoteIds: notes.map((note) => note.id),
      content: [
        '<!-- Agent aggregation draft: source anchors and snapshots are immutable. -->',
        '## 研究问题',
        '',
        `基于 ${sourceLinks.join('、') || '摘录卡'} 整理。`,
        '## 核心方法与发现',
        ...(bullets.length > 0 ? bullets : ['- 待从摘录卡整理']),
        '## 我的判断',
        '',
        '（由用户或 Agent 在审批前补充。）',
        '## 来源摘录卡',
        ...(sourceLinks.length > 0 ? sourceLinks.map((link) => `- ${link}`) : ['- 暂无']),
        ...(references.length > 0 ? ['## 参考文献', ...references] : []),
      ].join('\n'),
    };
  }

  return {
    title,
    pageKind: 'concept',
    sourceNoteIds: notes.map((note) => note.id),
    content: [
      '<!-- Agent aggregation draft: source anchors and snapshots are immutable. -->',
      '## 定义',
      '',
      clean(input.topic) || title,
      '## 关键理解',
      ...(bullets.length > 0 ? bullets : ['- 待从摘录卡整理']),
      '## 相关摘录卡',
      ...(sourceLinks.length > 0 ? sourceLinks.map((link) => `- ${link}`) : ['- 暂无']),
      '## 关联文献',
      ...(references.length > 0 ? references.map((reference, index) => `[${index + 1}] ${reference.slice(reference.indexOf(' ') + 1)}`) : ['- 暂无']),
      ...(references.length > 0 ? ['## 参考文献', ...references] : []),
    ].join('\n'),
  };
}

export function buildNoteHealthRepairInstruction(report: {
  orphanNoteIds: string[];
  brokenLinkNoteIds: string[];
  untitledNoteIds: string[];
  untaggedNoteIds: string[];
  staleNoteIds: string[];
}): string {
  return [
    '请根据以下笔记体检报告生成一个 write_notes 修复计划并等待审批。',
    '删除类问题只列出清单，不执行 delete 操作。',
    '断链修复必须优先使用已有 noteId 重挂 wikiLink；无法确认目标时只列出待人工处理，不要改成可能错误的标题文本。',
    '只可新增真实锚点，不得修改锚点指向或原文快照；不要修改摘录卡“我的想法”中的证据。',
    JSON.stringify(report),
  ].join('\n');
}
