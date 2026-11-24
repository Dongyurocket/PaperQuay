import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

import {
  deriveRetainPdfUiState,
  mapRetainPdfError,
  retainPdfJobPercent,
} from '../src/features/literature/retainPdfUiState.ts';
import type {
  RetainPdfJob,
  RetainPdfStatus,
  RetainPdfTranslationEvent,
} from '../src/services/retainPdf.ts';

/**
 * A6：RetainPDF 状态/取消/重试接入文献详情。
 *
 * 纯状态映射直接导入源码；组件用 esbuild 打包真实面板，只替换
 * 状态服务、事件桥与图标，覆盖失败重试、运行中取消、未安装不可用。
 */

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
for (const name of [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement',
  'Event', 'CustomEvent', 'MouseEvent', 'localStorage', 'getComputedStyle',
]) {
  Object.defineProperty(globalThis, name, {
    value: (dom.window as unknown as Record<string, unknown>)[name],
    configurable: true,
    writable: true,
  });
}
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const require = createRequire(import.meta.url);
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');

const RETAINPDF_EVENT = 'paperquay://retainpdf-translation';

function job(overrides: Partial<RetainPdfJob> = {}): RetainPdfJob {
  return {
    paperId: 'paper-1',
    paperTitle: 'Paper One',
    jobId: 'job-1',
    status: 'running',
    stage: '',
    stageDetail: '',
    progress: null,
    error: '',
    createdAt: 1,
    updatedAt: 2,
    attachmentId: '',
    pageCountMismatch: null,
    ...overrides,
  };
}

function availableStatus(overrides: Partial<RetainPdfStatus> = {}): RetainPdfStatus {
  return {
    installed: true,
    running: true,
    apiBase: 'http://127.0.0.1:41000',
    executablePath: 'C:/Program Files/RetainPDF/RetainPDF.exe',
    config: {
      provider: 'paddle',
      model: 'deepseek-flash',
      baseUrl: 'https://api.deepseek.com/v1',
      ready: true,
      missing: [],
      configPath: 'C:/Users/test/AppData/Roaming/retain-pdf-desktop/desktop-config.json',
    },
    jobs: [],
    ...overrides,
  };
}

// ── 纯状态映射 ────────────────────────────────────────────────

test('可用且无任务时为 idle，允许开始', () => {
  const state = deriveRetainPdfUiState({
    status: availableStatus(),
    job: null,
    hasPdf: true,
  });

  assert.equal(state.phase, 'idle');
  assert.equal(state.canStart, true);
  assert.equal(state.canCancel, false);
  assert.equal(state.canRetry, false);
  assert.equal(state.percent, null);
});

test('未安装且服务未运行时为 unavailable/notInstalled，禁止开始', () => {
  const state = deriveRetainPdfUiState({
    status: availableStatus({ installed: false, running: false, config: null }),
    job: null,
    hasPdf: true,
  });

  assert.equal(state.phase, 'unavailable');
  assert.equal(state.unavailableReason, 'notInstalled');
  assert.equal(state.canStart, false);
});

test('缺少桌面配置或配置不完整时给出不可用原因', () => {
  const missingConfig = deriveRetainPdfUiState({
    status: availableStatus({ config: null }),
    job: null,
    hasPdf: true,
  });
  assert.equal(missingConfig.phase, 'unavailable');
  assert.equal(missingConfig.unavailableReason, 'configMissing');

  const incomplete = deriveRetainPdfUiState({
    status: availableStatus({
      config: {
        provider: 'mineru',
        model: 'deepseek-flash',
        baseUrl: '',
        ready: false,
        missing: ['MinerU Token', '模型 API Key'],
        configPath: 'C:/config.json',
      },
    }),
    job: null,
    hasPdf: true,
  });
  assert.equal(incomplete.phase, 'unavailable');
  assert.equal(incomplete.unavailableReason, 'configIncomplete');
  assert.deepEqual(incomplete.missingConfig, ['MinerU Token', '模型 API Key']);
  assert.equal(incomplete.canStart, false);
});

