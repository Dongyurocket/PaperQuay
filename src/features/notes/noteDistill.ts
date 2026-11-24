import type { JSONContent } from '@tiptap/core';
import type { CreateNoteRequest, Note, NoteAnchor, UpdateNoteRequest } from '../../types/notes';
import type { SelectedExcerpt, UiLanguage } from '../../types/reader';
import { notePolishTextToNodes } from './notePolish.ts';
import { collectText } from './notesTiptap.ts';
import { createNoteAnchorFromSelection, noteAnchorBlockFromAnchor, titleFromText } from './noteUtils.ts';

function pickLocaleText<T>(locale: UiLanguage, zh: T, en: T): T {
  return locale === 'en-US' ? en : zh;
}

function thoughtsHeading(locale: UiLanguage): string {
  return pickLocaleText(locale, '💭 我的想法：', '💭 My thoughts:');
}

/** 追加时两种语言的「我的想法」都要识别：已有英文摘录卡切回中文界面也应插在它之前。 */
function thoughtsHeadings(): string[] {
  return [
    pickLocaleText('zh-CN', '💭 我的想法：', '💭 My thoughts:'),
    pickLocaleText('en-US', '💭 我的想法：', '💭 My thoughts:'),
  ];
}

function excerptCardTag(locale: UiLanguage): string {
  return pickLocaleText(locale, '摘录卡', 'Excerpt card');
}

export interface DistilledExcerptSource {
  text: string;
  aiEnhanced?: boolean;
}

export function buildDistilledExcerptSource(
  selectedExcerpt: SelectedExcerpt,
  source?: DistilledExcerptSource,
): SelectedExcerpt & { aiEnhanced?: boolean } {
  const text = source?.text?.trim() || selectedExcerpt.text;
  return {
    ...selectedExcerpt,
    text,
    ...(source?.aiEnhanced ? { aiEnhanced: true } : {}),
  };
}

/**
 * 提炼式摘录卡（痛点 8）：锚点块在前（原文快照保真、不可手改），AI 提炼正文在后（可编辑），
 * 尾部固定「我的想法」区——提炼是忠实浓缩，想法是独立观点，二者结构分离。
 * 红线：提炼可以自由，证据必须保真——anchors[] 与锚点块携带原文 excerpt 与定位信息。
 */
export function buildDistilledExcerptNoteCreateRequest({
  paperId,
  selectedExcerpt,
  sourceTitle,
  distilledTitle,
  distilledText,
  sourceText,
  aiEnhanced = false,
  locale = 'zh-CN',
}: {
  paperId: string;
  selectedExcerpt: SelectedExcerpt;
  sourceTitle?: string;
  distilledTitle: string;
  distilledText: string;
  sourceText?: string;
  aiEnhanced?: boolean;
  locale?: UiLanguage;
}): CreateNoteRequest {
  const sourceExcerpt = buildDistilledExcerptSource(selectedExcerpt, {
    text: sourceText ?? selectedExcerpt.text,
    aiEnhanced,
  });
  const anchor = {
    ...createNoteAnchorFromSelection(sourceExcerpt, paperId, sourceTitle),
    ...(aiEnhanced ? { aiEnhanced: true } : {}),
  };
  const contentJson: JSONContent = {
    type: 'doc',
    content: [
      noteAnchorBlockFromAnchor(anchor),
      ...notePolishTextToNodes(distilledText),
      { type: 'paragraph', content: [{ type: 'text', text: thoughtsHeading(locale) }] },
    ],
  };
  const contentText = collectText(contentJson);

  return {
    paperId,
    type: selectedExcerpt.source === 'pdf' || selectedExcerpt.blockId ? 'highlight' : 'standalone',
    title: distilledTitle.trim() || titleFromText(anchor.excerpt),
    content: contentText,
    contentJson,
    contentText,
    excerpt: anchor.excerpt,
    pdfLocation: selectedExcerpt.pdfLocation ?? null,
    anchors: [anchor],
    tags: [excerptCardTag(locale)],
    color: '#dbeafe',
  };
}

/** 判断一条笔记是否可作为"追加提炼"的目标摘录卡（已有来源锚点）。 */
export function isExcerptCard(note: Note | null | undefined): boolean {
  return Boolean(note && Array.isArray(note.anchors) && note.anchors.length > 0);
}

/**
 * 多段累加（痛点 8：跨页累加）：把新一段选区的提炼正文 + 来源锚点追加到已有摘录卡，
 * 一条提炼挂多个来源锚点。已有锚点与原文快照原样保留，只增不改。
 */
export function buildDistilledExcerptAppendPatch({
  note,
  paperId,
  selectedExcerpt,
  sourceTitle,
  distilledText,
  sourceText,
  aiEnhanced = false,
}: {
  note: Note;
  paperId: string;
  selectedExcerpt: SelectedExcerpt;
  sourceTitle?: string;
  distilledText: string;
  sourceText?: string;
  aiEnhanced?: boolean;
}): { patch: UpdateNoteRequest; anchor: NoteAnchor } {
  const sourceExcerpt = buildDistilledExcerptSource(selectedExcerpt, {
    text: sourceText ?? selectedExcerpt.text,
    aiEnhanced,
  });
  const anchor = {
    ...createNoteAnchorFromSelection(sourceExcerpt, paperId, sourceTitle),
    ...(aiEnhanced ? { aiEnhanced: true } : {}),
  };
  const existing = note.contentJson && typeof note.contentJson === 'object'
    ? (note.contentJson as JSONContent)
    : { type: 'doc', content: [] };
  const content = [...(existing.content ?? [])];
  // 「我的想法」区保持在末尾：新提炼内容插入到它之前（若存在）。
  // 中英两种标题都识别，避免英文卡片在中文界面追加时被当成普通段落。
  const headings = thoughtsHeadings();
  const thoughtsIndex = content.findIndex(
    (node) => node?.type === 'paragraph'
      && Array.isArray(node.content)
      && node.content.some((child) => child?.type === 'text'
        && headings.some((heading) => String(child.text ?? '').startsWith(heading))),
  );
  const inserted: JSONContent[] = [
    noteAnchorBlockFromAnchor(anchor),
    ...notePolishTextToNodes(distilledText),
  ];
  if (thoughtsIndex >= 0) {
    content.splice(thoughtsIndex, 0, ...inserted);
  } else {
    content.push(...inserted);
  }
  const contentJson: JSONContent = { type: 'doc', content };
  const contentText = collectText(contentJson);

  return {
    anchor,
    patch: {
      content: contentText,
      contentJson,
      contentText,
      anchors: [...(note.anchors ?? []), anchor],
    },
  };
}
