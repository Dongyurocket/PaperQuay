import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import type { PdfSource } from '../src/types/reader.ts';

const require = createRequire(import.meta.url);
const React = require('react');
const dispatcher = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher;

type Hook = { value?: any; deps?: unknown[]; setter?: (value: any) => void;
  effect?: () => void | (() => void); cleanup?: void | (() => void); pending?: boolean };
type Element = { type?: any; props?: any; ref?: { current: any } };
const sameDeps = (before?: unknown[], after?: unknown[]) =>
  Boolean(before && after && before.length === after.length && before.every((value, index) => Object.is(value, after[index])));

class Host {
  nodeType = 1;
  style = { position: '', scrollBehavior: '' };
  offsetTop = 0;
  pages = new Map<number, Host>();
  overlay: Host | null = null;
  textContent = '';
  clientHeight = 800;
  clientWidth = 600;
  scrollHeight = 12_000;
  scrollWidth = 600;
  scrollTop = 0;
  scrollLeft = 0;
  addEventListener() {}
  removeEventListener() {}
  querySelector(selector: string): Host | null {
    if (selector === '.paperquay-page-overlay-host') return this.overlay;
    const match = selector.match(/^\.page\[data-page-number="(\d+)"\]$/);
    return match ? this.pages.get(Number(match[1])) ?? null : null;
  }
  querySelectorAll() { return []; }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  scrollTo({ top, left }: { top: number; left: number }) { this.scrollTop = top; this.scrollLeft = left; }
}

// Exercise the component's hooks and passive-effect cleanup without a browser or
// PDF renderer. Child UI is left unrendered; its host refs still mount normally.
class Lifecycle {
  hooks: Hook[] = [];
  cursor = 0;
  dirty = false;
  mounted = true;
  props: any;
  tree: Element | null = null;
  hosts = new Map<object, Host>();
  component: (props: any) => Element;

  constructor(component: (props: any) => Element, props: any) {
    this.component = component;
    this.props = props;
  }

  slot() { return this.hooks[this.cursor++] ?? (this.hooks[this.cursor - 1] = {}); }

  useState = (initial: any) => {
    const hook = this.slot();
    if (!hook.setter) {
      hook.value = typeof initial === 'function' ? initial() : initial;
      hook.setter = (next) => {
        if (!this.mounted) return;
        const value = typeof next === 'function' ? next(hook.value) : next;
        if (!Object.is(value, hook.value)) { hook.value = value; this.dirty = true; }
      };
    }
    return [hook.value, hook.setter];
  };

  useRef = (initial: any) => {
    const hook = this.slot();
    return hook.value ?? (hook.value = { current: initial });
  };

  useMemo = (factory: () => any, deps?: unknown[]) => {
    const hook = this.slot();
    if (!sameDeps(hook.deps, deps)) { hook.value = factory(); hook.deps = deps; }
    return hook.value;
  };

  useCallback = (callback: (...args: any[]) => any, deps?: unknown[]) => this.useMemo(() => callback, deps);

  useEffect = (effect: () => void | (() => void), deps?: unknown[]) => {
    const hook = this.slot();
    if (!sameDeps(hook.deps, deps)) { hook.effect = effect; hook.deps = deps; hook.pending = true; }
  };

  render(nextProps = this.props) {
    this.props = nextProps;
    this.cursor = 0;
    this.dirty = false;
    const previous = dispatcher.current;
    dispatcher.current = this;
    try { this.tree = this.component(this.props); }
    finally { dispatcher.current = previous; }
    return this.tree;
  }

  commit() {
    const mountedRefs = new Set<object>();
    visit(this.tree, (element) => {
      if (!element.ref || typeof element.ref !== 'object') return;
      mountedRefs.add(element.ref);
      const host = this.hosts.get(element.ref) ?? new Host();
      this.hosts.set(element.ref, host);
      element.ref.current = host;
    });
    for (const ref of this.hosts.keys()) if (!mountedRefs.has(ref)) (ref as any).current = null;
    const pending = this.hooks.filter((hook) => hook.pending);
    for (const hook of pending) { hook.cleanup?.(); hook.pending = false; }
    for (const hook of pending) hook.cleanup = hook.effect?.();
  }

  flush() {
    for (let pass = 0; pass < 30; pass++) {
      this.render(); this.commit();
      if (!this.dirty) return;
    }
    assert.fail('The component did not settle after 30 synchronous renders');
  }

  async settle() {
    // Drain the dynamic viewer import and the controlled PDF promise, then
    // commit any state updates. No elapsed-time assumption is needed.
    for (let pass = 0; pass < 5; pass++) { await Promise.resolve(); this.flush(); }
  }

  unmount() {
    this.mounted = false;
    for (const hook of this.hooks) hook.cleanup?.();
  }

  get pageCount() {
    let count: number | undefined;
    visit(this.tree, (element) => {
      if (element.type?.name === 'PdfViewerToolbar') count = element.props.pageCount;
    });
    assert.notEqual(count, undefined, 'The actual viewer toolbar should be mounted');
    return count;
  }
}

