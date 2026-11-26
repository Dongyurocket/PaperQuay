import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

import {
  buildFolderDeleteConfirm,
  buildNotesIndexDoneMessage,
  buildNotesIndexProgressMessage,
  buildNotesIndexQueuedMessage,
  buildVaultRemovalConfirm,
  buildVaultSyncDeferredMessage,
  buildVaultSyncMessage,
  noteErrorMessage,
} from '../src/features/notes/notesText.ts';
import { noteAnchorDisplayText, noteDisplayTitle } from '../src/features/notes/notesDisplay.ts';
import { noteAnchorProvenanceLabel, titleFromText } from '../src/features/notes/noteUtils.ts';
import { titleFromNoteContent } from '../src/features/notes/notesTiptap.ts';
import { NoteServiceError } from '../src/services/notes.ts';
import { buildNoteHealthReport, noteHealthBadges } from '../src/features/notes/noteHealth.ts';

/**
 * D4-9 / D7-9 / 第 6 项：笔记工作区的双语渲染与错误码映射。
 *
 * 渲染用例用 esbuild 打包真实的 NotesWorkspace，只替换与文案无关的服务、
 * 子组件与状态模块；语言由 mock 的 uiLanguage 读取 globalThis.__notesLocale，
 * 同一份 bundle 可以在 zh-CN / en-US 之间切换。
 */

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
for (const name of [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement',
  'Event', 'MouseEvent', 'CustomEvent', 'localStorage', 'getComputedStyle',
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

const en: <T>(zh: T, enText: T) => T = (_zh, enText) => enText;
const zh: <T>(zhText: T, _en: T) => T = (zhText) => zhText;

function makeNotesState() {
  return {
    notes: [],
    tags: [],
    activeNoteId: null,
    search: '',
    tag: null,
    loading: false,
    saving: false,
    error: '',
    setActiveNoteId() {},
    setSearch() {},
    setTag() {},
    async loadNotes() {},
    async refreshTags() {},
    async createWorkspaceNote() {
      return { id: 'created', title: 'x', updatedAt: 0 };
    },
    async updateWorkspaceNote() {
      return { id: 'n1', title: 'x', updatedAt: 0 };
    },
    async deleteWorkspaceNote() {},
  };
}

const LUCIDE_ICONS = [
  'Check', 'ChevronDown', 'ChevronRight', 'Copy', 'FileText', 'Folder', 'FolderOpen',
  'FolderPlus', 'FolderSync', 'Network', 'NotebookText', 'PanelRightClose', 'PanelRightOpen',
  'Pencil', 'Pin', 'Plus', 'Search', 'RefreshCw', 'Star', 'Trash2', 'X',
  // NoteEditorToolbar
  'Bold', 'BookMarked', 'Code2', 'Heading1', 'Heading2', 'Highlighter', 'ImageIcon',
  'Italic', 'Link2', 'List', 'ListChecks', 'ListOrdered', 'Pilcrow', 'Quote', 'Redo2',
  'Sigma', 'Strikethrough', 'Table2', 'Undo2',
  // ui/toast（NoteEditorToolbar 的「任务列表」不可用提示）
  'AlertTriangle', 'CheckCircle2', 'Loader2',
  // editor/toolbar context menu
  'ClipboardPaste', 'Heading3', 'RemoveFormatting', 'Save', 'Scissors', 'Tag',
  // editor/tableCell
  'ArrowDown', 'ArrowUp', 'GripVertical', 'FileJson', 'BookOpenText', 'Info',
];

const CJK_PATTERN = /[一-鿿]/;

const localeMock = `export const useLocaleText = () => (zh, en) => ((globalThis.__notesLocale ?? 'zh-CN') === 'en-US' ? en : zh);
  export const useAppLocale = () => globalThis.__notesLocale ?? 'zh-CN';
  export const pickDocumentLocaleText = (zh, en) => ((globalThis.__notesLocale ?? 'zh-CN') === 'en-US' ? en : zh);`;

const workspaceMocks: Record<string, string> = {
  '../../i18n/uiLanguage': localeMock,
  '../../services/notes': `export const cancelNotesVaultAutoSync = async () => {};
    export const createNoteFolder = async (request) => ({ id: 'folder-new', name: request.name, parentId: request.parentId ?? null });
    export const deleteNoteFolder = async () => ({ deletedFolderIds: [] });
    export const listNoteFolders = async () => [];
    export const renameNoteFolder = async (id, name) => ({ id, name, parentId: null });
    export const getNotesVaultSettings = async () => ({ dir: 'C:/vault', updatedAtMs: 0 });
    export const syncNotesVaultNow = async (options) => {
      const queue = globalThis.__notesVaultSyncResponses;
      if (Array.isArray(queue) && queue.length > 0) return queue.shift();
      return { vaultDir: 'C:/vault', exported: 0, imported: 0, created: 0, updated: 0, removed: 0, skipped: 0, conflicts: 0, total: 0, createdFolders: 0 };
    };
    export const updateNotesVaultSettings = async (settings) => ({ dir: settings.dir, updatedAtMs: 0 });
    export const rebuildNotesIndex = async () => ({ queued: 0 });
    export const getNote = async () => null;
    export const getNotesIndexStatus = async () => ({ pending: 0, running: false, completed: 0, failed: 0, lastError: null });`,
  './NoteEditor': 'export function NoteEditor() { return null; }',
  './NotesGraphView': 'export function NotesGraphView() { return null; }',
  '../../services/library': 'export const listAllLibraryPapers = async () => [];',
  '../../app/appEvents': `export const NOTE_CHANGED_EVENT = 'test:note-changed';
    export const emitJumpToNoteAnchor = () => {};
    export const emitNoteChanged = () => {};
    export const emitOpenLibraryPaper = () => {};`,
  '../../stores/useNotesStore': `const fallback = { notes: [], tags: [], activeNoteId: null, search: '', tag: null, loading: false, saving: false, error: '',
      setActiveNoteId() {}, setSearch() {}, setTag() {},
      loadNotes: async () => {}, refreshTags: async () => {},
      createWorkspaceNote: async () => ({ id: 'created', title: 'x', updatedAt: 0 }),
      updateWorkspaceNote: async () => ({ id: 'n1', title: 'x', updatedAt: 0 }),
      deleteWorkspaceNote: async () => {} };
    const state = () => globalThis.__notesState ?? fallback;
    export const GLOBAL_NOTES_PAPER_ID = 'global-notes';
    export const useNotesStore = Object.assign(() => state(), { getState: () => state() });`,
  '../../stores/useTabsStore': `const state = { tabs: [], activeTabId: null, openNoteTab() {}, updateNoteTabTitle() {}, setNoteTabExternalUpdate() {}, closeTab() {} };
    export const useTabsStore = Object.assign((selector) => selector(state), { getState: () => state });`,
  '../../services/externalWrite': `export const EXTERNAL_NOTES_WRITE_EVENT = 'test:external-write';`,
  '../../services/desktop': 'export const selectDirectory = async () => null;',
  '../reader/readerShared': 'export const loadSettings = () => null;',
  '../../app/settings/useAppSettings': 'export const useAppSettingsSnapshot = () => null;',
  './notesQuickWins': 'export const shouldRunVaultAutoSync = () => false;',
  '../../utils/cn': "export const cn = (...values) => values.filter(Boolean).join(' ');",
  './NotesContextMenu': `export const NotesContextMenu = () => null;
    export const copyTextToClipboard = async () => true;
    export const shouldUseNativeTextContextMenu = () => false;`,
  './notesTiptap': `export const extractOutline = () => [];
    export const noteContentToTiptap = () => ({ type: 'doc', content: [] });`,
  './noteUtils': `export const countNotesInFolderTree = () => ({ uncategorizedCount: 0, folderCounts: new Map() });`,
  './noteAnchorLocation.ts': 'export const resolveNoteAnchorLocation = () => ({});',
  './noteReferences': 'export const extractNoteReferences = () => [];',
  '../../ui/confirmHost': `export const confirmAction = async (options) => {
      (globalThis.__notesConfirms ??= []).push(options);
      return Boolean(globalThis.__notesConfirmResult);
    };`,
  'lucide-react': LUCIDE_ICONS.map((icon) => `export const ${icon} = () => null;`).join('\n'),
};

async function loadFixtureBundle(entryPoint: string, mocks: Record<string, string>) {
  const bundle = await build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    external: ['react', 'react/*', 'react-dom', 'react-dom/*'],
    define: { 'import.meta.url': JSON.stringify(import.meta.url) },
    loader: { '.css': 'empty' },
    write: false,
    logLevel: 'silent',
    plugins: [{
      name: 'notes-i18n-fixtures',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => (
          mocks[args.path] ? { path: args.path, namespace: 'notes-i18n-fixture' } : undefined
        ));
        builder.onLoad({ filter: /.*/, namespace: 'notes-i18n-fixture' }, (args) => ({
          contents: mocks[args.path],
          loader: 'js',
        }));
      },
    }],
  });
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
  return module.exports as any;
}