test('没有原始 PDF 时不可用', () => {
  const state = deriveRetainPdfUiState({
    status: availableStatus(),
    job: null,
    hasPdf: false,
  });

  assert.equal(state.phase, 'unavailable');
  assert.equal(state.unavailableReason, 'missingPdf');
  assert.equal(state.canStart, false);
});

test('运行中任务映射 stage 与进度，允许取消不允许重试', () => {
  const state = deriveRetainPdfUiState({
    status: availableStatus(),
    job: job({ status: 'uploading', progress: { current: 2, total: 10, percent: null } }),
    hasPdf: true,
  });

  assert.equal(state.phase, 'running');
  assert.equal(state.runningStage, 'uploading');
  assert.equal(state.percent, 20);
  assert.equal(state.canCancel, true);
  assert.equal(state.canStart, false);
  assert.equal(state.canRetry, false);
});

test('进度优先使用 percent 并夹在 0-100', () => {
  assert.equal(retainPdfJobPercent(job({ progress: { current: 1, total: 3, percent: 33.6 } })), 34);
  assert.equal(retainPdfJobPercent(job({ progress: { current: 9, total: 3, percent: 300 } })), 100);
  assert.equal(retainPdfJobPercent(job({ progress: null })), null);
});

test('失败任务带映射后的错误种类，可重试', () => {
  const state = deriveRetainPdfUiState({
    status: availableStatus(),
    job: job({ status: 'failed', error: 'RetainPDF 配置不完整：模型 API Key。请先在 RetainPDF 设置中完成配置' }),
    hasPdf: true,
  });

  assert.equal(state.phase, 'failed');
  assert.equal(state.errorKind, 'configIncomplete');
  assert.equal(state.canStart, true);
  assert.equal(state.canRetry, true);
});

test('已取消任务允许重新开始', () => {
  const state = deriveRetainPdfUiState({
    status: availableStatus(),
    job: job({ status: 'canceled', stageDetail: '已取消' }),
    hasPdf: true,
  });

  assert.equal(state.phase, 'canceled');
  assert.equal(state.canStart, true);
  assert.equal(state.canRetry, true);
});

test('已附加任务为 ready，并保留页数不一致提示', () => {
  const state = deriveRetainPdfUiState({
    status: availableStatus(),
    job: job({ status: 'attached', pageCountMismatch: { original: 10, translated: 12 } }),
    hasPdf: true,
  });

  assert.equal(state.phase, 'ready');
  assert.deepEqual(state.pageCountMismatch, { original: 10, translated: 12 });
  assert.equal(state.canStart, false);
  assert.equal(state.canCancel, false);
});

test('读取状态失败且无任务时不可用，有失败任务时仍显示失败', () => {
  const unknown = deriveRetainPdfUiState({
    status: null,
    job: null,
    hasPdf: true,
    statusFailed: true,
  });
  assert.equal(unknown.phase, 'unavailable');
  assert.equal(unknown.unavailableReason, 'statusUnknown');

  const failed = deriveRetainPdfUiState({
    status: null,
    job: job({ status: 'failed', error: 'RetainPDF 翻译任务等待超时' }),
    hasPdf: true,
    statusFailed: true,
  });
  assert.equal(failed.phase, 'failed');
  assert.equal(failed.errorKind, 'timeout');
});

test('后端错误只映射为固定种类，不依赖原文展示', () => {
  assert.equal(mapRetainPdfError('未找到本机安装的 RetainPDF，请先安装或设置 RETAINPDF_EXE'), 'notInstalled');
  assert.equal(mapRetainPdfError('这篇文献没有可翻译的原始 PDF'), 'missingPdf');
  assert.equal(mapRetainPdfError('文献不存在或已被删除'), 'paperMissing');
  assert.equal(mapRetainPdfError('该文献已有 RetainPDF 翻译任务在进行'), 'busy');
  assert.equal(mapRetainPdfError('RetainPDF 翻译任务等待超时'), 'timeout');
  assert.equal(mapRetainPdfError('该 RetainPDF 任务已经结束'), 'canceled');
  assert.equal(mapRetainPdfError('RetainPDF HTTP 500: at handler (secret)'), 'unknown');
  assert.equal(mapRetainPdfError(null), 'unknown');
});

