import type { LocaleText } from './notesText.ts';
import { UNTITLED_NOTE_TITLE } from './notesText.ts';

/**
 * 笔记标题的展示文案。
 *
 * 新建笔记在数据层写入空标题；旧版本把「未命名笔记」或英文「Untitled Note」
 * 哨兵直接落库。它们在界面上都显示为当前语言的「未命名笔记 / Untitled note」，
 * 只影响展示，不回写数据（noteHealth 仍需把这些值都判为 untitled）。
 */
export function noteDisplayTitle(title: string | null | undefined, l: LocaleText): string {
  const raw = title ?? '';
  const normalized = raw.trim();

  if (
    !normalized
    || normalized === UNTITLED_NOTE_TITLE
    || normalized === 'Untitled Note'
    || normalized === 'Untitled note'
  ) {
    return l('未命名笔记', 'Untitled note');
  }

  return raw;
}

/**
 * 笔记锚点卡里的来源/定位兜底文案。
 *
 * 旧数据把「摘录」「正文摘录」「文献」「定位」写进 anchor attrs 或 sourceLabel；
 * 这些是固定语义而不是用户标题，展示时必须跟随界面语言。其余内容（论文标题、
 * P12 页码等）按数据原文显示。
 */
export function noteAnchorDisplayText(value: string | null | undefined, l: LocaleText): string {
  const text = (value ?? '').trim();
  if (text === '摘录' || text === '正文摘录' || text === '引用摘录') {
    return l(text, 'Excerpt');
  }
  if (text === '文献') return l('文献', 'Paper');
  if (text === '定位') return l('定位', 'Location');
  if (text === '引用') return l('引用', 'Reference');
  if (text === 'Reference') return l('引用', 'Reference');
  return value ?? '';
}
