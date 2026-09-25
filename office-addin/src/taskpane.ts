/**
 * Word 加载项任务窗格入口（v2）。
 *
 * 分层：
 *  - word/operations.ts：文档操作（插入/编辑/刷新差量/文献表/取消链接/迁移），与 Office.js 解耦；
 *  - word/officeAdapter.ts：Office.js 实现（WordApi 1.1 底线 + 能力检测）；
 *  - bridge/client.ts：同源 /api/v1 连接 PaperQuay（免 token、自动重连）；
 *  - 本文件：UI 状态与事件；所有写文档动作经 queue 串行。
 *
 * ribbon 按钮都是 ShowTaskpane，URL 带 ?action=cite|bib|refresh|prefs，面板打开后执行对应动作。
 */
import './polyfills.ts';
import {
  CITATION_STYLES,
  citationStyleKind,
  normalizeCitationStyle,
  type CitationItemInput,
  type DocumentPrefs,
  type ManualEdit,
} from '../../src/shared/citation/index.ts';
import { createBridgeClient, type WirePaper } from './bridge/client.ts';
import { byId, clear, debounce, errorMessage, h, paperMetaLine, show } from './ui/dom.ts';
import { createOfficeAdapter } from './word/officeAdapter.ts';
import { createOperations, type Operations, type RefreshResult } from './word/operations.ts';
import { createTaskQueue } from './word/queue.ts';
import type { WordAdapter } from './word/types.ts';

const SEARCH_LIMIT = 30;

interface EditorState {
  citeId: string;
  items: CitationItemInput[];
}

const state = {
  results: [] as WirePaper[],
  activeIndex: -1,
  selected: new Map<string, WirePaper>(),
  editor: null as EditorState | null,
  lastRefresh: null as RefreshResult | null,
  log: [] as string[],
};

const client = createBridgeClient();
const queue = createTaskQueue();
let adapter: WordAdapter;
let ops: Operations;

/* ------------------------------------------------------------------ 通用 UI */

function log(message: string): void {
  const stamp = new Date().toTimeString().slice(0, 8);
  state.log.unshift(`[${stamp}] ${message}`);
  state.log = state.log.slice(0, 60);
  const node = byId('log');
  node.textContent = state.log.join('\n');
  show(node, true);
}

function notify(message: string, kind: 'info' | 'error' = 'info', actions: Array<{ label: string; run: () => void }> = []): void {
  const node = byId('notice');
  clear(node);
  node.className = kind === 'error' ? 'notice notice--error' : 'notice';
  node.appendChild(h('div', { text: message }));
  const row = h('div', { className: 'actions' });
  for (const action of actions) {
    const button = h('button', { className: 'button', text: action.label, attrs: { type: 'button' } });
    button.addEventListener('click', () => {
      show(node, false);
      action.run();
    });
    row.appendChild(button);
  }
  const dismiss = h('button', { className: 'link-button', text: '关闭', attrs: { type: 'button' } });
  dismiss.addEventListener('click', () => show(node, false));
  row.appendChild(dismiss);
  node.appendChild(row);
  show(node, true);
}

function fail(prefix: string, error: unknown): void {
  const message = `${prefix}：${errorMessage(error)}`;
  log(message);
  notify(message, 'error');
}

/** 所有写文档动作的统一入口：排队、显示忙碌态、统一报错。 */
function perform<T>(label: string, task: () => Promise<T>): Promise<T | undefined> {
  return queue.run(label, task).catch((error: unknown) => {
    fail(label + '失败', error);
    return undefined;
  });
}

function renderConnection(): void {
  const status = byId('bridge-status');
  const current = client.state();
  const health = client.health();
  if (current === 'online') {
    status.textContent = `已连接 PaperQuay${health?.appVersion ? ' ' + health.appVersion : ''}`;
    status.className = 'status status--ok';
  } else if (current === 'connecting') {
    status.textContent = '正在连接…';
    status.className = 'status status--idle';
  } else {
    status.textContent = '未连接';
    status.className = 'status status--error';
  }
  show(byId('offline-banner'), current === 'offline');
  updateButtons();
}