// ── 组件 ──────────────────────────────────────────────────────

const MOCKS: Record<string, string> = {
  retainPdf: `
    export const RETAINPDF_TRANSLATION_EVENT = '${RETAINPDF_EVENT}';
    export const getRetainPdfStatus = () => globalThis.__retainPdfUiTest.getStatus();
    export const getRetainPdfTranslation = (paperId) => globalThis.__retainPdfUiTest.getTranslation(paperId);
    export const startRetainPdfTranslationOnce = (paperId) => globalThis.__retainPdfUiTest.start(paperId);
    export const cancelRetainPdfTranslation = (paperId) => globalThis.__retainPdfUiTest.cancel(paperId);
  `,
  event: `
    export async function listen(eventName, handler) {
      globalThis.__retainPdfUiTest.listeners.add(handler);
      return () => globalThis.__retainPdfUiTest.listeners.delete(handler);
    }
  `,
  uiLanguage: `
    export const useLocaleText = () => (zh, en) => ((globalThis.__retainPdfUiLocale ?? 'zh-CN') === 'en-US' ? en : zh);
    export const useAppLocale = () => globalThis.__retainPdfUiLocale ?? 'zh-CN';
  `,
  'lucide-react': `
    export const Languages = () => null;
    export const Loader2 = () => null;
    export const RefreshCw = () => null;
    export const TriangleAlert = () => null;
  `,
};

const panelBundle = await build({
  entryPoints: ['src/features/literature/components/RetainPdfTranslationPanel.tsx'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/*'],
  write: false,
  logLevel: 'silent',
  plugins: [{
    name: 'retainpdf-ui-mocks',
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => {
        const name = args.path.replace(/\.(?:tsx?|jsx?)$/, '').split('/').at(-1)!;
        return MOCKS[name] ? { path: name, namespace: 'retainpdf-mock' } : undefined;
      });
      builder.onLoad({ filter: /.*/, namespace: 'retainpdf-mock' }, (args) => ({
        contents: MOCKS[args.path],
        loader: 'js',
      }));
    },
  }],
});

const panelModule = { exports: {} as Record<string, unknown> };
new Function('require', 'module', 'exports', panelBundle.outputFiles![0].text)(
  require,
  panelModule,
  panelModule.exports,
);
const RetainPdfTranslationPanel = panelModule.exports.default as React.ComponentType<{
  paperId: string;
  hasPdf: boolean;
  onChanged?: () => void;
}>;

interface PanelHarness {
  container: HTMLElement;
  root: ReturnType<typeof createRoot>;
  startCalls: string[];
  cancelCalls: string[];
  listeners: Set<(event: { event: string; payload: RetainPdfTranslationEvent }) => void>;
  statusCalls: number;
  translationCalls: number;
  onChangedCalls: number;
  setStartResult: (next: RetainPdfJob) => void;
  setCancelResult: (next: RetainPdfJob) => void;
  resolveTranslation: (next: RetainPdfJob | null) => Promise<void>;
  text: () => string;
  hasButton: (label: string) => boolean;
  click: (label: string) => Promise<void>;
  emit: (payload: RetainPdfTranslationEvent) => Promise<void>;
  unmount: () => Promise<void>;
}

async function waitFor(condition: () => boolean, label: string, timeoutMs = 3000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) assert.fail(`Timed out waiting for ${label}`);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
}

