import type { Note, NotePageKind } from '../types/notes';
import type { UiLanguage } from '../types/reader';

export const SYSTEM_PAGE_REFRESH_EVERY = 5;
let successfulWriteCount = 0;
const MANAGED_MARKER = '<!-- paperquay:managed-system-page';

/** 系统页正文语言；默认中文，保持旧调用输出不变。 */
export interface SystemPageLocaleOptions {
  locale?: UiLanguage;
}

function pickLocaleText<T>(locale: UiLanguage, zh: T, en: T): T {
  return locale === 'en-US' ? en : zh;
}

/** 第五个参数既可继续传操作摘要字符串，也可直接传 { locale }。 */
function systemPageOptions(
  operationSummary: string | SystemPageLocaleOptions | undefined,
  options: SystemPageLocaleOptions,
): { summary: string | undefined; locale: UiLanguage } {
  const inline = typeof operationSummary === 'object' && operationSummary !== null
    ? operationSummary
    : null;
  const merged = inline ?? options;
  return {
    summary: typeof operationSummary === 'string' ? operationSummary : undefined,
    locale: merged.locale ?? 'zh-CN',
  };
}

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16);
}

function marker(pageKind: NotePageKind, body: string): string {
  return `${MANAGED_MARKER} pageKind=${pageKind} hash=${hash(body)} -->`;
}

function splitManagedContent(content: string): { body: string; managed: boolean } {
  const firstLine = content.split('\n', 1)[0] ?? '';
  const match = firstLine.match(/pageKind=([a-z-]+)\s+hash=([0-9a-f]+)/);
  if (!match) return { body: content, managed: false };
  const body = content.slice(firstLine.length).replace(/^\n/, '');
  return { body, managed: hash(body) === match[2] };
}

function baseBody(pageKind: NotePageKind, locale: UiLanguage): string {
  if (pageKind === 'log') return pickLocaleText(locale, '# 研究日志\n\n', '# Research log\n\n');
  if (pageKind === 'index') {
    return pickLocaleText(
      locale,
      '# 笔记索引\n\n## 最近变更\n',
      '# Note index\n\n## Recent changes\n',
    );
  }
  return pickLocaleText(
    locale,
    '# 研究总览\n\n## 本次进展\n',
    '# Research overview\n\n## Latest progress\n',
  );
}

function managedContent(pageKind: NotePageKind, body: string): string {
  return `${marker(pageKind, body)}\n${body}`;
}

/** 多行 operationSummary 的续行缩进，保持为同一条日志项而不是新列表项。 */
function indentSummary(summary: string): string {
  return String(summary)
    .split('\n')
    .map((line, index) => (index === 0 ? line : `  ${line}`))
    .join('\n');
}

/** 取日志正文最后一条以 `- ` 开头的条目（含多行续行），语言切换合并时不能截断它。 */
function lastLogEntry(body: string): string {
  const lines = String(body).split('\n');
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].startsWith('- ')) {
      return lines.slice(index).join('\n').trimEnd();
    }
  }
  return '';
}

export function isManagedSystemPage(note: Note): boolean {
  return ['log', 'index', 'overview'].includes(note.pageKind ?? '')
    ? splitManagedContent(note.contentText ?? note.content).managed
    : false;
}

export function buildSystemPageBody(
  pageKind: NotePageKind,
  notes: Note[],
  changedNoteIds: string[],
  now = Date.now(),
  operationSummary?: string | SystemPageLocaleOptions,
  options: SystemPageLocaleOptions = {},
): string {
  const { summary: explicitSummary, locale } = systemPageOptions(operationSummary, options);
  const summary = indentSummary(explicitSummary ?? pickLocaleText(locale, '批量写入', 'Batch write'));
  const untitled = pickLocaleText(locale, '未命名笔记', 'Untitled note');
  const date = new Date(now).toISOString().slice(0, 10);
  const changed = changedNoteIds
    .map((id) => notes.find((note) => note.id === id))
    .filter((note): note is Note => Boolean(note))
    .map((note) => `[[${note.title || untitled}]]`)
    .join(pickLocaleText(locale, '、', ', ')) || pickLocaleText(locale, '无', 'None');

  if (pageKind === 'log') {
    return `${baseBody('log', locale)}${pickLocaleText(
      locale,
      `- ${date}：${summary}，涉及 ${changed}\n`,
      `- ${date}: ${summary}; notes: ${changed}\n`,
    )}`;
  }
  if (pageKind === 'index') {
    const links = notes
      .filter((note) => note.pageKind && !['index', 'log', 'overview'].includes(note.pageKind))
      .slice(0, 100)
      .map((note) => `- [[${note.title || untitled}]]`)
      .join('\n');
    return `${baseBody('index', locale)}${links || pickLocaleText(locale, '- 暂无页面', '- No pages yet')}\n`;
  }
  return pickLocaleText(
    locale,
    `${baseBody('overview', locale)}- 最近一次批量写入：${date}\n- 涉及笔记：${changed}\n`,
    `${baseBody('overview', locale)}- Last batch write: ${date}\n- Notes touched: ${changed}\n`,
  );
}

export function prepareSystemPageContent(
  pageKind: NotePageKind,
  existing: Note | null,
  notes: Note[],
  changedNoteIds: string[],
  now = Date.now(),
  operationSummary?: string | SystemPageLocaleOptions,
  options: SystemPageLocaleOptions = {},
): { action: 'create' | 'update' | 'skip'; content?: string } {
  const { locale } = systemPageOptions(operationSummary, options);
  const body = buildSystemPageBody(pageKind, notes, changedNoteIds, now, operationSummary, options);
  if (!existing) return { action: 'create', content: managedContent(pageKind, body) };
  if (!isManagedSystemPage(existing)) return { action: 'skip' };
  if (pageKind === 'log') {
    const current = splitManagedContent(existing.contentText ?? existing.content).body;
    const currentTitle = current.split('\n', 1)[0] ?? '';
    const targetTitle = baseBody('log', locale).split('\n', 1)[0] ?? '';
    // 界面语言切换后只重写标题与固定文案，保留已有日期条目（历史是数据，
    // 不因界面语言变化而丢弃）；新条目使用当前语言。
    if (currentTitle !== targetTitle) {
      const history = current.split('\n').slice(1).join('\n').trim();
      const newEntry = lastLogEntry(body);
      const merged = [
        baseBody('log', locale).trimEnd(),
        history,
        newEntry,
      ].filter(Boolean).join('\n');
      return { action: 'update', content: managedContent(pageKind, `${merged}\n`) };
    }
    // 同语言追加：保留最后一条日志的完整多行内容，不能只取末尾两行。
    const currentBody = current.trimEnd();
    const newEntry = lastLogEntry(body);
    const nextBody = newEntry && !currentBody.endsWith(newEntry)
      ? `${currentBody}\n${newEntry}`
      : currentBody;
    return { action: 'update', content: managedContent(pageKind, `${nextBody}\n`) };
  }
  return { action: 'update', content: managedContent(pageKind, body) };
}

export function shouldRefreshNavigationPages(applied: number): boolean {
  const before = successfulWriteCount;
  const increment = Math.max(0, applied);
  successfulWriteCount = (successfulWriteCount + increment) % SYSTEM_PAGE_REFRESH_EVERY;
  return increment > 0 && before + increment >= SYSTEM_PAGE_REFRESH_EVERY;
}

export function resetSystemPageRefreshCounter(): void {
  successfulWriteCount = 0;
}