function updateButtons(): void {
  const online = client.state() === 'online';
  (byId('insert-citation-button') as HTMLButtonElement).disabled = !online || state.selected.size === 0;
  (byId('editor-add-button') as HTMLButtonElement).disabled = state.selected.size === 0;
  (byId('update-items-button') as HTMLButtonElement).disabled = !online;
  (byId('quick-cite-button') as HTMLButtonElement).disabled = !online;
}

/* ------------------------------------------------------------------ 检索 */

function citedIds(): Set<string> {
  return new Set(ops ? ops.citedPaperIds() : []);
}

function renderSearchResults(): void {
  const container = byId('search-results');
  clear(container);
  const cited = citedIds();
  state.results.forEach((paper, index) => {
    const checkbox = h('input', { attrs: { type: 'checkbox', tabindex: '-1' } }) as HTMLInputElement;
    checkbox.checked = state.selected.has(paper.id);
    const row = h(
      'div',
      {
        className:
          'result' +
          (state.selected.has(paper.id) ? ' result--selected' : '') +
          (index === state.activeIndex ? ' result--active' : '') +
          (cited.has(paper.id) ? ' result--cited' : ''),
        attrs: { role: 'option' },
      },
      [
        checkbox,
        h('div', { className: 'result__body' }, [
          h('div', { className: 'result__title', text: paper.title || '(无标题)' }),
          h('div', { className: 'result__meta', text: paperMetaLine(paper) }),
        ]),
      ],
    );
    row.addEventListener('click', () => toggleSelected(paper));
    container.appendChild(row);
  });
  if (state.results.length === 0 && (byId('search-input') as HTMLInputElement).value.trim()) {
    container.appendChild(h('div', { className: 'hint', text: client.state() === 'online' ? '没有匹配的文献。' : '未连接 PaperQuay，无法检索。' }));
  }
  renderSelection();
}

function toggleSelected(paper: WirePaper): void {
  if (state.selected.has(paper.id)) state.selected.delete(paper.id);
  else state.selected.set(paper.id, paper);
  renderSearchResults();
}

function renderSelection(): void {
  const node = byId('selection');
  if (state.selected.size === 0) node.textContent = '未选择文献（Enter 选中高亮项，Ctrl+Enter 插入）';
  else {
    const titles: string[] = [];
    state.selected.forEach((paper) => titles.push(paper.title || '(无标题)'));
    node.textContent = `已选 ${state.selected.size} 篇：${titles.join('；')}`;
  }
  updateButtons();
}

let searchSeq = 0;
async function searchPapers(): Promise<void> {
  const query = (byId('search-input') as HTMLInputElement).value.trim();
  const seq = (searchSeq += 1);
  if (client.state() !== 'online') {
    state.results = [];
    renderSearchResults();
    return;
  }
  try {
    const result = await client.searchPapers(query, SEARCH_LIMIT);
    if (seq !== searchSeq) return;
    state.results = result.papers;
    state.activeIndex = state.results.length > 0 ? 0 : -1;
    renderSearchResults();
  } catch (error) {
    if (seq === searchSeq) log(`检索失败：${errorMessage(error)}`);
  }
}

function citationItemsFromSelection(): { items: CitationItemInput[]; papers: WirePaper[] } {
  const locator = (byId('locator-input') as HTMLInputElement).value.trim();
  const prefix = (byId('prefix-input') as HTMLInputElement).value.trim();
  const suffix = (byId('suffix-input') as HTMLInputElement).value.trim();
  const suppressAuthor = (byId('suppress-author-input') as HTMLInputElement).checked;
  const papers: WirePaper[] = [];
  state.selected.forEach((paper) => papers.push(paper));
  const items = papers.map((paper, index) => ({
    paperId: paper.id,
    label: paper.title,
    locator: papers.length === 1 ? locator || null : null,
    prefix: index === 0 ? prefix || null : null,
    suffix: index === papers.length - 1 ? suffix || null : null,
    suppressAuthor,
  }));
  return { items, papers };
}

function clearSelectionInputs(): void {
  state.selected.clear();
  for (const id of ['locator-input', 'prefix-input', 'suffix-input']) (byId(id) as HTMLInputElement).value = '';
  (byId('suppress-author-input') as HTMLInputElement).checked = false;
  renderSearchResults();
}

