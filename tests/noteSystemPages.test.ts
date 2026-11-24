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

test('多行 operationSummary 在追加与语言切换时都不被截断', () => {
  const notes = [note('n1', '新笔记')];
  const summary = '批量更新 3 篇\n第二行：笔记与标签';
  const created = prepareSystemPageContent(
    'log',
    null,
    notes,
    ['n1'],
    Date.UTC(2026, 8, 26),
    summary,
  );
  assert.equal(created.action, 'create');
  assert.match(created.content ?? '', /第二行：笔记与标签/);

  const page = note('log', '研究日志', 'log');
  page.contentText = created.content;
  page.content = created.content;

  const updated = prepareSystemPageContent(
    'log',
    page,
    notes,
    ['n1'],
    Date.UTC(2026, 8, 27),
    summary,
  );
  assert.equal(updated.action, 'update');
  // 两条日志各自保留完整的第二行，而不是只留末尾两行。
  assert.equal((updated.content?.match(/第二行：笔记与标签/g) ?? []).length, 2);
  assert.match(updated.content ?? '', /2026-09-26/);
  assert.match(updated.content ?? '', /2026-09-27/);

  const englishPage = note('log', 'Research log', 'log');
  englishPage.contentText = updated.content;
  englishPage.content = updated.content;
  const switched = prepareSystemPageContent(
    'log',
    englishPage,
    notes,
    ['n1'],
    Date.UTC(2026, 8, 28),
    undefined,
    { locale: 'en-US' },
  );
  assert.equal(switched.action, 'update');
  assert.match(switched.content ?? '', /# Research log/);
  // 历史多行条目原样保留。
  assert.equal((switched.content?.match(/第二行：笔记与标签/g) ?? []).length, 2);
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

const CJK_PATTERN = /[一-鿿]/;

test('英文系统页创建、managed 识别与同语言追加仍然工作', () => {
  const notes = [note('n1', 'Paper A')];
  const created = prepareSystemPageContent(
    'log',
    null,
    notes,
    ['n1'],
    Date.UTC(2026, 8, 26),
    undefined,
    { locale: 'en-US' },
  );
  assert.equal(created.action, 'create');
  assert.ok(created.content);
  assert.doesNotMatch(created.content, CJK_PATTERN);
  assert.match(created.content, /# Research log/);
  assert.match(created.content, /2026-09-26: Batch write; notes: \[\[Paper A\]\]/);

  const managed = note('log', 'Research log', 'log');
  managed.contentText = created.content;
  managed.content = created.content;
  assert.equal(isManagedSystemPage(managed), true);

  const updated = prepareSystemPageContent(
    'log',
    managed,
    notes,
    ['n1'],
    Date.UTC(2026, 8, 27),
    undefined,
    { locale: 'en-US' },
  );
  assert.equal(updated.action, 'update');
  assert.doesNotMatch(updated.content ?? '', CJK_PATTERN);
  assert.match(updated.content ?? '', /2026-09-26/);
  assert.match(updated.content ?? '', /2026-09-27/);
});

test('切换界面语言后只重写标题与固定文案，保留历史日期条目', () => {
  const notes = [note('n1', 'Paper A')];
  const zhContent = prepareSystemPageContent(
    'log',
    null,
    notes,
    ['n1'],
    Date.UTC(2026, 8, 26),
  ).content;
  const zhPage = note('log', '研究日志', 'log');
  zhPage.contentText = zhContent;
  zhPage.content = zhContent;
  assert.equal(isManagedSystemPage(zhPage), true);

  const switchedToEnglish = prepareSystemPageContent(
    'log',
    zhPage,
    notes,
    ['n1'],
    Date.UTC(2026, 8, 27),
    undefined,
    { locale: 'en-US' },
  );
  assert.equal(switchedToEnglish.action, 'update');
  assert.match(switchedToEnglish.content ?? '', /# Research log/);
  // 历史条目是数据：切换界面语言不能把它们丢掉；旧条目保留原语言，新条目用英文。
  assert.match(switchedToEnglish.content ?? '', /2026-09-26/);
  assert.match(switchedToEnglish.content ?? '', /2026-09-27: Batch write/);

  const englishPage = note('log', 'Research log', 'log');
  englishPage.contentText = switchedToEnglish.content;
  englishPage.content = switchedToEnglish.content;
  const switchedBack = prepareSystemPageContent(
    'log',
    englishPage,
    notes,
    ['n1'],
    Date.UTC(2026, 8, 28),
    undefined,
    { locale: 'zh-CN' },
  );
  assert.equal(switchedBack.action, 'update');
  assert.match(switchedBack.content ?? '', /# 研究日志/);
  assert.doesNotMatch(switchedBack.content ?? '', /Research log/);
  assert.match(switchedBack.content ?? '', /2026-09-26/);
  assert.match(switchedBack.content ?? '', /2026-09-27/);
  assert.match(switchedBack.content ?? '', /2026-09-28/);
});

test('英文索引页与总览页使用英文标题、空态与摘要', () => {
  const notes = [note('n1', 'Paper A', 'excerpt'), note('log', '研究日志', 'log')];
  const index = buildSystemPageBody(
    'index',
    notes,
    [],
    Date.UTC(2026, 8, 26),
    undefined,
    { locale: 'en-US' },
  );
  assert.doesNotMatch(index, CJK_PATTERN);
  assert.match(index, /# Note index/);
  assert.match(index, /## Recent changes/);
  assert.match(index, /- \[\[Paper A\]\]/);

  const emptyIndex = buildSystemPageBody(
    'index',
    [],
    [],
    Date.UTC(2026, 8, 26),
    undefined,
    { locale: 'en-US' },
  );
  assert.match(emptyIndex, /- No pages yet/);

  const overview = buildSystemPageBody(
    'overview',
    notes,
    ['n1'],
    Date.UTC(2026, 8, 26),
    undefined,
    { locale: 'en-US' },
  );
  assert.doesNotMatch(overview, CJK_PATTERN);
  assert.match(overview, /# Research overview/);
  assert.match(overview, /Last batch write: 2026-09-26/);
  assert.match(overview, /Notes touched: \[\[Paper A\]\]/);

  // 第五个参数直接传 { locale } 时同样生效（options 参数兼容写法）。
  const inlineOptions = buildSystemPageBody(
    'overview',
    notes,
    ['n1'],
    Date.UTC(2026, 8, 26),
    { locale: 'en-US' },
  );
  assert.doesNotMatch(inlineOptions, CJK_PATTERN);
  assert.match(inlineOptions, /Last batch write: 2026-09-26/);
});