async function loadWorkspaceBundle() {
  return loadFixtureBundle('src/features/notes/NotesWorkspace.tsx', workspaceMocks);
}

const noteEditorToolbarMocks: Record<string, string> = {
  '../../i18n/uiLanguage': localeMock,
  '@tiptap/react': `export const useEditorState = ({ editor, selector }) => {
    try {
      return editor ? selector({ editor }) : null;
    } catch {
      return null;
    }
  };`,
  'lucide-react': LUCIDE_ICONS.map((icon) => `export const ${icon} = () => null;`).join('\n'),
  '../../utils/cn': "export const cn = (...values) => values.filter(Boolean).join(' ');",
  './noteEditorBlockUtils.ts': 'export const focusTextPosition = () => {};',
  './noteEditorUtils': `export const componentBlockNode = (title = 'Component') => ({ type: 'noteComponentBlock', attrs: { title } });
    export const paragraphNode = () => ({ type: 'paragraph' });
    export const insertImageFilesIntoView = () => false;
    export const templateContentForLocale = (template, locale) => (locale === 'en-US' ? template.contentEn : template.content);
    export const NOTE_TEMPLATES = [{
      id: 't1',
      label: '模板一',
      labelEn: 'Template one',
      description: '模板描述',
      descriptionEn: 'Template description',
      content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '中文标题' }] }],
      contentEn: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'English template heading' }] }],
    }];`,
  './noteReferences': `export const extractNoteReferences = () => [];
    export const upsertNoteReferenceList = () => {};
    export const referenceListHeadingForLocale = (locale) => (locale === 'en-US' ? 'References' : '参考文献');`,
  './bibliography': `export const NOTE_CITATION_STYLE_OPTIONS = [
      { id: 'gbt7714', label: 'GB/T 7714' },
      { id: 'apa7', label: 'APA 7' },
      { id: 'ieee', label: 'IEEE' },
    ];`,
};

