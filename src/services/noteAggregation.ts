import type { Note } from '../types/notes';
import type { UiLanguage } from '../types/reader';

export type NoteAggregationMode = 'paper-card' | 'concept';

function pickLocaleText<T>(locale: UiLanguage, zh: T, en: T): T {
  return locale === 'en-US' ? en : zh;
}

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

function linkFor(note: Note, locale: UiLanguage): string {
  return `[[${clean(note.title) || pickLocaleText(locale, '未命名笔记', 'Untitled note')}]]`;
}

function bodyFor(note: Note): string {
  return clean(note.contentText ?? note.content).replace(/\s+/g, ' ').slice(0, 500);
}

function citationEntry(paper: NoteAggregationPaper, index: number, locale: UiLanguage): string {
  const citation = clean(paper.citation);
  if (citation) return `${index}. ${citation}`;
  const doi = clean(paper.doi);
  return `${index}. ${paper.title}${doi ? `${pickLocaleText(locale, '，DOI: ', ', DOI: ')}${doi}` : ''}`;
}

export function buildNoteAggregationDraft(input: {
  notes: Note[];
  mode: NoteAggregationMode;
  title: string;
  paperId?: string;
  topic?: string;
  papers?: NoteAggregationPaper[];
  /** 聚合稿语言；默认中文，英文界面输出英文小节与提示，摘录/引用原文不变。 */
  locale?: UiLanguage;
}): NoteAggregationDraft {
  const locale = input.locale ?? 'zh-CN';
  const l = <T>(zh: T, en: T): T => pickLocaleText(locale, zh, en);
  const notes = input.notes.filter((note) => note.pageKind === 'excerpt' || note.type === 'highlight');
  const sourceLinks = notes.map((note) => linkFor(note, locale));
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
    (note) => `- ${bodyFor(note)}${referenceMarks(note)}${l('（来源：', ' (source: ')}${linkFor(note, locale)}${l('）', ')')}`,
  );
  const title = clean(input.title)
    || (input.mode === 'paper-card'
      ? l('文献精读卡', 'Paper reading card')
      : clean(input.topic) || l('概念页', 'Concept page'));
  const references = referencedPaperIds.map((paperId, index) =>
    citationEntry(paperById.get(paperId)!, index + 1, locale),
  );

  if (input.mode === 'paper-card') {
    return {
      title,
      pageKind: 'paper-card',
      paperId: input.paperId,
      sourceNoteIds: notes.map((note) => note.id),
      content: [
        '<!-- Agent aggregation draft: source anchors and snapshots are immutable. -->',
        `## ${l('研究问题', 'Research question')}`,
        '',
        l(
          `基于 ${sourceLinks.join('、') || '摘录卡'} 整理。`,
          `Synthesized from ${sourceLinks.join(', ') || 'excerpt cards'}.`,
        ),
        `## ${l('核心方法与发现', 'Core method and findings')}`,
        ...(bullets.length > 0 ? bullets : [`- ${l('待从摘录卡整理', 'Pending synthesis from excerpt cards')}`]),
        `## ${l('我的判断', 'My take')}`,
        '',
        l('（由用户或 Agent 在审批前补充。）', '(To be filled in by the user or agent before approval.)'),
        `## ${l('来源摘录卡', 'Source excerpt cards')}`,
        ...(sourceLinks.length > 0 ? sourceLinks.map((link) => `- ${link}`) : [`- ${l('暂无', 'None yet')}`]),
        ...(references.length > 0 ? [`## ${l('参考文献', 'References')}`, ...references] : []),
      ].join('\n'),
    };
  }

  return {
    title,
    pageKind: 'concept',
    sourceNoteIds: notes.map((note) => note.id),
    content: [
      '<!-- Agent aggregation draft: source anchors and snapshots are immutable. -->',
      `## ${l('定义', 'Definition')}`,
      '',
      clean(input.topic) || title,
      `## ${l('关键理解', 'Key insights')}`,
      ...(bullets.length > 0 ? bullets : [`- ${l('待从摘录卡整理', 'Pending synthesis from excerpt cards')}`]),
      `## ${l('相关摘录卡', 'Related excerpt cards')}`,
      ...(sourceLinks.length > 0 ? sourceLinks.map((link) => `- ${link}`) : [`- ${l('暂无', 'None yet')}`]),
      `## ${l('关联文献', 'Related papers')}`,
      ...(references.length > 0 ? references.map((reference, index) => `[${index + 1}] ${reference.slice(reference.indexOf(' ') + 1)}`) : [`- ${l('暂无', 'None yet')}`]),
      ...(references.length > 0 ? [`## ${l('参考文献', 'References')}`, ...references] : []),
    ].join('\n'),
  };
}

/**
 * 笔记体检修复指令发给外部 Agent（MCP write_notes），不是用户可见 UI；
 * 为保持 Agent 行为与既有契约稳定，指令正文保持中文，不随界面语言变化。
 */
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