function visit(value: any, callback: (element: Element) => void) {
  if (Array.isArray(value)) { for (const child of value) visit(child, callback); return; }
  if (!value || typeof value !== 'object' || !value.props) return;
  callback(value);
  visit(value.props.children, callback);
}

type LoadingTask = { init: any; promise: Promise<any>; resolve: (value: any) => void;
  reject: (error: Error) => void;
  destroyed: boolean; destroy: () => void };

const bundlePromise = build({
  entryPoints: ['src/features/pdf/PdfViewer.tsx'], bundle: true, platform: 'node', format: 'cjs',
  jsx: 'automatic', write: false, logLevel: 'silent', loader: { '.css': 'empty' },
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  define: { 'import.meta.url': JSON.stringify(import.meta.url) },
  plugins: [{ name: 'controlled-pdf-lifecycle', setup(builder) {
    const fixtures: Record<string, string> = {
      'pdfjs-dist': `export const getDocument = __pdf.getDocument;
        export const GlobalWorkerOptions = {};
        export const AnnotationMode = {ENABLE_FORMS: 1};
        export const AnnotationEditorType = {NONE: 0, FREETEXT: 3, HIGHLIGHT: 9, INK: 15};
        export const AnnotationEditorParamsType = {};`,
      'pdfjs-dist/web/pdf_viewer.mjs': `export const EventBus = __pdf.EventBus;
        export const PDFLinkService = __pdf.PDFLinkService;
        export const PDFViewer = __pdf.PDFViewer;`,
      'lucide-react': `export function FilePlus2() {} export function Images() {} export function ListTree() {}`,
      uiLanguage: `export const useLocaleText = () => __locale;`,
      useWheelScrollDelegate: `export const useWheelScrollDelegate = () => undefined;`,
      pdfReadingHeatmap: `export const usePdfReadingHeatmap = () => ({heatmap: null, maxBinMs: 0});
        export const getPdfReadingProgressRatio = () => 0;`,
      desktop: `export function approveWritePath() {} export function selectSavePdfPath() {} export function writeLocalBinaryFile() {}`,
      mineru: `export const extractTranslatableMarkdownFromMineruBlock = () => '';
        export const extractTextFromMineruBlock = () => '';
        export const resolveMineruBlockContentSource = () => null;`,
      EmptyState: `export default function EmptyState() {}`,
      ContextMenu: `export function ContextMenu() {}`,
      PdfPageOverlay: `export function PdfPageOverlay() {}`,
      PdfReadingHeatmapBar: `export function PdfReadingHeatmapBar() {}`,
      PdfThumbnailSidebar: `export function PdfThumbnailSidebar() {}`,
      PdfOutlinePanel: `export function PdfOutlinePanel() {}`,
      PdfViewerToolbar: `export function PdfViewerToolbar() {}`,
    };
    builder.onResolve({ filter: /.*/ }, (args) => {
      const name = args.path.replace(/\.(?:tsx?|jsx?)$/, '').split('/').at(-1)!;
      const fixture = fixtures[args.path] ?? fixtures[name];
      return fixture ? { path: args.path in fixtures ? args.path : name, namespace: 'lifecycle-fixture' } : undefined;
    });
    builder.onLoad({ filter: /.*/, namespace: 'lifecycle-fixture' }, (args) => ({ contents: fixtures[args.path], loader: 'js' }));
  } }],
});

const readingStageBundlePromise = build({
  entryPoints: ['src/features/reader/ReaderWorkspace.tsx'], bundle: true, platform: 'node', format: 'cjs',
  jsx: 'automatic', write: false, logLevel: 'silent', loader: { '.css': 'empty' },
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  plugins: [{ name: 'reading-stage-fixtures', setup(builder) {
    const fixtures: Record<string, string> = {
      PdfViewer: 'export default function PdfViewer() {}',
      BlockViewer: 'export default function BlockViewer() {}',
      TranslatedPdfPane: 'export default function TranslatedPdfPane() {}',
      readerWorkspaceOverview: 'export function ReaderWorkspaceOverview() {}',
      readerWorkspaceHeader: 'export function ReaderWorkspaceHeader() {}',
      readerWorkspaceOverlays: 'export function FloatingAssistantPanel() {} export function SelectionQuickActions() {}',
      uiLanguage: 'export const useLocaleText = () => (zh) => zh;',
      'lucide-react': 'export function Minimize2() {}',
    };
    builder.onResolve({ filter: /.*/ }, (args) => {
      const name = args.path.replace(/\.(?:tsx?|jsx?)$/, '').split('/').at(-1)!;
      return fixtures[name] ? { path: name, namespace: 'reading-stage-fixture' } : undefined;
    });
    builder.onLoad({ filter: /.*/, namespace: 'reading-stage-fixture' }, (args) => ({ contents: fixtures[args.path], loader: 'js' }));
  } }],
});