async function mountPanel(options: {
  statusValue?: RetainPdfStatus | null;
  jobValue?: RetainPdfJob | null;
  statusError?: string;
  translationError?: string;
  hasPdf?: boolean;
  locale?: 'zh-CN' | 'en-US';
  deferredTranslation?: boolean;
} = {}): Promise<PanelHarness> {
  const startCalls: string[] = [];
  const cancelCalls: string[] = [];
  const listeners = new Set<any>();
  let statusCalls = 0;
  let translationCalls = 0;
  let onChangedCalls = 0;
  let startResult = job({ status: 'starting', stageDetail: '正在启动 RetainPDF' });
  let cancelResult = job({ status: 'canceled' });
  let resolveDeferred: ((value: RetainPdfJob | null) => void) | null = null;
  const deferredTranslation = options.deferredTranslation
    ? new Promise<RetainPdfJob | null>((resolve) => { resolveDeferred = resolve; })
    : null;

  (globalThis as any).__retainPdfUiLocale = options.locale ?? 'zh-CN';
  (globalThis as any).__retainPdfUiTest = {
    listeners,
    getStatus: async () => {
      statusCalls += 1;
      if (options.statusError) throw new Error(options.statusError);
      return options.statusValue === undefined ? availableStatus() : options.statusValue;
    },
    getTranslation: async () => {
      translationCalls += 1;
      if (options.translationError) throw new Error(options.translationError);
      if (deferredTranslation) return deferredTranslation;
      return options.jobValue ?? null;
    },
    start: async (paperId: string) => {
      startCalls.push(paperId);
      return startResult;
    },
    cancel: async (paperId: string) => {
      cancelCalls.push(paperId);
      return cancelResult;
    },
  };

  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(React.createElement(RetainPdfTranslationPanel, {
      paperId: 'paper-1',
      hasPdf: options.hasPdf ?? true,
      onChanged: () => { onChangedCalls += 1; },
    }));
  });

  const text = () => container.textContent ?? '';
  const harness: PanelHarness = {
    container,
    root,
    startCalls,
    cancelCalls,
    listeners,
    get statusCalls() { return statusCalls; },
    get translationCalls() { return translationCalls; },
    get onChangedCalls() { return onChangedCalls; },
    setStartResult(next) { startResult = next; },
    setCancelResult(next) { cancelResult = next; },
    async resolveTranslation(next) {
      await act(async () => {
        resolveDeferred?.(next);
        await Promise.resolve();
      });
    },
    text,
    hasButton(label) {
      return Array.from(container.querySelectorAll('button'))
        .some((button) => (button.textContent ?? '').includes(label));
    },
    async click(label) {
      const button = Array.from(container.querySelectorAll('button'))
        .find((item) => (item.textContent ?? '').includes(label));
      assert.ok(button, `按钮「${label}」应存在，当前文本：${text()}`);
      await act(async () => {
        button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
        await Promise.resolve();
      });
    },
    async emit(payload) {
      await act(async () => {
        for (const listener of [...listeners]) listener({ event: RETAINPDF_EVENT, payload });
        await Promise.resolve();
      });
    },
    async unmount() {
      await act(async () => { root.unmount(); });
      container.remove();
      delete (globalThis as any).__retainPdfUiTest;
    },
  };

  if (options.deferredTranslation) {
    await waitFor(() => listeners.size > 0, 'panel event listener');
  } else {
    await waitFor(
      () => listeners.size > 0
        && !text().includes('正在读取')
        && !text().includes('Reading RetainPDF'),
      'panel initial load',
    );
  }

  return harness;
}

test('未安装 RetainPDF 时显示不可用原因，不出现开始按钮', async () => {
  const harness = await mountPanel({
    statusValue: availableStatus({ installed: false, running: false, config: null }),
  });
  try {
    await waitFor(() => harness.text().includes('未检测到本机的 RetainPDF'), 'not installed reason');
    assert.equal(harness.hasButton('开始翻译'), false);
    assert.equal(harness.hasButton('重试'), false);
    assert.equal(harness.hasButton('取消翻译'), false);
  } finally {
    await harness.unmount();
  }
});