const contextMenuMocks: Record<string, string> = {
  'lucide-react': LUCIDE_ICONS.map((icon) => `export const ${icon} = () => null;`).join('\n'),
  '../../../utils/cn': "export const cn = (...values) => values.filter(Boolean).join(' ');",
  '../NotesContextMenu': 'export const copyTextToClipboard = async () => true;',
  '@tiptap/extension-table': 'export const Table = { extend: (options) => options };',
  '@tiptap/pm/state': 'export const TextSelection = { near: () => null };',
  '@tiptap/pm/tables': `export const cellAround = () => null;
    export const cellNear = () => null;
    export const tableEditingKey = {};`,
};

const notesGraphMocks: Record<string, string> = {
  '../../i18n/uiLanguage': localeMock,
  '../../stores/useNotesStore': "export const GLOBAL_NOTES_PAPER_ID = 'global-notes';",
};

const workspaceModule = loadWorkspaceBundle();
const noteEditorToolbarModule = loadFixtureBundle(
  'src/features/notes/NoteEditorToolbar.tsx',
  noteEditorToolbarMocks,
);
const contextMenuModule = loadFixtureBundle('src/features/notes/editor/toolbar.tsx', contextMenuMocks);
const notesGraphModule = loadFixtureBundle('src/features/notes/NotesGraphView.tsx', notesGraphMocks);

