import type { Note, NotePageKind } from '../types/notes';

export const SYSTEM_PAGE_REFRESH_EVERY = 5;
let successfulWriteCount = 0;
const MANAGED_MARKER = '<!-- paperquay:managed-system-page';

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

function baseBody(pageKind: NotePageKind): string {
  if (pageKind === 'log') return '# 研究日志\n\n';
  if (pageKind === 'index') return '# 笔记索引\n\n## 最近变更\n';
  return '# 研究总览\n\n## 本次进展\n';
}

function managedContent(pageKind: NotePageKind, body: string): string {
  return `${marker(pageKind, body)}\n${body}`;
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
  operationSummary = '批量写入',
): string {
  const date = new Date(now).toISOString().slice(0, 10);
  const changed = changedNoteIds
    .map((id) => notes.find((note) => note.id === id))
    .filter((note): note is Note => Boolean(note))
    .map((note) => `[[${note.title || '未命名笔记'}]]`)
    .join('、') || '无';

  if (pageKind === 'log') return `${baseBody('log')}- ${date}：${operationSummary}，涉及 ${changed}\n`;
  if (pageKind === 'index') {
    const links = notes
      .filter((note) => note.pageKind && !['index', 'log', 'overview'].includes(note.pageKind))
      .slice(0, 100)
      .map((note) => `- [[${note.title || '未命名笔记'}]]`)
      .join('\n');
    return `${baseBody('index')}${links || '- 暂无页面'}\n`;
  }
  return `${baseBody('overview')}- 最近一次批量写入：${date}\n- 涉及笔记：${changed}\n`;
}

export function prepareSystemPageContent(
  pageKind: NotePageKind,
  existing: Note | null,
  notes: Note[],
  changedNoteIds: string[],
  now = Date.now(),
  operationSummary = '批量写入',
): { action: 'create' | 'update' | 'skip'; content?: string } {
  const body = buildSystemPageBody(pageKind, notes, changedNoteIds, now, operationSummary);
  if (!existing) return { action: 'create', content: managedContent(pageKind, body) };
  if (!isManagedSystemPage(existing)) return { action: 'skip' };
  if (pageKind === 'log') {
    const current = splitManagedContent(existing.contentText ?? existing.content).body;
    return { action: 'update', content: managedContent(pageKind, `${current.trimEnd()}\n${body.split('\n').slice(-2).join('\n')}\n`) };
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
