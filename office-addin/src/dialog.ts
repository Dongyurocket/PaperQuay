/**
 * 快速引用对话框（Zotero「红条」式）：输入即搜 → ↑↓ 选择 → Enter 加入 → 再按 Enter（或 Ctrl+Enter）插入。
 *
 * 对话框只做选择，不碰文档：选好后经 messageParent 把文献与页码交回任务窗格，由任务窗格
 * （唯一的写文档运行时）排队插入，避免两个运行时同时写文档。
 */
import './polyfills.ts';
import { createBridgeClient, type WirePaper } from './bridge/client.ts';
import { byId, clear, debounce, h, paperMetaLine } from './ui/dom.ts';

const client = createBridgeClient();
const state = { results: [] as WirePaper[], active: 0, chosen: [] as WirePaper[] };

function renderChosen(): void {
  const container = byId('chosen');
  clear(container);
  state.chosen.forEach((paper, index) => {
    const remove = h('button', { className: 'link-button', text: '×', attrs: { type: 'button', title: '移除' } });
    remove.addEventListener('click', () => {
      state.chosen.splice(index, 1);
      renderChosen();
    });
    container.appendChild(h('span', { className: 'chip' }, [h('span', { text: paper.title || paper.id }), remove]));
  });
  byId('hint').textContent =
    state.chosen.length > 0 ? `已选 ${state.chosen.length} 篇 · 再按 Enter 插入，Esc 取消` : '输入关键词检索 · ↑↓ 选择 · Enter 加入';
}

function renderResults(): void {
  const container = byId('results');
  clear(container);
  state.results.forEach((paper, index) => {
    const row = h('div', { className: 'result' + (index === state.active ? ' result--active' : '') }, [
      h('div', { className: 'result__body' }, [
        h('div', { className: 'result__title', text: paper.title || '(无标题)' }),
        h('div', { className: 'result__meta', text: paperMetaLine(paper) }),
      ]),
    ]);
    row.addEventListener('click', () => choose(paper));
    container.appendChild(row);
  });
}

function choose(paper: WirePaper): void {
  if (!state.chosen.some((item) => item.id === paper.id)) state.chosen.push(paper);
  const input = byId('query') as HTMLInputElement;
  input.value = '';
  state.results = [];
  renderResults();
  renderChosen();
  input.focus();
}

function submit(): void {
  if (state.chosen.length === 0) return;
  const locator = (byId('locator') as HTMLInputElement).value.trim();
  Office.context.ui.messageParent(JSON.stringify({ papers: state.chosen, locator }));
}

let seq = 0;
const search = debounce(async () => {
  const query = (byId('query') as HTMLInputElement).value.trim();
  const current = (seq += 1);
  if (!query) {
    state.results = [];
    renderResults();
    return;
  }
  try {
    const result = await client.searchPapers(query, 20);
    if (current !== seq) return;
    state.results = result.papers;
    state.active = 0;
    renderResults();
  } catch {
    byId('hint').textContent = '无法连接 PaperQuay，请确认它正在运行。';
  }
}, 200);

function start(): void {
  const input = byId('query') as HTMLInputElement;
  input.addEventListener('input', () => search());
  input.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'Down') {
      state.active = Math.min(state.results.length - 1, state.active + 1);
      renderResults();
      event.preventDefault();
    } else if (event.key === 'ArrowUp' || event.key === 'Up') {
      state.active = Math.max(0, state.active - 1);
      renderResults();
      event.preventDefault();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (event.ctrlKey || (!input.value.trim() && state.chosen.length > 0)) submit();
      else if (state.results[state.active]) choose(state.results[state.active]);
    } else if (event.key === 'Backspace' && !input.value && state.chosen.length > 0) {
      state.chosen.pop();
      renderChosen();
    } else if (event.key === 'Escape' || event.key === 'Esc') {
      Office.context.ui.messageParent(JSON.stringify({ papers: [] }));
    }
  });
  byId('insert').addEventListener('click', submit);
  renderChosen();
  Office.onReady(() => input.focus());
}

start();