function makeFakeEditor() {
  const chain: any = new Proxy({}, { get: () => () => chain });

  return {
    isDestroyed: false,
    isActive: () => false,
    can: () => ({ undo: () => false, redo: () => false, mergeCells: () => true, splitCell: () => true }),
    chain: () => chain,
    commands: { focus() {}, setTextSelection() {}, insertContent() {} },
    getAttributes: () => ({}),
    getJSON: () => ({ type: 'doc', content: [] }),
    state: { selection: { from: 0, to: 0 }, doc: { textBetween: () => '' } },
  } as any;
}

function makeBlockNode(name: string, attrs: Record<string, unknown> = {}) {
  return {
    type: { name },
    attrs,
    nodeSize: 3,
    isAtom: false,
    isLeaf: false,
    textContent: '',
    descendants() {},
    toJSON() { return { type: name, attrs }; },
  } as any;
}

async function mountComponent(
  modulePromise: Promise<any>,
  exportName: string,
  props: Record<string, unknown>,
  locale: 'zh-CN' | 'en-US',
) {
  const module = await modulePromise;
  (globalThis as any).__notesLocale = locale;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(module[exportName], props));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return {
    container,
    async unmount() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

function collectAttributeText(container: HTMLElement): string {
  return Array.from(container.querySelectorAll('*'))
    .flatMap((element) => ['title', 'aria-label', 'placeholder']
      .map((name) => element.getAttribute(name))
      .filter((value): value is string => Boolean(value)))
    .join('\n');
}

function clickElement(element: Element) {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

async function mountWorkspace(locale: 'zh-CN' | 'en-US') {
  const { NotesWorkspace } = await workspaceModule;
  (globalThis as any).__notesLocale = locale;
  (globalThis as any).__notesState = makeNotesState();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(NotesWorkspace, {}));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return {
    container,
    async unmount() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

test('noteErrorMessage maps known codes bilingually and never echoes backend text', () => {
  assert.equal(noteErrorMessage(new NoteServiceError('NOTE_UPDATE_FAILED', '后端原始错误'), en), 'Failed to save the note');
  assert.equal(noteErrorMessage(new NoteServiceError('NOTE_UPDATE_FAILED', '后端原始错误'), zh), '保存笔记失败');
  assert.equal(noteErrorMessage('NOTE_CONFLICT: 后端冲突', en), 'Note was updated elsewhere. Refresh and try again.');
  assert.equal(noteErrorMessage('NOTE_CONFLICT: 后端冲突', zh), '笔记已在别处更新，请刷新后重试');

  const unknownEn = noteErrorMessage(new Error('SOMETHING_UNKNOWN: 后端中文失败'), en);
  assert.equal(unknownEn, 'Operation failed');
  assert.doesNotMatch(unknownEn, /[\u4e00-\u9fff]/);
  const plainUnknown = noteErrorMessage('后端中文错误原文', zh);
  assert.equal(plainUnknown, '操作失败');
  assert.doesNotMatch(plainUnknown, /后端中文错误原文/);
});

test('NoteServiceError keeps the stable code and CODE: detail message', () => {
  const error = new NoteServiceError('NOTE_UPDATE_FAILED', 'disk full');
  assert.equal(error.code, 'NOTE_UPDATE_FAILED');
  assert.equal(error.message, 'NOTE_UPDATE_FAILED: disk full');
  assert.ok(error instanceof Error);
  assert.match(error.message, /NOTE_UPDATE_FAILED/);
});

test('vault repair confirmation and sync messages are bilingual', () => {
  const stats = { imported: 2, created: 1, exported: 3, removed: 4, conflicts: 5 };
  const confirmEn = buildVaultRemovalConfirm(12, en);
  assert.match(confirmEn.title, /vault/i);
  assert.match(confirmEn.description, /12/);
  assert.match(confirmEn.description, /vault/i);
  assert.match(confirmEn.confirmLabel, /delete/i);
  assert.equal(confirmEn.danger, true);
  const confirmZh = buildVaultRemovalConfirm(12, zh);
  assert.match(confirmZh.title, /vault/i);
  assert.match(confirmZh.description, /12/);
  assert.match(confirmZh.description, /vault/);
  assert.match(confirmZh.description, /删除/);

  const syncEn = buildVaultSyncMessage(stats, en);
  assert.match(syncEn, /imported 2/);
  assert.match(syncEn, /exported 3/);
  assert.match(syncEn, /cleaned up 4/);
  assert.doesNotMatch(syncEn, /[\u4e00-\u9fff]/);
  const syncZh = buildVaultSyncMessage(stats, zh);
  assert.match(syncZh, /导入 2/);
  assert.match(syncZh, /导出 3/);

  const deferredEn = buildVaultSyncDeferredMessage(stats, 8, en);
  assert.match(deferredEn, /8/);
  assert.match(deferredEn, /deferred/i);
  assert.doesNotMatch(deferredEn, /[\u4e00-\u9fff]/);
});

test('folder delete confirmation and notes index messages are bilingual', () => {
  const folderEn = buildFolderDeleteConfirm('Reading list', true, en);
  assert.match(folderEn.title, /Reading list/);
  assert.match(folderEn.description, /Uncategorized/);
  assert.doesNotMatch(folderEn.description, /[\u4e00-\u9fff]/);
  const folderZh = buildFolderDeleteConfirm('阅读清单', true, zh);
  assert.equal(folderZh.title, '删除分类「阅读清单」');
  assert.match(folderZh.description, /未分类/);

  assert.match(buildNotesIndexQueuedMessage(5, en), /5/);
  assert.match(buildNotesIndexProgressMessage({ completed: 1, failed: 2, pending: 3 }, en), /1.*2.*3/);
  const doneEn = buildNotesIndexDoneMessage({ completed: 1, failed: 2, lastError: '后端堆栈' }, en);
  assert.doesNotMatch(doneEn, /[\u4e00-\u9fff]/);
  assert.doesNotMatch(doneEn, /后端堆栈/);
});

test('NotesWorkspace renders English empty states under en-US', async () => {
  const mounted = await mountWorkspace('en-US');
  try {
    const text = mounted.container.textContent ?? '';
    assert.doesNotMatch(text, /[\u4e00-\u9fff]/, `unexpected Chinese text: ${text}`);
    assert.match(text, /No notes yet/);
    assert.match(text, /All notes/);
    assert.match(text, /Uncategorized/);
    assert.match(text, /No note selected/);
    assert.match(text, /Folders/);
  } finally {
    await mounted.unmount();
  }
});

test('NotesWorkspace renders Chinese empty states under zh-CN', async () => {
  const mounted = await mountWorkspace('zh-CN');
  try {
    const text = mounted.container.textContent ?? '';
    assert.match(text, /暂无笔记/);
    assert.match(text, /全部笔记/);
    assert.match(text, /未分类/);
  } finally {
    await mounted.unmount();
  }
});

test('NotesGraphView badge data provides bilingual labels and descriptions', () => {
  const report = buildNoteHealthReport([], { now: 0 });
  const badgesEn = noteHealthBadges(report, 'en-US');
  const badgesZh = noteHealthBadges(report, 'zh-CN');
  assert.deepEqual(badgesEn.map((badge) => badge.category), ['orphan', 'broken-link', 'untitled', 'untagged', 'stale']);
  assert.equal(badgesEn[0].label, 'Orphaned');
  assert.equal(badgesZh[0].label, '孤立');
  for (const badge of badgesEn) {
    assert.ok(badge.description.length > 0);
    assert.doesNotMatch(badge.description, /[\u4e00-\u9fff]/);
  }
  for (const badge of badgesZh) {
    assert.ok(badge.description.length > 0);
  }
});

test('useNotesStore stores stable error codes and rethrows Error instances', async () => {
  const bundle = await build({
    entryPoints: ['src/stores/useNotesStore.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['react', 'react/*'],
    write: false,
    logLevel: 'silent',
    plugins: [{
      name: 'notes-store-service-mock',
      setup(builder) {
        builder.onResolve({ filter: /^\.\.\/services\/notes$/ }, () => ({ path: 'notes', namespace: 'store-mock' }));
        builder.onLoad({ filter: /.*/, namespace: 'store-mock' }, () => ({
          contents: `export const createNote = (...args) => globalThis.__storeCreate(...args);
            export const updateNote = (...args) => globalThis.__storeUpdate(...args);
            export const deleteNote = (...args) => globalThis.__storeDelete(...args);
            export const listNoteTags = async () => [];
            export const listAllNotes = async () => [];
            export const listNotes = async () => [];`,
          loader: 'js',
        }));
      },
    }],
  });
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
  const { useNotesStore } = module.exports;
  useNotesStore.setState({ notes: [], activeNoteId: null, saving: false, error: '' });

  (globalThis as any).__storeUpdate = async () => {
    throw Object.assign(new Error('NOTE_CONFLICT: expected 3'), { code: 'NOTE_CONFLICT' });
  };
  try {
    await assert.rejects(
      useNotesStore.getState().updateWorkspaceNote('n1', { title: 'x' }),
      (error: unknown) => error instanceof Error && error.message.includes('NOTE_CONFLICT'),
    );
    assert.equal(useNotesStore.getState().error, 'NOTE_CONFLICT');
  } finally {
    delete (globalThis as any).__storeUpdate;
  }

  (globalThis as any).__storeUpdate = async () => {
    throw 'offline';
  };
  try {
    await assert.rejects(
      useNotesStore.getState().updateWorkspaceNote('n1', { title: 'x' }),
      (error: unknown) => error instanceof Error && error.message === 'NOTE_UPDATE_FAILED',
    );
    assert.equal(useNotesStore.getState().error, 'NOTE_UPDATE_FAILED');
  } finally {
    delete (globalThis as any).__storeUpdate;
  }
});