/* ------------------------------------------------------------------ 文档动作 */

function afterRefresh(result: RefreshResult | undefined, message?: string): void {
  if (!result) return;
  state.lastRefresh = result;
  renderCitationList();
  renderSearchResults();
  if (result.splitDuplicates > 0) log(`检测到 ${result.splitDuplicates} 处复制粘贴的引用，已拆分为独立引用。`);
  if (result.missingSnapshots.length > 0) {
    if (client.state() === 'online') void updateItemsFromLibrary(true);
    else log(`${result.missingSnapshots.length} 篇文献缺少条目信息，连接 PaperQuay 后会自动补齐。`);
  }
  if (result.pendingManualEdits.length > 0) promptManualEdits(result.pendingManualEdits);
  if (message) log(message);
  renderDiagnostics();
}

function promptManualEdits(edits: ManualEdit[]): void {
  const sample = edits
    .slice(0, 3)
    .map((edit) => `「${edit.currentText.trim()}」→「${edit.expectedText}」`)
    .join('；');
  notify(`有 ${edits.length} 处引用被手动修改过：${sample}。刷新时要怎么处理？`, 'info', [
    { label: '保留我的修改', run: () => void refresh('keep') },
    { label: '用 PaperQuay 覆盖', run: () => void refresh('overwrite') },
  ]);
}

async function warnIfTracking(): Promise<void> {
  const tracking = await adapter.isTrackingChanges();
  if (tracking) log('提示：文档处于修订模式，引用更新会记为修订。');
}

function refresh(manualEdits: 'ask' | 'keep' | 'overwrite' = 'ask', silent = false): Promise<void> {
  return perform('刷新', async () => {
    const result = await ops.refresh({ manualEdits });
    afterRefresh(result, silent ? undefined : result.plan ? `已刷新：${result.plan.render.entries.length} 条文献，更新了 ${result.rewritten} 处引用。` : '文档里还没有 PaperQuay 引用。');
  }).then(() => undefined);
}

function insertCitation(): Promise<void> {
  const { items, papers } = citationItemsFromSelection();
  if (items.length === 0) {
    notify('请先在检索结果里选中至少一篇文献。');
    return Promise.resolve();
  }
  return perform('插入引用', async () => {
    await warnIfTracking();
    const result = await ops.insertCitation(items, papers);
    clearSelectionInputs();
    afterRefresh(result, `已插入引用（${items.length} 篇）。`);
    void writeBackCited();
  }).then(() => undefined);
}

function insertBibliography(): Promise<void> {
  return perform('插入参考文献表', async () => {
    const result = await ops.insertOrUpdateBibliography();
    afterRefresh(result, `参考文献表已就位：${result.plan ? result.plan.render.entries.length : 0} 条，正文引用可点击跳转。`);
  }).then(() => undefined);
}

async function writeBackCited(): Promise<void> {
  if (client.state() !== 'online') return;
  const paperIds = ops.citedPaperIds();
  if (paperIds.length === 0) return;
  try {
    await client.recordCited({ documentId: ops.getModel().documentId, documentTitle: adapter.documentTitle(), paperIds });
  } catch (error) {
    log(`写回「本文引用过」失败：${errorMessage(error)}`);
  }
}

/** 用 PaperQuay 库里的最新元数据刷新文档内快照，然后重排。 */
function updateItemsFromLibrary(automatic = false): Promise<void> {
  return perform('更新条目', async () => {
    const ids = ops.citedPaperIds();
    if (ids.length === 0) return;
    const { papers, missing } = await client.fetchPapers(ids);
    await ops.applySnapshots(papers, missing);
    const result = await ops.refresh({ manualEdits: 'ask' });
    afterRefresh(
      result,
      automatic ? undefined : `已从文献库更新 ${papers.length} 条${missing.length ? `，${missing.length} 条库中已不存在（保留文档内信息）` : ''}。`,
    );
  }).then(() => undefined);
}

/* ------------------------------------------------------------------ 本文引用列表 */