const translatedPaneBundlePromise = build({
  entryPoints: ['src/features/reader/TranslatedPdfPane.tsx'], bundle: true, platform: 'node', format: 'cjs',
  jsx: 'automatic', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  plugins: [{ name: 'translated-pane-fixtures', setup(builder) {
    const fixtures: Record<string, string> = {
      PdfViewer: 'export default function PdfViewer() {}',
      uiLanguage: 'export const useLocaleText = () => (zh) => zh;',
      'lucide-react': 'export function BookCopy() {} export function FilePlus2() {} export function Link2() {} export function Unlink2() {}',
    };
    builder.onResolve({ filter: /.*/ }, (args) => {
      const name = args.path.replace(/\.(?:tsx?|jsx?)$/, '').split('/').at(-1)!;
      return fixtures[name] ? { path: name, namespace: 'translated-pane-fixture' } : undefined;
    });
    builder.onLoad({ filter: /.*/, namespace: 'translated-pane-fixture' }, (args) => ({ contents: fixtures[args.path], loader: 'js' }));
  } }],
});

async function createReadingStage() {
  const module = { exports: {} as any };
  const bundle = await readingStageBundlePromise;
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
  const props = {
    readingViewMode: 'pdf-compare', originalPdfPath: 'C:/fixture/original.pdf',
    pdfSource: { kind: 'local-path', path: 'C:/fixture/translated.pdf' }, pdfData: null,
    currentDocument: { workspaceId: 'fixture', itemKey: 'fixture', translatedPdfPath: 'C:/fixture/translated.pdf' },
    notes: [], annotations: [], blocks: [], layoutRef: { current: null }, leftPaneWidthRatio: 0.5,
    onPdfScrollPositionChange() {}, onPdfReadingHeatmapChange() {}, onTextSelect() {},
    onPdfBlockHover() {}, onPdfBlockSelect() {},
  };
  const stage = new Lifecycle(module.exports.ReadingStage, props);
  stage.flush();
  const leftProps = () => {
    let found: any;
    visit(stage.tree, (element) => { if (element.type?.name === 'PdfViewer') found = element.props; });
    assert.ok(found, 'ReadingStage should render the left PDF viewer');
    return found;
  };
  return { stage, leftProps };
}

async function createViewer(onPageCountChange: (count: number) => void, initialProps: any = {}) {
  const tasks: LoadingTask[] = [];
  const attached: number[] = [];
  const navigation: number[] = [];
  const buses: Array<{ dispatch: (name: string, event: any) => void }> = [];
  const __pdf = {
    getDocument(init: any) {
      let resolve!: (value: any) => void;
      let reject!: (error: Error) => void;
      const task: LoadingTask = { init, promise: new Promise((done, fail) => { resolve = done; reject = fail; }),
        resolve: (value) => resolve(value), reject: (error) => reject(error), destroyed: false, destroy() { this.destroyed = true; } };
      tasks.push(task);
      return task;
    },
    EventBus: class {
      listeners = new Map<string, (event: any) => void>();
      constructor() { buses.push(this); }
      on(name: string, callback: (event: any) => void) { this.listeners.set(name, callback); }
      off(name: string) { this.listeners.delete(name); }
      dispatch(name: string, event: any) { this.listeners.get(name)?.(event); }
    },
    PDFLinkService: class { setViewer() {} setDocument() {} },
    PDFViewer: class {
      pagesCount = 0;
      setDocument(document: any) { this.pagesCount = document?.numPages ?? 0; if (document) attached.push(document.numPages); }
      scrollPageIntoView({ pageNumber }: { pageNumber: number }) { navigation.push(pageNumber); }
      cleanup() {} update() {}
    },
  };
  const storage = { getItem: () => null, setItem() {} };
  let sequence = 0;
  const frames = new Map<number, () => void>();
  const window = { localStorage: storage, addEventListener() {}, removeEventListener() {}, getSelection: () => null,
    requestAnimationFrame(callback: () => void) { const id = ++sequence; frames.set(id, callback); return id; },
    cancelAnimationFrame(id: number) { frames.delete(id); }, setTimeout: () => ++sequence, clearTimeout() {} };
  const runFrames = () => {
    for (let pass = 0; pass < 20; pass++) {
      if (frames.size === 0) return;
      const callbacks = [...frames.values()]; frames.clear();
      for (const callback of callbacks) callback();
    }
    assert.fail('The viewer did not settle after 20 animation frames');
  };
  const document = { addEventListener() {}, removeEventListener() {}, elementsFromPoint: () => [] };
  class Observer { observe() {} unobserve() {} disconnect() {} }
  const module = { exports: {} as any };
  const bundle = await bundlePromise;
  new Function('require', 'module', 'exports', '__pdf', '__locale', 'window', 'localStorage', 'document',
    'ResizeObserver', 'MutationObserver', 'Node', 'Element', 'HTMLElement', bundle.outputFiles[0].text)(
    require, module, module.exports, __pdf, (zh: string) => zh, window, storage, document,
    Observer, Observer, Host, Host, Host,
  );
  const source: PdfSource = { kind: 'local-path', path: 'C:/fixture/paper-a.pdf' };
  const lifecycle = new Lifecycle(module.exports.default.type, { source, pdfData: null, blocks: [], annotations: [],
    activeBlockId: null, hoveredBlockId: null, activeHighlight: null, onBlockHover() {}, onPageCountChange, ...initialProps });
  lifecycle.flush();
  await lifecycle.settle();
  assert.equal(tasks.length, 1, 'The real load effect should create a PDF.js loading task');
  return { lifecycle, tasks, attached, navigation, runFrames, buses };
}