test('未翻译时显示开始按钮，点击后进入进行中', async () => {
  const harness = await mountPanel();
  try {
    await waitFor(() => harness.hasButton('开始翻译'), 'idle start button');
    await harness.click('开始翻译');
    await waitFor(() => harness.text().includes('正在启动 RetainPDF'), 'running after start');
    assert.deepEqual(harness.startCalls, ['paper-1']);
    assert.equal(harness.hasButton('取消翻译'), true);
  } finally {
    await harness.unmount();
  }
});

test('失败时只显示映射后的错误，重试调用 start 并回到进行中', async () => {
  const rawError = 'RetainPDF HTTP 500: at handler (secret stack trace)';
  const harness = await mountPanel({
    jobValue: job({ status: 'failed', error: rawError }),
  });
  try {
    await waitFor(() => harness.text().includes('上次翻译失败'), 'failed state');
    assert.equal(harness.text().includes('HTTP 500'), false, '不回显后端原文');
    assert.equal(harness.text().includes('secret stack trace'), false, '不回显堆栈');
    assert.equal(harness.text().includes('操作失败，请稍后重试'), true, '显示映射后的通用错误');

    harness.setStartResult(job({ status: 'starting', stageDetail: '正在启动 RetainPDF' }));
    await harness.click('重试');
    await waitFor(() => harness.text().includes('正在启动 RetainPDF'), 'running after retry');
    assert.deepEqual(harness.startCalls, ['paper-1']);
    assert.equal(harness.hasButton('取消翻译'), true);
    assert.equal(harness.hasButton('重试'), false, '运行中不显示重试');
  } finally {
    await harness.unmount();
  }
});

test('运行中可取消，cancel 事件后显示已取消并可重新开始', async () => {
  const harness = await mountPanel({
    jobValue: job({ status: 'running', stage: 'translation', progress: { current: 3, total: 10, percent: 30 } }),
  });
  try {
    await waitFor(() => harness.text().includes('正在翻译'), 'running state');
    assert.equal(harness.text().includes('30%'), true);

    harness.setCancelResult(job({ status: 'running' }));
    await harness.click('取消翻译');
    assert.deepEqual(harness.cancelCalls, ['paper-1']);

    await harness.emit({ phase: 'canceled', job: job({ status: 'canceled' }) });
    await waitFor(() => harness.text().includes('翻译已取消'), 'canceled state');
    assert.equal(harness.hasButton('重新开始'), true);
    assert.equal(harness.hasButton('取消翻译'), false);
  } finally {
    await harness.unmount();
  }
});

test('翻译事件增量刷新进度，不重复拉取状态', async () => {
  const harness = await mountPanel({ jobValue: job({ status: 'starting' }) });
  try {
    await waitFor(() => harness.text().includes('正在启动 RetainPDF'), 'starting state');
    assert.equal(harness.statusCalls, 1);
    assert.equal(harness.translationCalls, 1);

    await harness.emit({
      phase: 'progress',
      job: job({ status: 'running', stage: 'translation', progress: { current: 5, total: 10, percent: 50 } }),
    });
    await waitFor(() => harness.text().includes('50%'), 'progress update');
    assert.equal(harness.text().includes('正在翻译'), true);
    assert.equal(harness.statusCalls, 1, '进度事件不应再拉取状态');
    assert.equal(harness.translationCalls, 1, '进度事件不应再拉取任务');
  } finally {
    await harness.unmount();
  }
});

test('附加完成事件显示页数不一致提示并通知刷新', async () => {
  const harness = await mountPanel({ jobValue: job({ status: 'running' }) });
  try {
    await waitFor(() => harness.text().includes('正在翻译'), 'running state');
    await harness.emit({
      phase: 'attached',
      job: job({ status: 'attached', pageCountMismatch: { original: 10, translated: 12 } }),
      pageCountMismatch: { original: 10, translated: 12 },
    });
    await waitFor(() => harness.text().includes('译版 PDF 已附加'), 'attached state');
    assert.equal(harness.text().includes('原文 10 页'), true);
    assert.equal(harness.text().includes('译版 12 页'), true);
    assert.equal(harness.onChangedCalls, 1);
  } finally {
    await harness.unmount();
  }
});