function paperLabel(paperId: string, fallback?: string | null): string {
  const snapshot = ops.getModel().items[paperId];
  return snapshot?.paper.title || fallback || paperId;
}

function renderCitationList(): void {
  const container = byId('document-citations');
  clear(container);
  const model = ops.getModel();
  const plan = state.lastRefresh?.plan;
  const ordered = state.lastRefresh?.scan.ordered ?? model.citations.map((citation) => citation.citeId);
  const seqByPaperId = new Map<string, number>();
  if (plan) for (const entry of plan.render.entries) seqByPaperId.set(entry.paperId, entry.seq);
  const numeric = plan ? plan.render.kind === 'numeric' : citationStyleKind(model.prefs.style) === 'numeric';
  const textByCite = new Map<string, string>();
  if (plan) for (const citation of plan.citations) textByCite.set(citation.citeId, citation.text);
  let count = 0;
  const seen = new Set<string>();
  for (const citeId of ordered) {
    const citation = model.citations.find((item) => item.citeId === citeId);
    if (!citation || seen.has(citeId)) continue;
    seen.add(citeId);
    count += 1;
    const missing = citation.items.some((item) => model.items[item.paperId]?.missing || !model.items[item.paperId]);
    const titles = citation.items.map((item) => {
      const seq = seqByPaperId.get(item.paperId);
      return `${numeric && seq ? `[${seq}] ` : ''}${paperLabel(item.paperId, item.label)}`;
    });
    const locate = h('button', { className: 'link-button', text: '定位', attrs: { type: 'button' } });
    locate.addEventListener('click', () => void perform('定位', () => adapter.select({ citeId })));
    const edit = h('button', { className: 'link-button', text: '编辑', attrs: { type: 'button' } });
    edit.addEventListener('click', () => openEditor(citeId));
    const remove = h('button', { className: 'link-button', text: '删除', attrs: { type: 'button' } });
    remove.addEventListener('click', () =>
      void perform('删除引用', async () => afterRefresh(await ops.removeCitation(citeId), '已删除一条引用。')),
    );
    const meta = [
      textByCite.get(citeId) || citation.lastText || '',
      citation.manualText !== undefined ? '已保留手改' : '',
      missing ? '部分文献不在库中（使用文档内信息）' : '',
    ]
      .filter(Boolean)
      .join(' · ');
    container.appendChild(
      h('div', { className: 'citation' + (missing ? ' citation--missing' : '') }, [
        h('div', { className: 'citation__body' }, [
          h('div', { className: 'citation__title', text: titles.join('；') }),
          h('div', { className: 'citation__meta', text: meta }),
        ]),
        h('div', { className: 'actions' }, [locate, edit, remove]),
      ]),
    );
  }
  byId('citation-count').textContent = count > 0 ? `（${count} 处，${plan ? plan.render.entries.length : '?'} 篇）` : '';
  if (count === 0) container.appendChild(h('div', { className: 'hint', text: '文档里还没有 PaperQuay 引用。' }));
}

/* ------------------------------------------------------------------ 光标处编辑 */

function openEditor(citeId: string): void {
  const citation = ops.getModel().citations.find((item) => item.citeId === citeId);
  if (!citation) return;
  state.editor = { citeId, items: citation.items.map((item) => ({ ...item })) };
  renderEditor();
}

function renderEditor(): void {
  const card = byId('editor-card');
  const editor = state.editor;
  show(card, Boolean(editor));
  if (!editor) return;
  const current = ops.getModel().citations.find((item) => item.citeId === editor.citeId);
  byId('editor-text').textContent = current?.lastText ? `（${current.lastText}）` : '';
  const container = byId('editor-items');
  clear(container);
  editor.items.forEach((item, index) => {
    const locator = h('input', { attrs: { type: 'text', placeholder: '页码' } }) as HTMLInputElement;
    locator.value = item.locator || '';
    locator.addEventListener('change', () => {
      item.locator = locator.value.trim() || null;
    });
    const up = h('button', { className: 'link-button', text: '↑', title: '上移', attrs: { type: 'button' } });
    up.addEventListener('click', () => {
      if (index === 0) return;
      const moved = editor.items.splice(index, 1)[0];
      editor.items.splice(index - 1, 0, moved);
      renderEditor();
    });
    const remove = h('button', { className: 'link-button', text: '移除', attrs: { type: 'button' } });
    remove.addEventListener('click', () => {
      editor.items.splice(index, 1);
      renderEditor();
    });
    container.appendChild(
      h('div', { className: 'citation' }, [
        h('div', { className: 'citation__body' }, [h('div', { className: 'citation__title', text: paperLabel(item.paperId, item.label) })]),
        h('div', { className: 'item-row' }, [locator, up, remove]),
      ]),
    );
  });
  if (editor.items.length === 0) container.appendChild(h('div', { className: 'hint', text: '已移除全部文献：保存后将删除该引用。' }));
  updateButtons();
}