function pdfDocument(numPages: number) {
  return { numPages, cleanup() {}, destroyed: false, destroy() { this.destroyed = true; },
    getPage: async () => ({ getViewport: () => ({ width: 600, height: 800 }) }) };
}

function materializePages(lifecycle: Lifecycle, count: number) {
  for (const host of lifecycle.hosts.values()) {
    for (let number = 1; number <= count; number++) {
      const page = new Host(); page.overlay = new Host(); page.offsetTop = (number - 1) * 800;
      host.pages.set(number, page);
    }
  }
}

function childProps(lifecycle: Lifecycle, name: string) {
  let found: any;
  visit(lifecycle.tree, (element) => { if (element.type?.name === name) found = element.props; });
  assert.ok(found, `Expected ${name}`);
  return found;
}

// Connect the real stage, translated-pane hooks and both viewer load effects.
// PDF.js transport and DOM remain controlled; counts/errors travel through the
// production callbacks rather than being injected at the stage boundary.
async function createCompareComposition() {
  const { stage, leftProps } = await createReadingStage();
  const reports: any[] = [];
  stage.render({ ...stage.props, onPdfPageCountChange: (...args: any[]) => reports.push(args) });
  stage.commit(); stage.flush();
  const module = { exports: {} as any };
  const bundle = await translatedPaneBundlePromise;
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
  const pane = new Lifecycle(module.exports.default, childProps(stage, 'TranslatedPdfPane'));
  pane.flush();
  const left = await createViewer(() => {}, leftProps());
  const right = await createViewer(() => {}, childProps(pane, 'PdfViewer'));
  const settle = async () => {
    for (let pass = 0; pass < 4; pass++) {
      stage.flush();
      pane.render(childProps(stage, 'TranslatedPdfPane')); pane.commit(); pane.flush();
      left.lifecycle.render(leftProps()); left.lifecycle.commit(); await left.lifecycle.settle();
      right.lifecycle.render(childProps(pane, 'PdfViewer')); right.lifecycle.commit(); await right.lifecycle.settle();
    }
    pane.flush();
  };
  return { stage, pane, left, right, reports, settle,
    unmount() { left.lifecycle.unmount(); right.lifecycle.unmount(); pane.unmount(); stage.unmount(); } };
}

test('composed compare viewers retain 47/3 counts, original callback identity and independent failures', async (t) => {
  const comparison = await createCompareComposition();
  t.after(() => comparison.unmount());
  const { stage, pane, left, right, reports, settle } = comparison;
  left.tasks[0].resolve(pdfDocument(47));
  right.tasks[0].resolve(pdfDocument(3));
  await settle();
  left.buses[0].dispatch('pagerendered', {});
  right.buses[0].dispatch('pagerendered', {});
  await settle();
  assert.equal(left.lifecycle.pageCount, 47);
  assert.equal(right.lifecycle.pageCount, 3);
  assert.deepEqual(reports.at(-1), [47, { kind: 'local-path', path: 'C:/fixture/original.pdf' }, null]);
  let rightLabel = '';
  visit(pane.tree, (element) => { if (element.props.children === '第 1/3 页') rightLabel = element.props.children; });
  assert.equal(rightLabel, '第 1/3 页');
  for (let i = 0; i < 3; i++) {
    stage.render({ ...stage.props, leftPaneWidthRatio: 0.3 + i / 10,
      pdfSource: { kind: 'local-path', path: 'C:/fixture/translated.pdf' } });
    stage.commit(); await settle();
  }
  assert.equal(left.tasks.length, 1);
  assert.equal(right.tasks.length, 1);
  right.buses[0].dispatch('pagerendered', { error: new Error('translation render failed') });
  await settle();
  assert.equal(right.lifecycle.tree?.props['data-pdf-phase'], 'error');
  assert.equal(left.lifecycle.tree?.props['data-pdf-phase'], 'page-rendered');
  assert.equal(reports.at(-1)[0], 47);
});

test('composed 47/3 viewers apply distant sync targets, clamp once and avoid feedback', async (t) => {
  const comparison = await createCompareComposition();
  t.after(() => comparison.unmount());
  const { stage, pane, left, right, settle } = comparison;
  materializePages(left.lifecycle, 47); materializePages(right.lifecycle, 3);
  left.tasks[0].resolve(pdfDocument(47)); right.tasks[0].resolve(pdfDocument(3));
  await settle();
  left.buses[0].dispatch('pagesinit', {}); right.buses[0].dispatch('pagesinit', {});
  await settle();
  left.buses[0].dispatch('pagechanging', { pageNumber: 47 }); await settle();
  left.runFrames(); right.runFrames(); await settle();
  const rightSignal = childProps(stage, 'TranslatedPdfPane').pageSyncSignal;
  assert.equal(rightSignal.page, 47);
  assert.equal(childProps(right.lifecycle, 'PdfViewerToolbar').currentPage, 3);
  assert.equal(childProps(left.lifecycle, 'PdfViewerToolbar').currentPage, 47);
  assert.equal(childProps(stage, 'PdfViewer').pageSyncSignal, null, 'clamped page 3 must not bounce back');
  let rightLabel = false;
  visit(pane.tree, (element) => { if (element.props.children === '第 3/3 页') rightLabel = true; });
  assert.equal(rightLabel, true);
  right.buses[0].dispatch('pagechanging', { pageNumber: 2 }); await settle();
  left.runFrames(); right.runFrames(); await settle();
  assert.equal(childProps(left.lifecycle, 'PdfViewerToolbar').currentPage, 2);
  assert.equal(childProps(stage, 'TranslatedPdfPane').pageSyncSignal.token, rightSignal.token);
  assert.equal(left.tasks.length, 1); assert.equal(right.tasks.length, 1);
});

