import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SYSTEM_PAGE_REFRESH_EVERY,
  buildSystemPageBody,
  isManagedSystemPage,
  prepareSystemPageContent,
  resetSystemPageRefreshCounter,
  shouldRefreshNavigationPages,
} from '../src/services/noteSystemPages.ts';

const note = (id: string, title: string, pageKind: any = 'excerpt') => ({
  id,
  title,
  pageKind,
  content: '',
  contentText: '',
  paperId: 'paper-1',
  type: 'standalone',
  tags: [],
  anchors: [],
  linkedNoteIds: [],
  linkedPaperIds: [],
} as any);

test('系统页缺失时创建，自动管理页更新，用户改动后跳过', () => {
  const notes = [note('n1', '摘录一')];
  const created = prepareSystemPageContent('log', null, notes, ['n1'], Date.UTC(2026, 8, 26));
  assert.equal(created.action, 'create');
  assert.ok(created.content);
  const managed = note('log', '研究日志', 'log');
  managed.contentText = created.content;
  managed.content = created.content;
  assert.equal(isManagedSystemPage(managed), true);
  const updated = prepareSystemPageContent('log', managed, notes, ['n1'], Date.UTC(2026, 8, 27));
  assert.equal(updated.action, 'update');
  managed.contentText = `${created.content}\n用户手改`;
  managed.content = managed.contentText;
  assert.equal(isManagedSystemPage(managed), false);
  assert.equal(prepareSystemPageContent('log', managed, notes, ['n1']).action, 'skip');
});

test('系统页导航按每五次成功写操作刷新', () => {
  resetSystemPageRefreshCounter();
  assert.equal(SYSTEM_PAGE_REFRESH_EVERY, 5);
  assert.equal(shouldRefreshNavigationPages(1), false);
  assert.equal(shouldRefreshNavigationPages(2), false);
  assert.equal(shouldRefreshNavigationPages(3), true);
  assert.equal(shouldRefreshNavigationPages(5), true);
  resetSystemPageRefreshCounter();
});

test('系统页正文包含操作日期和双链', () => {
  const body = buildSystemPageBody('log', [note('n1', '新笔记')], ['n1'], Date.UTC(2026, 8, 26), 'create×1');
  assert.match(body, /2026-09-26/);
  assert.match(body, /create×1/);
  assert.match(body, /\[\[新笔记\]\]/);
});