function saveEditor(): Promise<void> {
  const editor = state.editor;
  if (!editor) return Promise.resolve();
  const papers: WirePaper[] = [];
  state.selected.forEach((paper) => papers.push(paper));
  return perform('保存引用修改', async () => {
    const result = await ops.editCitation(editor.citeId, editor.items, papers);
    state.editor = null;
    renderEditor();
    afterRefresh(result, '引用已更新。');
    void writeBackCited();
  }).then(() => undefined);
}

const syncEditorWithSelection = debounce(() => {
  if (!ops) return;
  // 读选区不写文档，不进队列；有排队中的写操作时跳过，避免读到中间态。
  if (queue.busy()) return;
  void adapter.citeIdAtSelection().then((citeId) => {
    if (citeId && (!state.editor || state.editor.citeId !== citeId)) openEditor(citeId);
  });
}, 300);

/* ------------------------------------------------------------------ 首选项 */

function renderPrefs(): void {
  const prefs = ops.getModel().prefs;
  const select = byId('style-select') as HTMLSelectElement;
  clear(select);
  for (const style of CITATION_STYLES) {
    const option = h('option', {
      text: `${style.label}（${style.kind === 'numeric' ? '顺序编码' : '著者-出版年'}）`,
      title: style.description,
      attrs: { value: style.id },
    }) as HTMLOptionElement;
    option.selected = style.id === prefs.style;
    select.appendChild(option);
  }
  (byId('punctuation-select') as HTMLSelectElement).value = prefs.punctuation;
  (byId('bib-order-select') as HTMLSelectElement).value = prefs.bibliographyOrder;
  (byId('bibliography-title-input') as HTMLInputElement).value = prefs.bibliographyTitle;
  (byId('bib-heading-input') as HTMLInputElement).checked = prefs.bibHeading;
  (byId('superscript-input') as HTMLInputElement).checked = prefs.superscript;
  (byId('links-input') as HTMLInputElement).checked = prefs.links;
  show(byId('punctuation-row'), prefs.style === 'gbt7714-87');
  show(byId('bib-order-row'), citationStyleKind(prefs.style) === 'author-date');
}

function updatePrefs(patch: Partial<DocumentPrefs>, message: string): void {
  void perform('更新首选项', async () => {
    const result = await ops.updatePrefs(patch);
    renderPrefs();
    afterRefresh(result, message);
  });
}

/* ------------------------------------------------------------------ 快速引用对话框 */

function openQuickCite(): void {
  if (!adapter.capabilities().dialogApi) {
    (byId('search-input') as HTMLInputElement).focus();
    return;
  }
  const url = `${window.location.protocol}//${window.location.host}/dialog.html`;
  Office.context.ui.displayDialogAsync(url, { height: 45, width: 40, displayInIframe: true }, (result) => {
    if (result.status !== Office.AsyncResultStatus.Succeeded) {
      log(`打开快速引用对话框失败：${result.error.message}`);
      (byId('search-input') as HTMLInputElement).focus();
      return;
    }
    const dialog = result.value;
    dialog.addEventHandler(Office.EventType.DialogMessageReceived, (arg) => {
      const message = arg as { message?: string };
      dialog.close();
      let payload: { papers?: WirePaper[]; locator?: string } | null = null;
      try {
        payload = JSON.parse(message.message || 'null');
      } catch {
        payload = null;
      }
      if (!payload || !Array.isArray(payload.papers) || payload.papers.length === 0) return;
      state.selected.clear();
      for (const paper of payload.papers) state.selected.set(paper.id, paper);
      (byId('locator-input') as HTMLInputElement).value = payload.locator || '';
      void insertCitation();
    });
  });
}