test('加载中的旧快照不会覆盖已到达的 attached 事件', async () => {
  const harness = await mountPanel({ deferredTranslation: true });
  try {
    await harness.emit({
      phase: 'attached',
      job: job({ status: 'attached', attachmentId: 'att-1' }),
    });
    await harness.resolveTranslation(job({
      status: 'running',
      stage: 'translation',
      progress: { current: 1, total: 10, percent: 10 },
    }));
    await waitFor(() => harness.text().includes('译版 PDF 已附加'), 'attached survives stale snapshot');
    assert.equal(harness.text().includes('正在翻译'), false, '旧 running 快照不得覆盖 attached');
    assert.equal(harness.hasButton('开始翻译'), false);
  } finally {
    await harness.unmount();
  }
});

test('单篇任务查询失败时回落到状态接口的 jobs 列表', async () => {
  const harness = await mountPanel({
    translationError: 'bridge unavailable',
    statusValue: availableStatus({
      jobs: [job({ status: 'running', progress: { current: 1, total: 2, percent: 50 } })],
    }),
  });
  try {
    await waitFor(() => harness.text().includes('正在翻译'), 'running from status jobs');
    assert.equal(harness.text().includes('50%'), true);
  } finally {
    await harness.unmount();
  }
});

test('英文界面使用英文文案', async () => {
  const harness = await mountPanel({
    locale: 'en-US',
    statusValue: availableStatus({ installed: false, running: false, config: null }),
  });
  try {
    await waitFor(() => harness.text().includes('RetainPDF was not found on this computer'), 'english reason');
    assert.equal(harness.text().includes('未检测到'), false);
    assert.equal(harness.hasButton('Start translation'), false);
  } finally {
    await harness.unmount();
  }
});

// ── 启动去重（与 useMetadataJobs 共用同一启动函数） ─────────────

const serviceBundle = await build({
  entryPoints: ['src/services/retainPdf.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  logLevel: 'silent',
  plugins: [{
    name: 'retainpdf-service-mocks',
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => {
        const name = args.path.replace(/\.(?:tsx?|jsx?)$/, '').split('/').at(-1)!;
        if (name === 'core') return { path: 'core', namespace: 'retainpdf-service-mock' };
        if (name === 'event') return { path: 'event', namespace: 'retainpdf-service-mock' };
        return undefined;
      });
      builder.onLoad({ filter: /.*/, namespace: 'retainpdf-service-mock' }, (args) => ({
        contents: args.path === 'core'
          ? 'export const invoke = (command, args) => globalThis.__retainPdfInvoke(command, args);'
          : 'export async function listen() { return () => {}; }',
        loader: 'js',
      }));
    },
  }],
});

const serviceModule = { exports: {} as Record<string, unknown> };
new Function('require', 'module', 'exports', serviceBundle.outputFiles![0].text)(
  require,
  serviceModule,
  serviceModule.exports,
);
const { startRetainPdfTranslationOnce } = serviceModule.exports as {
  startRetainPdfTranslationOnce: (paperId: string) => Promise<RetainPdfJob>;
};

test('同一文献并发启动只发一次 IPC，结束后允许再次启动', async () => {
  let invocations = 0;
  let release!: (value: RetainPdfJob) => void;
  const pending = new Promise<RetainPdfJob>((resolve) => { release = resolve; });
  (globalThis as any).__retainPdfInvoke = async (command: string) => {
    assert.equal(command, 'retainpdf_start_translation');
    invocations += 1;
    return invocations === 1 ? pending : job({ status: 'starting' });
  };

  try {
    const first = startRetainPdfTranslationOnce('paper-1');
    const second = startRetainPdfTranslationOnce('paper-1');
    assert.equal(first, second, '并发启动复用同一个 Promise');
    assert.equal(invocations, 1);

    release(job({ status: 'starting' }));
    await first;
    await second;

    await startRetainPdfTranslationOnce('paper-1');
    assert.equal(invocations, 2, '任务结束后允许再次启动');
  } finally {
    delete (globalThis as any).__retainPdfInvoke;
  }
});