test('composed compare original failure and missing translation preserve correct pane ownership', async (t) => {
  const comparison = await createCompareComposition();
  t.after(() => comparison.unmount());
  const { stage, pane, left, right, reports, settle } = comparison;
  left.tasks[0].reject(new Error('original missing'));
  right.tasks[0].resolve(pdfDocument(3));
  await settle();
  right.buses[0].dispatch('pagerendered', {}); await settle();
  assert.equal(left.lifecycle.tree?.props['data-pdf-phase'], 'error');
  assert.equal(right.lifecycle.tree?.props['data-pdf-phase'], 'page-rendered');
  assert.equal(reports.at(-1)[0], 0);
  assert.equal(reports.at(-1)[1].path, 'C:/fixture/original.pdf');
  stage.render({ ...stage.props, currentDocument: { ...stage.props.currentDocument, translatedPdfPath: '' } });
  stage.commit(); stage.flush();
  pane.render(childProps(stage, 'TranslatedPdfPane')); pane.commit(); pane.flush();
  let message = false;
  let viewer = false;
  visit(pane.tree, (element) => {
    if (element.props.children === '尚未附加翻译版 PDF') message = true;
    if (element.type?.name === 'PdfViewer') viewer = true;
  });
  assert.equal(message, true);
  assert.equal(viewer, false);
  assert.equal(left.tasks.length, 1);
});

test('changing data identity cancels the old task and rejects its late document', async (t) => {
  const first = new Uint8Array([1, 2, 3]);
  const second = new Uint8Array([4, 5, 6]);
  const { lifecycle, tasks } = await createViewer(() => {}, { source: null, pdfData: first });
  t.after(() => lifecycle.unmount());
  lifecycle.render({ ...lifecycle.props, pdfData: second }); lifecycle.commit(); await lifecycle.settle();
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].destroyed, true);
  tasks[1].resolve(pdfDocument(3)); await lifecycle.settle();
  const stale = pdfDocument(47); tasks[0].resolve(stale); await lifecycle.settle();
  assert.equal(stale.destroyed, true);
  assert.equal(lifecycle.pageCount, 3);
});

test('translated pane shows its own page count and clears it immediately when the source changes', async (t) => {
  const module = { exports: {} as any };
  const bundle = await translatedPaneBundlePromise;
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
  const pageChanges: number[] = [];
  const pane = new Lifecycle(module.exports.default, {
    translatedPdfPath: 'C:/fixture/translation-a.pdf', fileName: 'translation-a.pdf',
    syncEnabled: true, onSyncEnabledChange() {}, onPageChange: (page: number) => pageChanges.push(page),
    active: true, smoothScroll: false, softPageShadow: false,
  });
  t.after(() => pane.unmount());
  const viewerProps = () => {
    let found: any;
    visit(pane.tree, (element) => { if (element.type?.name === 'PdfViewer') found = element.props; });
    assert.ok(found);
    return found;
  };
  const pageLabels = () => {
    const labels: string[] = [];
    visit(pane.tree, (element) => {
      if (typeof element.props.children === 'string' && /^第 \d+\/\d+ 页$/.test(element.props.children)) labels.push(element.props.children);
    });
    return labels;
  };
  pane.flush();
  assert.deepEqual(pageLabels(), []);
  viewerProps().onPageCountChange(3);
  viewerProps().onPageChange(2);
  pane.flush();
  assert.deepEqual(pageLabels(), ['第 2/3 页']);
  assert.deepEqual(pageChanges, [2]);
  pane.flush();
  pane.render({ ...pane.props, translatedPdfPath: 'C:/fixture/translation-b.pdf', fileName: 'translation-b.pdf' });
  assert.deepEqual(pageLabels(), [], 'a different source must not display the previous page count');
  pane.commit();
  viewerProps().onPageCountChange(47);
  pane.flush();
  assert.deepEqual(pageLabels(), ['第 1/47 页']);
});