/* ------------------------------------------------------------------ 诊断 */

function renderDiagnostics(): void {
  const caps = adapter ? adapter.capabilities() : null;
  const model = ops ? ops.getModel() : null;
  let host = '';
  try {
    host = `${Office.context.diagnostics.platform} ${Office.context.diagnostics.version}`;
  } catch {
    host = '未知';
  }
  const lines = [
    `加载项：0.4.0（文档模型 v2）`,
    `Word：${host}`,
    `内核：${navigator.userAgent}`,
    `WordApi 1.3：${caps?.wordApi13 ? '支持' : '不支持'} · Custom XML：${caps?.customXmlParts ? '支持' : '不支持'} · 对话框：${caps?.dialogApi ? '支持' : '不支持'}`,
    `Service Worker：${'serviceWorker' in navigator ? '可用' : '不可用'}`,
    `连接：${client.state()}${client.health() ? `（PaperQuay ${client.health()?.appVersion}，apiVersion ${client.health()?.apiVersion}）` : ''}`,
    `文档：${model ? `${model.citations.length} 条引用记录，${Object.keys(model.items).length} 篇快照，rev ${model.rev}，样式 ${model.prefs.style}` : '未加载'}`,
  ];
  byId('diagnostics').textContent = lines.join('\n');
}

/* ------------------------------------------------------------------ 事件绑定 */