test('已移除译版附件时 attached 记录回到可重新开始', () => {
  const attached = job({ status: 'attached', attachmentId: 'att-1' });
  const matching = deriveRetainPdfUiState({
    status: availableStatus(),
    job: attached,
    hasPdf: true,
    translatedAttachmentId: 'att-1',
  });
  assert.equal(matching.phase, 'ready');

  const removed = deriveRetainPdfUiState({
    status: availableStatus(),
    job: attached,
    hasPdf: true,
    translatedAttachmentId: null,
  });
  assert.equal(removed.phase, 'idle');
  assert.equal(removed.canStart, true);

  const replaced = deriveRetainPdfUiState({
    status: availableStatus(),
    job: attached,
    hasPdf: true,
    translatedAttachmentId: 'att-2',
  });
  assert.equal(replaced.phase, 'idle');
});


test('详情面板以 key 重挂载并传入译版附件 id，刷新依赖 TaskCenter 事件', () => {
  const details = readFileSync(
    path.resolve('src/features/literature/components/LiteraturePaperDetails.tsx'),
    'utf8',
  );
  assert.match(details, /<RetainPdfTranslationPanel[\s\S]*?key=\{paper\.id\}/);
  assert.match(details, /translatedAttachmentId=\{translatedPdf\?\.attachment\.id \?\? null\}/);
  // 不传 onChanged：附加事件已由 TaskCenter 的 native-paper-updated 统一刷新，
  // 再传 onChanged 会让一次附加触发两次文库刷新。
  assert.equal(/onChanged=\{onLibraryChanged\}/.test(details), false);

  const service = readFileSync(path.resolve('src/services/retainPdf.ts'), 'utf8');
  assert.match(service, /emitNativePaperUpdated\(payload\.paper\)/);
  const taskCenter = readFileSync(path.resolve('src/ui/taskCenter.tsx'), 'utf8');
  assert.match(taskCenter, /bindRetainPdfBackgroundTasks\(\)/);
});

test('切换文献后迟到的旧任务结果不会覆盖新文献状态', async () => {
  const listeners = new Set<any>();
  const translationCalls: string[] = [];
  let resolvePaperOne: ((value: RetainPdfJob) => void) | null = null;
  (globalThis as any).__retainPdfUiLocale = 'zh-CN';
  (globalThis as any).__retainPdfUiTest = {
    listeners,
    getStatus: async () => availableStatus(),
    getTranslation: async (paperId: string) => {
      translationCalls.push(paperId);
      if (paperId === 'paper-1') {
        return new Promise<RetainPdfJob>((resolve) => { resolvePaperOne = resolve; });
      }
      return job({
        paperId,
        progress: { current: 7, total: 10, percent: 70 },
      });
    },
    start: async (paperId: string) => job({ paperId, status: 'starting' }),
    cancel: async (paperId: string) => job({ paperId, status: 'canceled' }),
  };

  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const Wrapper = ({ paperId }: { paperId: string }) => React.createElement(RetainPdfTranslationPanel, {
    key: paperId,
    paperId,
    hasPdf: true,
  });

  try {
    await act(async () => {
      root.render(React.createElement(Wrapper, { paperId: 'paper-1' }));
    });
    // 旧文献的查询尚未返回时切换文献：父级 key 触发重挂载。
    await act(async () => {
      root.render(React.createElement(Wrapper, { paperId: 'paper-2' }));
    });
    await waitFor(() => (container.textContent ?? '').includes('70%'), 'paper-2 progress');

    await act(async () => {
      resolvePaperOne?.(job({
        paperId: 'paper-1',
        progress: { current: 1, total: 10, percent: 10 },
      }));
      await Promise.resolve();
    });

    assert.equal((container.textContent ?? '').includes('10%'), false, '旧文献迟到结果不能覆盖新文献');
    assert.deepEqual(translationCalls, ['paper-1', 'paper-2']);
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
    delete (globalThis as any).__retainPdfUiTest;
  }
});