test('reactivating the same loaded PDF reports its page count again without reloading', async (t) => {
  const counts: number[] = [];
  const { lifecycle, tasks } = await createViewer((count) => counts.push(count));
  t.after(() => lifecycle.unmount());
  tasks[0].resolve(pdfDocument(15));
  await lifecycle.settle();
  assert.equal(lifecycle.pageCount, 15);
  assert.deepEqual(counts, [0, 15]);
  assert.equal(tasks.length, 1, 'Reporting the loaded page count must not restart document loading');

  lifecycle.render({ ...lifecycle.props, active: false }); lifecycle.commit(); lifecycle.flush();
  const beforeReactivation = counts.length;
  lifecycle.render({ ...lifecycle.props, active: true }); lifecycle.commit(); lifecycle.flush();
  assert.deepEqual(counts.slice(beforeReactivation), [15]);
  assert.equal(lifecycle.pageCount, 15);
  assert.equal(tasks.length, 1);

  const replacementCounts: number[] = [];
  lifecycle.render({ ...lifecycle.props, onPageCountChange: (count: number) => replacementCounts.push(count) });
  lifecycle.commit(); lifecycle.flush();
  assert.deepEqual(replacementCounts, [15]);
  assert.equal(tasks.length, 1);
});

test('compare original source remains stable through parent renders during and after loading', async (t) => {
  const { stage, leftProps } = await createReadingStage();
  const { lifecycle, tasks } = await createViewer(() => {});
  t.after(() => { stage.unmount(); lifecycle.unmount(); });
  lifecycle.render({ ...lifecycle.props, ...leftProps() }); lifecycle.commit(); await lifecycle.settle();
  assert.equal(tasks.length, 2);
  const compareTask = tasks[1];
  for (let i = 0; i < 3; i++) {
    stage.render({ ...stage.props, pdfSource: { kind: 'local-path', path: 'C:/fixture/translated.pdf' } });
    stage.commit(); stage.flush();
    lifecycle.render({ ...lifecycle.props, ...leftProps() }); lifecycle.commit(); await lifecycle.settle();
  }
  assert.equal(tasks.length, 2);
  assert.equal(compareTask.destroyed, false);
  compareTask.resolve(pdfDocument(47));
  await lifecycle.settle();
  for (let i = 0; i < 3; i++) {
    stage.render({ ...stage.props, leftPaneWidthRatio: 0.4 + i / 20 });
    stage.commit(); stage.flush();
    lifecycle.render({ ...lifecycle.props, ...leftProps() }); lifecycle.commit(); await lifecycle.settle();
  }
  assert.equal(tasks.length, 2);
  assert.equal(lifecycle.pageCount, 47);
});

test('compare mode identifies an unavailable original instead of displaying the translation twice', async (t) => {
  const { stage } = await createReadingStage();
  t.after(() => stage.unmount());
  const reports: any[] = [];
  stage.render({ ...stage.props, originalPdfPath: '',
    onPdfPageCountChange: (...args: any[]) => reports.push(args) });
  stage.commit(); stage.flush();
  let viewerCount = 0;
  let message = false;
  let right: any;
  visit(stage.tree, (element) => {
    if (element.type?.name === 'PdfViewer') viewerCount++;
    if (element.props.children === '原版 PDF 不可用') message = true;
    if (element.type?.name === 'TranslatedPdfPane') right = element.props;
  });
  assert.equal(viewerCount, 0);
  assert.equal(message, true);
  assert.equal(right.pageSyncSignal, null);
  assert.deepEqual(reports.at(-1), [0, null, null]);

  stage.render({ ...stage.props, pdfSource: { kind: 'remote-url', url: 'https://example.test/original.pdf' } });
  stage.commit(); stage.flush();
  let remote: any;
  visit(stage.tree, (element) => { if (element.type?.name === 'PdfViewer') remote = element.props.source; });
  assert.deepEqual(remote, { kind: 'remote-url', url: 'https://example.test/original.pdf' });
});

test('compare original owns its filename, scroll and heatmap while translated pane carries no original overlays', async (t) => {
  const { stage, leftProps } = await createReadingStage();
  t.after(() => stage.unmount());
  const originalKey = 'local:C:/fixture/original.pdf';
  const position = { sourceKey: originalKey, page: 7, top: 100, left: 0, updatedAt: 1 };
  const heatmap = { sourceKey: originalKey, bins: [100], totalMs: 100, updatedAt: 1 };
  const positions: any[] = [];
  const heatmaps: any[] = [];
  stage.render({ ...stage.props, currentPdfName: 'translated.pdf', pdfScrollPosition: position,
    pdfReadingHeatmap: heatmap, onPdfScrollPositionChange: (value: any) => positions.push(value),
    onPdfReadingHeatmapChange: (value: any) => heatmaps.push(value) });
  stage.commit(); stage.flush();
  assert.equal(leftProps().currentPdfName, 'original.pdf');
  assert.equal(leftProps().scrollPosition, position);
  assert.equal(leftProps().readingHeatmap, heatmap);
  leftProps().onScrollPositionChange(position); leftProps().onReadingHeatmapChange(heatmap);
  assert.deepEqual(positions, [position]); assert.deepEqual(heatmaps, [heatmap]);
  const module = { exports: {} as any };
  const bundle = await translatedPaneBundlePromise;
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
  const pane = new Lifecycle(module.exports.default, childProps(stage, 'TranslatedPdfPane'));
  t.after(() => pane.unmount()); pane.flush();
  const right = childProps(pane, 'PdfViewer');
  assert.equal(right.enableReadingHeatmap, false);
  assert.deepEqual(right.annotations, []);
  assert.deepEqual(right.blocks, []);
  assert.equal(right.activeHighlight, null);
});