function bindEvents(): void {
  const search = byId('search-input') as HTMLInputElement;
  const debouncedSearch = debounce(() => void searchPapers(), 250);
  search.addEventListener('input', () => debouncedSearch());
  search.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'Down') {
      state.activeIndex = Math.min(state.results.length - 1, state.activeIndex + 1);
      renderSearchResults();
      event.preventDefault();
    } else if (event.key === 'ArrowUp' || event.key === 'Up') {
      state.activeIndex = Math.max(0, state.activeIndex - 1);
      renderSearchResults();
      event.preventDefault();
    } else if (event.key === 'Enter') {
      if (event.ctrlKey || (state.selected.size > 0 && state.activeIndex < 0)) {
        void insertCitation();
      } else if (state.results[state.activeIndex]) {
        toggleSelected(state.results[state.activeIndex]);
      }
      event.preventDefault();
    }
  });

  byId('retry-button').addEventListener('click', () => void client.probe());
  byId('quick-cite-button').addEventListener('click', openQuickCite);
  byId('insert-citation-button').addEventListener('click', () => void insertCitation());
  byId('insert-bibliography-button').addEventListener('click', () => void insertBibliography());
  byId('refresh-button').addEventListener('click', () => void refresh('ask'));
  byId('update-items-button').addEventListener('click', () => void updateItemsFromLibrary());

  byId('editor-save-button').addEventListener('click', () => void saveEditor());
  byId('editor-cancel-button').addEventListener('click', () => {
    state.editor = null;
    renderEditor();
  });
  byId('editor-add-button').addEventListener('click', () => {
    const editor = state.editor;
    if (!editor) return;
    state.selected.forEach((paper) => {
      if (!editor.items.some((item) => item.paperId === paper.id)) editor.items.push({ paperId: paper.id, label: paper.title });
    });
    renderEditor();
  });

  byId('style-select').addEventListener('change', () => {
    const style = normalizeCitationStyle((byId('style-select') as HTMLSelectElement).value);
    updatePrefs({ style }, `引用样式已切换为 ${style}。`);
  });
  byId('punctuation-select').addEventListener('change', () =>
    updatePrefs({ punctuation: (byId('punctuation-select') as HTMLSelectElement).value === 'half' ? 'half' : 'full' }, 'GB 7714-87 标点已切换。'),
  );
  byId('bib-order-select').addEventListener('change', () =>
    updatePrefs(
      { bibliographyOrder: (byId('bib-order-select') as HTMLSelectElement).value === 'appearance' ? 'appearance' : 'alpha' },
      '文献表排序已切换。',
    ),
  );
  byId('bibliography-title-input').addEventListener('change', () =>
    updatePrefs({ bibliographyTitle: (byId('bibliography-title-input') as HTMLInputElement).value.trim() }, '参考文献表标题已更新。'),
  );
  byId('bib-heading-input').addEventListener('change', () =>
    updatePrefs({ bibHeading: (byId('bib-heading-input') as HTMLInputElement).checked }, '参考文献表标题行设置已更新。'),
  );
  byId('superscript-input').addEventListener('change', () =>
    updatePrefs({ superscript: (byId('superscript-input') as HTMLInputElement).checked }, '上标设置已更新。'),
  );
  byId('links-input').addEventListener('change', () =>
    updatePrefs({ links: (byId('links-input') as HTMLInputElement).checked }, '跳转链接设置已更新。'),
  );

  const unlinkButton = byId('unlink-button');
  const unlinkConfirm = byId('unlink-confirm-button');
  unlinkButton.addEventListener('click', () => {
    show(unlinkConfirm, true);
    setTimeout(() => show(unlinkConfirm, false), 6000);
  });
  unlinkConfirm.addEventListener('click', () => {
    show(unlinkConfirm, false);
    const strip = (byId('strip-links-input') as HTMLInputElement).checked;
    void perform('取消链接', async () => {
      const removed = await ops.unlink(strip);
      state.lastRefresh = null;
      renderCitationList();
      log(`已取消链接 ${removed} 个控件：文本保留${strip ? '' : '，跳转链接保留'}，此后不再自动刷新。`);
    });
  });

  byId('copy-diagnostics-button').addEventListener('click', () => {
    const text = byId('diagnostics').textContent || '';
    const area = h('textarea') as HTMLTextAreaElement;
    area.value = text;
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
      log('诊断信息已复制。');
    } catch {
      log('复制失败，请手动选中诊断文本。');
    }
    document.body.removeChild(area);
  });

  queue.onChange((label) => {
    const bar = byId('busy-bar');
    bar.textContent = label ? `${label}中…` : '';
    show(bar, Boolean(label));
  });

  client.onChange(() => {
    renderConnection();
    renderDiagnostics();
    if (client.state() === 'online') {
      if ((byId('search-input') as HTMLInputElement).value.trim() || state.results.length === 0) void searchPapers();
      if (state.lastRefresh && state.lastRefresh.missingSnapshots.length > 0) void updateItemsFromLibrary(true);
      void writeBackCited();
    }
  });

  const probeNow = () => {
    if (client.state() !== 'online') void client.probe();
  };
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) probeNow();
  });
  window.addEventListener('focus', probeNow);
}

function runLaunchAction(): void {
  const match = /[?&]action=([a-z]+)/.exec(window.location.search);
  const action = match ? match[1] : '';
  if (action === 'cite') openQuickCite();
  else if (action === 'bib') void insertBibliography();
  else if (action === 'refresh') void refresh('ask');
  else if (action === 'prefs') byId('style-select').focus();
}

function registerServiceWorker(): void {
  // 离线壳：PaperQuay 没开时 Word 仍能打开面板（渐进增强；IE11/EdgeHTML 下不可用则跳过）。
  try {
    if ('serviceWorker' in navigator && window.location.protocol === 'https:') {
      void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
    }
  } catch {
    // 忽略：离线壳只是增强。
  }
}

function start(): void {
  bindEvents();
  renderConnection();
  Office.onReady(() => {
    adapter = createOfficeAdapter();
    ops = createOperations(adapter);
    renderDiagnostics();
    void perform('读取文档', async () => {
      await ops.loadModel();
      renderPrefs();
      const result = await ops.refresh({ manualEdits: 'ask' });
      afterRefresh(result);
    }).then(() => {
      client.start();
      runLaunchAction();
    });
    try {
      Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, () => syncEditorWithSelection());
    } catch {
      // 老宿主不支持选区事件：面板里的「编辑」按钮仍可用。
    }
    registerServiceWorker();
  });
}

start();