test('titleFromNoteContent no longer invents a Chinese title and keeps explicit fallbacks', () => {
  assert.equal(titleFromNoteContent(''), '');
  assert.equal(titleFromNoteContent('   '), '');
  assert.equal(titleFromNoteContent('', '自定义'), '自定义');
  assert.equal(titleFromNoteContent('First line\nsecond line'), 'First line second line');
  assert.doesNotMatch(titleFromNoteContent(''), CJK_PATTERN);
});

test('noteDisplayTitle displays untitled notes in the active locale', () => {
  assert.equal(noteDisplayTitle('', en), 'Untitled note');
  assert.equal(noteDisplayTitle('  ', en), 'Untitled note');
  assert.equal(noteDisplayTitle('未命名笔记', en), 'Untitled note');
  assert.equal(noteDisplayTitle('Untitled Note', zh), '未命名笔记');
  // 本地化输出本身也可能被写入临时 state（图谱节点拷贝）；切回中文时要能识别。
  assert.equal(noteDisplayTitle('Untitled note', zh), '未命名笔记');
  assert.equal(noteDisplayTitle('', zh), '未命名笔记');
  assert.equal(noteDisplayTitle('My note', zh), 'My note');
});

test('anchor provenance and data fallbacks are localized without changing data', () => {
  assert.equal(noteAnchorDisplayText('摘录', en), 'Excerpt');
  assert.equal(noteAnchorDisplayText('正文摘录', en), 'Excerpt');
  assert.equal(noteAnchorDisplayText('文献', en), 'Paper');
  assert.equal(noteAnchorDisplayText('定位', en), 'Location');
  assert.equal(noteAnchorDisplayText('引用', en), 'Reference');
  assert.equal(noteAnchorDisplayText('Reference', zh), '引用');
  assert.equal(noteAnchorDisplayText('P12', en), 'P12');
  assert.equal(noteAnchorDisplayText('A paper title', zh), 'A paper title');

  assert.equal(noteAnchorProvenanceLabel({ aiEnhanced: true }, en), 'AI re-recognition');
  assert.equal(noteAnchorProvenanceLabel({ aiEnhanced: true }, zh), 'AI 重识别');
  assert.equal(noteAnchorProvenanceLabel({ aiEnhanced: false }, en), '');
  // 不传 localizer 时保持历史输出，供数据构建/测试使用。
  assert.equal(noteAnchorProvenanceLabel({ aiEnhanced: true }), 'AI 重识别');

  assert.equal(titleFromText('   '), '');
  assert.equal(titleFromText('', '引用'), '引用');
  assert.equal(titleFromText('First line'), 'First line');

  // 调用点必须传 localizer，否则 en 界面会退回中文徽标。
  const extensions = readFileSync('src/features/notes/editor/extensions.tsx', 'utf8');
  assert.match(extensions, /noteAnchorProvenanceLabel\(\{ aiEnhanced \}, l\)/);
  assert.match(
    extensions,
    /noteAnchorProvenanceLabel\(\s*\{ aiEnhanced: node\.attrs\.aiEnhanced === true \},\s*pickDocumentLocaleText,?\s*\)/,
  );
});