test('compare synchronization preserves independent page counts and suppresses clamped feedback', async (t) => {
  const { stage, leftProps } = await createReadingStage();
  t.after(() => stage.unmount());
  const rightProps = () => {
    let found: any;
    visit(stage.tree, (element) => { if (element.type?.name === 'TranslatedPdfPane') found = element.props; });
    assert.ok(found);
    return found;
  };
  const initial = rightProps().pageSyncSignal;
  rightProps().onPageSyncApplied(1, initial.token);
  leftProps().onPageChange(47); stage.flush();
  const rightSignal = rightProps().pageSyncSignal;
  assert.equal(rightSignal.page, 47);
  rightProps().onPageChange(3);
  rightProps().onPageSyncApplied(3, rightSignal.token); stage.flush();
  assert.equal(leftProps().pageSyncSignal, null);
  rightProps().onPageChange(2); stage.flush();
  const leftSignal = leftProps().pageSyncSignal;
  assert.equal(leftSignal.page, 2);
  leftProps().onPageChange(2);
  leftProps().onPageSyncApplied(2, leftSignal.token); stage.flush();
  assert.equal(rightProps().pageSyncSignal.token, rightSignal.token);
});

test('document readiness, page rendering, failure and manual retry are separate states', async (t) => {
  const errors: string[] = [];
  const { lifecycle, tasks, buses } = await createViewer(() => {});
  t.after(() => lifecycle.unmount());
  lifecycle.render({ ...lifecycle.props, onDocumentErrorChange: (error: string) => errors.push(error) });
  lifecycle.commit(); lifecycle.flush();
  assert.equal(lifecycle.tree?.props['data-pdf-phase'], 'loading-document');
  tasks[0].resolve(pdfDocument(47));
  await lifecycle.settle();
  assert.equal(lifecycle.tree?.props['data-pdf-phase'], 'document-ready');
  buses[0].dispatch('pagerendered', {});
  lifecycle.flush();
  assert.equal(lifecycle.tree?.props['data-pdf-phase'], 'page-rendered');

  buses[0].dispatch('pagerendered', { error: new Error('transport failed') });
  lifecycle.flush();
  assert.equal(lifecycle.tree?.props['data-pdf-phase'], 'error');
  assert.equal(errors.at(-1), 'transport failed');
  let retry: (() => void) | undefined;
  visit(lifecycle.tree, (element) => {
    if (element.type === 'button' && element.props.children === '重试') retry = element.props.onClick;
  });
  assert.ok(retry, 'The error state offers manual retry');
  retry(); lifecycle.flush(); await lifecycle.settle();
  assert.equal(tasks.length, 2);
  assert.equal(lifecycle.pageCount, 0);
  assert.equal(lifecycle.tree?.props['data-pdf-phase'], 'loading-document');
  tasks[1].resolve(pdfDocument(3));
  await lifecycle.settle();
  assert.equal(lifecycle.pageCount, 3);
  buses[1].dispatch('pagerendered', {}); lifecycle.flush();
  assert.equal(lifecycle.tree?.props['data-pdf-phase'], 'page-rendered');
});

test('a failed compare pane does not clear the other pane and can retry independently', async (t) => {
  const left = await createViewer(() => {});
  const right = await createViewer(() => {});
  t.after(() => { left.lifecycle.unmount(); right.lifecycle.unmount(); });
  left.tasks[0].reject(new Error('original unavailable'));
  right.tasks[0].resolve(pdfDocument(3));
  await left.lifecycle.settle(); await right.lifecycle.settle();
  right.buses[0].dispatch('pagerendered', {}); right.lifecycle.flush();
  assert.equal(left.lifecycle.tree?.props['data-pdf-phase'], 'error');
  assert.equal(right.lifecycle.tree?.props['data-pdf-phase'], 'page-rendered');
  assert.equal(right.lifecycle.pageCount, 3);
  let retry: (() => void) | undefined;
  visit(left.lifecycle.tree, (element) => {
    if (element.type === 'button' && element.props.children === '重试') retry = element.props.onClick;
  });
  assert.ok(retry);
  retry(); left.lifecycle.flush(); await left.lifecycle.settle();
  left.tasks[1].resolve(pdfDocument(47));
  await left.lifecycle.settle();
  left.buses[1].dispatch('pagerendered', {}); left.lifecycle.flush();
  assert.equal(left.lifecycle.pageCount, 47);
  assert.equal(right.lifecycle.pageCount, 3);
  assert.equal(right.tasks.length, 1);
});

test('a translated pane failure leaves the original pane rendered', async (t) => {
  const left = await createViewer(() => {});
  const right = await createViewer(() => {});
  t.after(() => { left.lifecycle.unmount(); right.lifecycle.unmount(); });
  left.tasks[0].resolve(pdfDocument(47));
  right.tasks[0].reject(new Error('translation unavailable'));
  await left.lifecycle.settle(); await right.lifecycle.settle();
  left.buses[0].dispatch('pagerendered', {}); left.lifecycle.flush();
  assert.equal(left.lifecycle.tree?.props['data-pdf-phase'], 'page-rendered');
  assert.equal(left.lifecycle.pageCount, 47);
  assert.equal(right.lifecycle.tree?.props['data-pdf-phase'], 'error');
  assert.equal(left.tasks.length, 1);
});

