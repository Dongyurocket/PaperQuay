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
  textContent = '';
  clientHeight = 800;
  clientWidth = 600;
  scrollHeight = 12_000;
  scrollWidth = 600;
  scrollTop = 0;
  scrollLeft = 0;
  addEventListener() {}
  removeEventListener() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
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

async function createViewer(onPageCountChange: (count: number) => void) {
  const tasks: LoadingTask[] = [];
  const attached: number[] = [];
  const navigation: number[] = [];
  const __pdf = {
    getDocument(init: any) {
      let resolve!: (value: any) => void;
      const task: LoadingTask = { init, promise: new Promise((done) => { resolve = done; }),
        resolve: (value) => resolve(value), destroyed: false, destroy() { this.destroyed = true; } };
      tasks.push(task);
      return task;
    },
    EventBus: class { on() {} off() {} },
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
  const document = { addEventListener() {}, removeEventListener() {} };
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
    activeBlockId: null, hoveredBlockId: null, activeHighlight: null, onBlockHover() {}, onPageCountChange });
  lifecycle.flush();
  await lifecycle.settle();
  assert.equal(tasks.length, 1, 'The real load effect should create a PDF.js loading task');
  return { lifecycle, tasks, attached, navigation, runFrames };
}

function pdfDocument(numPages: number) {
  return { numPages, cleanup() {}, destroyed: false, destroy() { this.destroyed = true; } };
}

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