test('vault over-limit confirmation actually renders English copy under en-US', async () => {
  (globalThis as any).__notesConfirmResult = false;
  (globalThis as any).__notesConfirms = [];
  (globalThis as any).__notesVaultSyncResponses = [{
    vaultDir: 'C:/vault',
    exported: 0,
    imported: 0,
    created: 0,
    updated: 0,
    removed: 0,
    skipped: 0,
    conflicts: 0,
    total: 0,
    createdFolders: 0,
    removalConfirmationRequired: true,
    pendingRemovals: 7,
  }];

  const mounted = await mountWorkspace('en-US');
  try {
    const syncButton = mounted.container.querySelector(
      'button[title="Sync notes vault (Obsidian compatible)"]',
    );
    assert.ok(syncButton, 'sync vault button must render with the English title');

    await act(async () => {
      clickElement(syncButton as Element);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const confirms = (globalThis as any).__notesConfirms as Array<Record<string, unknown>>;
    assert.equal(confirms.length, 1);
    const confirm = confirms[0];
    assert.match(String(confirm.title), /vault/i);
    assert.match(String(confirm.description), /7/);
    assert.match(String(confirm.description), /vault/i);
    assert.match(String(confirm.confirmLabel), /delete/i);
    assert.doesNotMatch(JSON.stringify(confirm), CJK_PATTERN);
    assert.equal(confirm.danger, true);
  } finally {
    delete (globalThis as any).__notesVaultSyncResponses;
    delete (globalThis as any).__notesConfirms;
    delete (globalThis as any).__notesConfirmResult;
    await mounted.unmount();
  }
});

test('NoteEditorToolbar renders English reference picker and input menu under en-US', async () => {
  const mounted = await mountComponent(
    noteEditorToolbarModule,
    'NoteEditorToolbar',
    {
      editor: makeFakeEditor(),
      papers: [],
      citationStyle: 'gbt7714',
      referencePickerOpen: true,
      onReferencePickerToggle() {},
      onReferencePickerClose() {},
      onCitationStyleChange() {},
    },
    'en-US',
  );

  try {
    const text = mounted.container.textContent ?? '';
    assert.doesNotMatch(text, CJK_PATTERN);
    assert.ok(mounted.container.querySelector('button[title="Insert reference citation"]'));
    assert.ok(mounted.container.querySelector('input[placeholder="Search paper title or ID"]'));
    assert.match(text, /No matching papers/);
    assert.match(text, /Citation style/);
    assert.match(text, /Insert\/update the reference list/);

    const mathButton = mounted.container.querySelector('button[title="Math"]');
    assert.ok(mathButton);
    await act(async () => {
      clickElement(mathButton as Element);
    });
    assert.ok(mounted.container.querySelector('input[placeholder="Enter a LaTeX formula"]'));
    assert.equal(
      mounted.container.querySelector('form button[type="submit"]')?.textContent,
      'Insert',
    );

    const imageButton = mounted.container.querySelector('button[title="Image"]');
    assert.ok(imageButton);
    await act(async () => {
      clickElement(imageButton as Element);
    });
    assert.ok(mounted.container.querySelector('input[placeholder="Enter an image URL or a local data URL"]'));
    assert.match(mounted.container.textContent ?? '', /File/);

    assert.doesNotMatch(mounted.container.textContent ?? '', CJK_PATTERN);
    assert.doesNotMatch(collectAttributeText(mounted.container), CJK_PATTERN);
  } finally {
    await mounted.unmount();
  }
});

test('NoteEditorToolbar inserts the English template body under en-US', async () => {
  const editor = makeFakeEditor();
  const inserted: unknown[] = [];
  const chain: any = new Proxy({}, {
    get: (_target, property) => {
      if (property === 'insertContent') {
        return (content: unknown) => {
          inserted.push(content);
          return chain;
        };
      }
      return () => chain;
    },
  });
  editor.chain = () => chain;

  const mounted = await mountComponent(
    noteEditorToolbarModule,
    'NoteEditorToolbar',
    { editor, papers: [], citationStyle: 'gbt7714' },
    'en-US',
  );

  try {
    const templateButton = mounted.container.querySelector('button[title="Insert template"]');
    assert.ok(templateButton, 'template menu button must render with the English title');
    await act(async () => {
      clickElement(templateButton as Element);
    });

    const templateItem = mounted.container.querySelector('.pq-note-toolbar-menu button');
    assert.ok(templateItem, 'template entry must render');
    await act(async () => {
      clickElement(templateItem as Element);
    });

    assert.equal(inserted.length, 1);
    const insertedText = JSON.stringify(inserted[0]);
    assert.match(insertedText, /English template heading/);
    assert.doesNotMatch(insertedText, CJK_PATTERN);
  } finally {
    await mounted.unmount();
  }
});

test('editor context menu builder renders English labels under en-US', async () => {
  const { buildEditorContextMenuEntries } = await contextMenuModule;
  const editor = makeFakeEditor();
  const context = {
    x: 10,
    y: 10,
    position: 0,
    block: { node: makeBlockNode('heading', { level: 1 }), from: 0, to: 3 },
    inTable: false,
  };

  const entries = buildEditorContextMenuEntries(editor, context, en) as Array<Record<string, unknown>>;
  const labels = entries
    .filter((entry) => entry.type !== 'separator')
    .map((entry) => String(entry.label ?? ''))
    .join('\n');
  assert.match(labels, /Copy Heading 1/);
  assert.match(labels, /Cut/);
  assert.match(labels, /Paste/);
  assert.match(labels, /Bold/);
  assert.match(labels, /Delete current block/);
  assert.doesNotMatch(labels, CJK_PATTERN);

  const tableEntries = buildEditorContextMenuEntries(
    editor,
    { ...context, inTable: true },
    en,
  ) as Array<Record<string, unknown>>;
  const tableLabels = tableEntries
    .filter((entry) => entry.type !== 'separator')
    .map((entry) => String(entry.label ?? ''))
    .join('\n');
  assert.match(tableLabels, /Insert row above/);
  assert.match(tableLabels, /Insert column left/);
  assert.match(tableLabels, /Merge cells/);
  assert.match(tableLabels, /Delete table/);
  assert.doesNotMatch(tableLabels, CJK_PATTERN);

  const zhEntries = buildEditorContextMenuEntries(editor, context, zh) as Array<Record<string, unknown>>;
  const zhLabels = zhEntries
    .filter((entry) => entry.type !== 'separator')
    .map((entry) => String(entry.label ?? ''))
    .join('\n');
  assert.match(zhLabels, /复制标题 1/);
  assert.match(zhLabels, /剪切/);
});

test('NotesGraphView health badges render English labels under en-US', async () => {
  const now = Date.now();
  const notes = [
    {
      id: 'orphan-note',
      paperId: 'global-notes',
      type: 'standalone',
      title: '',
      contentText: '',
      tags: [],
      folderId: null,
      linkedNoteIds: [],
      linkedPaperIds: [],
      updatedAt: 0,
    },
    {
      id: 'broken-link-note',
      paperId: 'global-notes',
      type: 'standalone',
      title: 'Broken link note',
      contentText: '',
      tags: ['x'],
      folderId: 'folder-1',
      linkedNoteIds: ['missing-note'],
      linkedPaperIds: [],
      updatedAt: now,
    },
  ];

  const mounted = await mountComponent(
    notesGraphModule,
    'NotesGraphView',
    { notes, folders: [], onOpenNote() {} },
    'en-US',
  );

  try {
    const text = mounted.container.textContent ?? '';
    assert.doesNotMatch(text, CJK_PATTERN);
    assert.match(text, /Orphaned/);
    assert.match(text, /Broken links/);
    assert.match(text, /Untitled/);
    assert.match(text, /Untagged/);
    assert.match(text, /Stale/);
    assert.doesNotMatch(collectAttributeText(mounted.container), CJK_PATTERN);
  } finally {
    await mounted.unmount();
  }
});