test('unmount cancels an in-flight task and releases a late document', async () => {
  const counts: number[] = [];
  const { lifecycle, tasks, attached } = await createViewer((count) => counts.push(count));
  lifecycle.unmount();
  assert.equal(tasks[0].destroyed, true);
  const lateDocument = pdfDocument(47);
  tasks[0].resolve(lateDocument);
  for (let pass = 0; pass < 5; pass++) await Promise.resolve();
  assert.equal(lateDocument.destroyed, true);
  assert.deepEqual(attached, []);
  assert.deepEqual(counts, [0]);
});

test('switching sources does not report the previous source error for the new source', async (t) => {
  const errors: string[] = [];
  const { lifecycle, tasks } = await createViewer(() => {});
  t.after(() => lifecycle.unmount());
  lifecycle.render({ ...lifecycle.props, onDocumentErrorChange: (error: string) => errors.push(error) });
  lifecycle.commit(); lifecycle.flush();
  tasks[0].reject(new Error('first source failed'));
  await lifecycle.settle();
  assert.equal(errors.at(-1), 'first source failed');
  const nextErrors: string[] = [];
  lifecycle.render({ ...lifecycle.props, source: { kind: 'local-path', path: 'C:/fixture/next.pdf' },
    onDocumentErrorChange: (error: string) => nextErrors.push(error) });
  lifecycle.commit(); await lifecycle.settle();
  assert.ok(!nextErrors.includes('first source failed'));
  assert.equal(lifecycle.tree?.props['data-pdf-phase'], 'loading-document');
  tasks[1].resolve(pdfDocument(3));
  await lifecycle.settle();
  assert.equal(lifecycle.pageCount, 3);
});

test('changing the PDF source exposes zero pages before the new load and never reports the old count', async (t) => {
  const counts: number[] = [];
  const { lifecycle, tasks } = await createViewer((count) => counts.push(count));
  t.after(() => lifecycle.unmount());
  tasks[0].resolve(pdfDocument(15));
  await lifecycle.settle();

  const nextCounts: number[] = [];
  lifecycle.render({ ...lifecycle.props, source: { kind: 'local-path', path: 'C:/fixture/paper-b.pdf' },
    onPageCountChange: (count: number) => nextCounts.push(count) });
  assert.equal(lifecycle.pageCount, 0, 'Even the render before reset effects must not carry the previous PDF count');
  lifecycle.commit(); await lifecycle.settle();
  assert.deepEqual(nextCounts, [0]);
  assert.equal(tasks.length, 2);
  tasks[1].resolve(pdfDocument(7));
  await lifecycle.settle();
  assert.equal(lifecycle.pageCount, 7);
  assert.deepEqual(nextCounts, [0, 7]);
});

test('a cancelled old source resolving after the new source cannot replace its page count', async (t) => {
  const counts: number[] = [];
  const { lifecycle, tasks, attached } = await createViewer((count) => counts.push(count));
  t.after(() => lifecycle.unmount());
  lifecycle.render({ ...lifecycle.props, source: { kind: 'local-path', path: 'C:/fixture/paper-b.pdf' } });
  lifecycle.commit(); await lifecycle.settle();
  assert.equal(tasks[0].destroyed, true);
  assert.equal(tasks.length, 2);
  tasks[1].resolve(pdfDocument(7));
  await lifecycle.settle();

  const staleDocument = pdfDocument(15);
  tasks[0].resolve(staleDocument);
  await lifecycle.settle();
  assert.equal(staleDocument.destroyed, true);
  assert.equal(lifecycle.pageCount, 7);
  assert.deepEqual(counts, [0, 7]);
  assert.deepEqual(attached, [7]);
  assert.equal(tasks.length, 2);
});

test('a second citation page requested while hidden reaches the cached PDF when it becomes active', async (t) => {
  const { lifecycle, tasks, navigation, runFrames } = await createViewer(() => {});
  t.after(() => lifecycle.unmount());
  tasks[0].resolve(pdfDocument(15));
  await lifecycle.settle();
  const highlight = (pageIndex: number) => ({ blockId: `page-${pageIndex + 1}-block`, pageIndex, bbox: [10, 10, 40, 40] });

  lifecycle.render({ ...lifecycle.props, activeHighlight: highlight(4), highlightScrollSignal: 1 });
  lifecycle.commit(); lifecycle.flush(); runFrames(); lifecycle.flush();
  assert.deepEqual(navigation, [5]);

  lifecycle.render({ ...lifecycle.props, active: false, activeHighlight: highlight(5), highlightScrollSignal: 2 });
  lifecycle.commit(); lifecycle.flush(); runFrames(); lifecycle.flush();
  assert.deepEqual(navigation, [5], 'A hidden viewer must retain the second highlight for activation');

  lifecycle.render({ ...lifecycle.props, active: true });
  lifecycle.commit(); lifecycle.flush(); runFrames(); lifecycle.flush();
  assert.deepEqual(navigation, [5, 6]);
  assert.equal(lifecycle.pageCount, 15);
  assert.equal(tasks.length, 1);
});
