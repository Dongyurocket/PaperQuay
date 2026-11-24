import type { Editor, JSONContent } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import type { Note, NoteAnchor, NotePageKind } from '../../types/notes';
import type { UiLanguage } from '../../types/reader';
import { collectText, noteContentToTiptap } from './notesTiptap.ts';

export interface NoteTemplate {
  id: string;
  label: string;
  labelEn: string;
  description: string;
  descriptionEn: string;
  content: JSONContent[];
  /** 英文界面插入的正文；与 content 结构一一对应。 */
  contentEn: JSONContent[];
  pageKind?: NotePageKind;
}

export interface NoteSlashCommandItem {
  id: string;
  label: string;
  labelEn?: string;
  labelZh?: string;
  description?: string;
  descriptionEn?: string;
  descriptionZh?: string;
  aliases?: string[];
}

export interface EditorSnapshot {
  contentJson: JSONContent;
  contentHtml: string;
  contentText: string;
  wordCount: number;
}

export interface NoteEditorDraft {
  noteId: string;
  baseUpdatedAt: number | null;
  savedSignature: string;
  draftSignature: string;
  title: string;
  tagText: string;
  color: string;
  snapshot: EditorSnapshot;
  pendingAnchors: NoteAnchor[];
  updatedAt: number;
}


export interface NoteEditorDraftStorage {
  readonly length?: number;
  key?(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface NoteEditorDraftStoreOptions {
  /** 注入 localStorage；传 null 表示只保留进程内草稿。 */
  storage?: NoteEditorDraftStorage | null;
  maxEntries?: number;
  maxBytes?: number;
}

export interface NoteEditorDraftStore {
  read(editorSourceId: string, noteId: string): NoteEditorDraft | null;
  write(editorSourceId: string, draft: NoteEditorDraft): void;
  clear(editorSourceId: string, noteId: string): void;
}

export const NOTE_EDITOR_DRAFT_STORAGE_PREFIX = 'paperquay.note-editor-draft.v1:';
// 草稿是崩溃/退出兜底，不是笔记仓库：按条目数和总字节双上限淘汰最旧草稿。
// 落盘时省略 contentHtml（见 write），8 张 256KB 截图的正文 JSON 仍能放进 4MiB。
export const NOTE_EDITOR_DRAFT_MAX_ENTRIES = 20;
export const NOTE_EDITOR_DRAFT_MAX_BYTES = 4 * 1024 * 1024;

interface PersistedDraftMeta {
  bytes: number;
  updatedAt: number;
  sequence: number;
}

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneEditorSnapshot(snapshot: EditorSnapshot): EditorSnapshot {
  return {
    contentJson: cloneJsonValue(snapshot.contentJson),
    contentHtml: snapshot.contentHtml,
    contentText: snapshot.contentText,
    wordCount: snapshot.wordCount,
  };
}

function cloneNoteEditorDraft(draft: NoteEditorDraft): NoteEditorDraft {
  return {
    ...draft,
    snapshot: cloneEditorSnapshot(draft.snapshot),
    pendingAnchors: cloneJsonValue(draft.pendingAnchors),
  };
}

function isNoteEditorDraftRecord(value: unknown, noteId: string): value is NoteEditorDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<NoteEditorDraft>;
  return (
    draft.noteId === noteId &&
    typeof draft.title === 'string' &&
    typeof draft.tagText === 'string' &&
    typeof draft.color === 'string' &&
    typeof draft.updatedAt === 'number' &&
    Boolean(draft.snapshot) &&
    typeof draft.snapshot === 'object' &&
    Boolean(draft.snapshot?.contentJson) &&
    Array.isArray(draft.pendingAnchors)
  );
}

function detectNoteEditorDraftStorage(): NoteEditorDraftStorage | null {
  try {
    const storage = globalThis.localStorage;
    if (
      !storage ||
      typeof storage.getItem !== 'function' ||
      typeof storage.setItem !== 'function' ||
      typeof storage.removeItem !== 'function'
    ) {
      return null;
    }
    return storage;
  } catch {
    return null;
  }
}

function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  const message = (error as { message?: unknown }).message;
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    (typeof message === 'string' && /quota/i.test(message))
  );
}

export function createNoteEditorDraftStore(
  options: NoteEditorDraftStoreOptions = {},
): NoteEditorDraftStore {
  const storage = options.storage === undefined ? detectNoteEditorDraftStorage() : options.storage;
  const maxEntries = Math.max(0, Math.floor(options.maxEntries ?? NOTE_EDITOR_DRAFT_MAX_ENTRIES));
  const maxBytes = Math.max(0, Math.floor(options.maxBytes ?? NOTE_EDITOR_DRAFT_MAX_BYTES));
  const memory = new Map<string, NoteEditorDraft>();
  const persisted = new Map<string, PersistedDraftMeta>();
  let persistedBytes = 0;
  let nextSequence = 0;

  // 只扫描键名与大小，草稿正文在首次读取时再解析。
  if (storage) {
    try {
      const total = storage.length ?? 0;
      for (let index = 0; index < total; index += 1) {
        const storageKey = storage.key?.(index) ?? null;
        if (!storageKey || !storageKey.startsWith(NOTE_EDITOR_DRAFT_STORAGE_PREFIX)) continue;
        const serialized = storage.getItem(storageKey);
        if (typeof serialized !== 'string') continue;
        persisted.set(storageKey, { bytes: serialized.length, updatedAt: -1, sequence: nextSequence });
        nextSequence += 1;
        persistedBytes += serialized.length;
      }
    } catch {
      // 隐私模式或存储被禁用：本次会话只用内存草稿。
    }
  }

  function removePersisted(storageKey: string): void {
    const meta = persisted.get(storageKey);
    if (meta) {
      persistedBytes = Math.max(0, persistedBytes - meta.bytes);
      persisted.delete(storageKey);
    }
    try {
      storage?.removeItem(storageKey);
    } catch {}
  }

  function evictPersisted(exceptKey?: string): boolean {
    let oldestKey: string | null = null;
    let oldest: PersistedDraftMeta | null = null;
    for (const [candidateKey, meta] of persisted) {
      if (candidateKey === exceptKey) continue;
      if (
        !oldest ||
        meta.updatedAt < oldest.updatedAt ||
        (meta.updatedAt === oldest.updatedAt && meta.sequence < oldest.sequence)
      ) {
        oldestKey = candidateKey;
        oldest = meta;
      }
    }
    if (!oldestKey) return false;
    removePersisted(oldestKey);
    return true;
  }

  function evictMemory(keepKey?: string): void {
    while (memory.size > maxEntries) {
      let oldestKey: string | null = null;
      let oldestUpdatedAt = Number.POSITIVE_INFINITY;
      for (const [candidateKey, candidate] of memory) {
        if (candidateKey === keepKey) continue;
        if (candidate.updatedAt < oldestUpdatedAt) {
          oldestUpdatedAt = candidate.updatedAt;
          oldestKey = candidateKey;
        }
      }
      if (!oldestKey) break;
      memory.delete(oldestKey);
    }
  }

  function persist(draftKey: string, serialized: string, updatedAt: number): void {
    if (!storage) return;
    const storageKey = `${NOTE_EDITOR_DRAFT_STORAGE_PREFIX}${draftKey}`;

    if (maxEntries <= 0 || maxBytes <= 0 || serialized.length > maxBytes) {
      removePersisted(storageKey);
      return;
    }

    const previousBytes = persisted.get(storageKey)?.bytes ?? 0;
    while (persisted.size + (persisted.has(storageKey) ? 0 : 1) > maxEntries) {
      if (!evictPersisted(storageKey)) break;
    }
    while (persistedBytes - previousBytes + serialized.length > maxBytes) {
      if (!evictPersisted(storageKey)) break;
    }

    try {
      storage.setItem(storageKey, serialized);
    } catch (error) {
      if (!isQuotaError(error)) {
        // 存储不可用时不牺牲其他草稿；本会话继续用内存副本。
        return;
      }
      let written = false;
      while (evictPersisted(storageKey)) {
        try {
          storage.setItem(storageKey, serialized);
          written = true;
          break;
        } catch {}
      }
      if (!written) {
        removePersisted(storageKey);
        return;
      }
    }

    persisted.set(storageKey, { bytes: serialized.length, updatedAt, sequence: nextSequence });
    nextSequence += 1;
    persistedBytes = Math.max(0, persistedBytes - previousBytes) + serialized.length;
  }

  return {
    read(editorSourceId: string, noteId: string): NoteEditorDraft | null {
      const draftKey = buildNoteEditorDraftKey(editorSourceId, noteId);
      const cached = memory.get(draftKey);
      if (cached) return cloneNoteEditorDraft(cached);
      if (!storage) return null;

      const storageKey = `${NOTE_EDITOR_DRAFT_STORAGE_PREFIX}${draftKey}`;
      let serialized: string | null = null;
      try {
        serialized = storage.getItem(storageKey);
      } catch {
        return null;
      }
      if (!serialized) return null;

      let parsed: unknown;
      try {
        parsed = JSON.parse(serialized);
      } catch {
        removePersisted(storageKey);
        return null;
      }
      if (!isNoteEditorDraftRecord(parsed, noteId)) {
        removePersisted(storageKey);
        return null;
      }

      const draft = cloneNoteEditorDraft(parsed);
      memory.set(draftKey, draft);
      evictMemory(draftKey);
      const meta = persisted.get(storageKey);
      if (meta) meta.updatedAt = draft.updatedAt;
      return cloneNoteEditorDraft(draft);
    },

    write(editorSourceId: string, draft: NoteEditorDraft): void {
      const draftKey = buildNoteEditorDraftKey(editorSourceId, draft.noteId);
      const cloned = cloneNoteEditorDraft(draft);
      memory.set(draftKey, cloned);
      evictMemory(draftKey);
      if (!storage) return;

      let serialized: string;
      try {
        // contentHtml 只是渲染副本，恢复草稿走 contentJson；它会把每张截图的
        // data URL 再复制一遍，8×256KB 截图会因此超过单条上限而整个草稿丢失。
        serialized = JSON.stringify({
          ...cloned,
          snapshot: { ...cloned.snapshot, contentHtml: '' },
        });
      } catch {
        return;
      }
      persist(draftKey, serialized, cloned.updatedAt);
    },

    clear(editorSourceId: string, noteId: string): void {
      const draftKey = buildNoteEditorDraftKey(editorSourceId, noteId);
      memory.delete(draftKey);
      removePersisted(`${NOTE_EDITOR_DRAFT_STORAGE_PREFIX}${draftKey}`);
    },
  };
}

let defaultNoteEditorDraftStore: NoteEditorDraftStore | null = null;

function getDefaultNoteEditorDraftStore(): NoteEditorDraftStore {
  if (!defaultNoteEditorDraftStore) {
    defaultNoteEditorDraftStore = createNoteEditorDraftStore();
  }
  return defaultNoteEditorDraftStore;
}

export function buildNoteEditorDraftKey(editorSourceId: string, noteId: string): string {
  return `${editorSourceId}::${noteId}`;
}

export function readNoteEditorDraft(
  editorSourceId: string,
  noteId: string,
): NoteEditorDraft | null {
  return getDefaultNoteEditorDraftStore().read(editorSourceId, noteId);
}

export function writeNoteEditorDraft(
  editorSourceId: string,
  draft: NoteEditorDraft,
): void {
  getDefaultNoteEditorDraftStore().write(editorSourceId, draft);
}

export function clearNoteEditorDraft(
  editorSourceId: string,
  noteId: string,
): void {
  getDefaultNoteEditorDraftStore().clear(editorSourceId, noteId);
}

export function paragraphNode(text = ''): JSONContent {
  return text
    ? { type: 'paragraph', content: [{ type: 'text', text }] }
    : { type: 'paragraph' };
}

export function headingNode(level: 1 | 2 | 3, text: string): JSONContent {
  return {
    type: 'heading',
    attrs: { level },
    content: [{ type: 'text', text }],
  };
}

export function bulletListNode(items: string[]): JSONContent {
  return {
    type: 'bulletList',
    content: items.map((item) => ({
      type: 'listItem',
      content: [paragraphNode(item)],
    })),
  };
}

export function taskListNode(items: string[]): JSONContent {
  return {
    type: 'taskList',
    content: items.map((item) => ({
      type: 'taskItem',
      attrs: { checked: false },
      content: [paragraphNode(item)],
    })),
  };
}

export function componentBlockNode(title = 'Component'): JSONContent {
  return {
    type: 'noteComponentBlock',
    attrs: { title, variant: 'note' },
    content: [paragraphNode()],
  };
}

export function normalizeAnchorPageLabel(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  const pageMatch = normalized.match(/\bP\s*(\d+)\b/i);

  if (pageMatch) return `P${pageMatch[1]}`;
  return normalized || '定位';
}

export function normalizeAnchorSourceTitle(sourceTitle: string, sourceLabel: string): string {
  const explicitTitle = sourceTitle.replace(/\s+/g, ' ').trim();
  if (
    explicitTitle &&
    !/^PDF\b/i.test(explicitTitle) &&
    !/^P\s*\d+\b/i.test(explicitTitle) &&
    !/^(摘录|正文摘录|引用摘录)$/u.test(explicitTitle)
  ) {
    return explicitTitle;
  }

  const legacyLabel = sourceLabel.replace(/\s+/g, ' ').trim();
  if (!legacyLabel) return '文献';
  if (/^PDF\b/i.test(legacyLabel)) return '文献';
  if (/^P\s*\d+\b/i.test(legacyLabel)) return '文献';
  if (/^(摘录|正文摘录|引用摘录)$/u.test(legacyLabel)) return '文献';

  return legacyLabel;
}

interface TemplateText {
  zh: string;
  en: string;
}

type TemplateBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: TemplateText }
  | { type: 'paragraph'; text?: TemplateText }
  | { type: 'bullets'; items: TemplateText[] }
  | { type: 'tasks'; items: TemplateText[] };

// 模板正文是中英成对的文档数据：content 保持既有中文输出，contentEn 供英文界面插入。
function templateNodes(blocks: TemplateBlock[], locale: keyof TemplateText): JSONContent[] {
  return blocks.map((block) => {
    if (block.type === 'heading') return headingNode(block.level, block.text[locale]);
    if (block.type === 'paragraph') return paragraphNode(block.text?.[locale] ?? '');
    if (block.type === 'bullets') return bulletListNode(block.items.map((item) => item[locale]));
    return taskListNode(block.items.map((item) => item[locale]));
  });
}

function templateContent(blocks: TemplateBlock[]): Pick<NoteTemplate, 'content' | 'contentEn'> {
  return {
    content: templateNodes(blocks, 'zh'),
    contentEn: templateNodes(blocks, 'en'),
  };
}

function templateCopy(
  label: TemplateText,
  description: TemplateText,
): Pick<NoteTemplate, 'label' | 'labelEn' | 'description' | 'descriptionEn'> {
  return {
    label: label.zh,
    labelEn: label.en,
    description: description.zh,
    descriptionEn: description.en,
  };
}

export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: 'literature-review',
    ...templateCopy(
      { zh: '文献阅读', en: 'Literature review' },
      { zh: '问题、方法、实验、结论', en: 'Question, method, experiments, conclusions' },
    ),
    ...templateContent([
      { type: 'heading', level: 2, text: { zh: '研究问题', en: 'Research question' } },
      { type: 'paragraph' },
      { type: 'heading', level: 2, text: { zh: '核心方法', en: 'Core method' } },
      {
        type: 'bullets',
        items: [
          { zh: '方法假设', en: 'Method assumptions' },
          { zh: '关键模块', en: 'Key modules' },
          { zh: '与已有工作的差异', en: 'Differences from prior work' },
        ],
      },
      { type: 'heading', level: 2, text: { zh: '实验与结果', en: 'Experiments and results' } },
      { type: 'paragraph' },
      { type: 'heading', level: 2, text: { zh: '我的判断', en: 'My take' } },
      {
        type: 'tasks',
        items: [
          { zh: '需要复查的公式或实验', en: 'Formulas or experiments to recheck' },
          { zh: '可以复用的思路', en: 'Ideas worth reusing' },
        ],
      },
    ]),
  },
  {
    id: 'method-analysis',
    ...templateCopy(
      { zh: '方法拆解', en: 'Method breakdown' },
      { zh: '输入、流程、输出、限制', en: 'Inputs, pipeline, outputs, limitations' },
    ),
    ...templateContent([
      { type: 'heading', level: 2, text: { zh: '方法目标', en: 'Method goal' } },
      { type: 'paragraph' },
      { type: 'heading', level: 2, text: { zh: '流程拆解', en: 'Pipeline breakdown' } },
      {
        type: 'bullets',
        items: [
          { zh: '输入', en: 'Inputs' },
          { zh: '中间表示', en: 'Intermediate representation' },
          { zh: '优化目标', en: 'Optimization objective' },
          { zh: '输出', en: 'Outputs' },
        ],
      },
      { type: 'heading', level: 2, text: { zh: '适用边界', en: 'Scope and boundaries' } },
      { type: 'paragraph' },
      { type: 'heading', level: 2, text: { zh: '可迁移点', en: 'Transferable ideas' } },
      { type: 'paragraph' },
    ]),
  },
  {
    id: 'experiment-note',
    ...templateCopy(
      { zh: '实验记录', en: 'Experiment log' },
      { zh: '设置、变量、观察、下一步', en: 'Setup, variables, observations, next steps' },
    ),
    ...templateContent([
      { type: 'heading', level: 2, text: { zh: '实验设置', en: 'Experiment setup' } },
      {
        type: 'bullets',
        items: [
          { zh: '数据集', en: 'Datasets' },
          { zh: '基线', en: 'Baselines' },
          { zh: '评价指标', en: 'Metrics' },
          { zh: '关键参数', en: 'Key hyperparameters' },
        ],
      },
      { type: 'heading', level: 2, text: { zh: '观察结果', en: 'Observations' } },
      { type: 'paragraph' },
      { type: 'heading', level: 2, text: { zh: '异常与解释', en: 'Anomalies and explanations' } },
      { type: 'paragraph' },
      { type: 'heading', level: 2, text: { zh: '下一步', en: 'Next steps' } },
      {
        type: 'tasks',
        items: [
          { zh: '补充对照实验', en: 'Add control experiments' },
          { zh: '检查失败样例', en: 'Inspect failure cases' },
          { zh: '整理图表', en: 'Tidy up figures' },
        ],
      },
    ]),
  },
  {
    id: 'qa-summary',
    ...templateCopy(
      { zh: '问答整理', en: 'Q&A summary' },
      { zh: '问题、回答、证据、结论', en: 'Questions, answers, evidence, conclusions' },
    ),
    ...templateContent([
      { type: 'heading', level: 2, text: { zh: '问题', en: 'Question' } },
      { type: 'paragraph' },
      { type: 'heading', level: 2, text: { zh: '回答摘要', en: 'Answer summary' } },
      { type: 'paragraph' },
      { type: 'heading', level: 2, text: { zh: '证据位置', en: 'Evidence locations' } },
      {
        type: 'bullets',
        items: [
          { zh: 'PDF 页码或摘录', en: 'PDF pages or excerpts' },
          { zh: '相关图表', en: 'Related figures and tables' },
          { zh: '相关公式', en: 'Related equations' },
        ],
      },
      { type: 'heading', level: 2, text: { zh: '后续追问', en: 'Follow-up questions' } },
      {
        type: 'tasks',
        items: [
          { zh: '确认原文表述', en: 'Verify the original wording' },
          { zh: '补充相关论文', en: 'Add related papers' },
        ],
      },
    ]),
    pageKind: 'qa',
  },
  // 以下模板对应 docs/notes-charter.md 的页面类型（page types）。
  {
    id: 'paper-card',
    ...templateCopy(
      { zh: '论文卡片', en: 'Paper card' },
      { zh: '一页文献档案：问题、方法、实验、我的判断', en: 'One-page paper profile: question, method, experiments, my take' },
    ),
    ...templateContent([
      { type: 'heading', level: 2, text: { zh: '一句话总结', en: 'One-sentence summary' } },
      { type: 'paragraph' },
      { type: 'heading', level: 2, text: { zh: '研究问题', en: 'Research question' } },
      { type: 'paragraph' },
      { type: 'heading', level: 2, text: { zh: '核心方法', en: 'Core method' } },
      {
        type: 'bullets',
        items: [
          { zh: '方法假设', en: 'Method assumptions' },
          { zh: '关键模块', en: 'Key modules' },
          { zh: '与已有工作的差异', en: 'Differences from prior work' },
        ],
      },
      { type: 'heading', level: 2, text: { zh: '实验与结果', en: 'Experiments and results' } },
      { type: 'paragraph' },
      { type: 'heading', level: 2, text: { zh: '局限与风险', en: 'Limitations and risks' } },
      { type: 'paragraph' },
      { type: 'heading', level: 2, text: { zh: '我的判断', en: 'My take' } },
      { type: 'paragraph' },
    ]),
    pageKind: 'paper-card',
  },
  {
    id: 'concept',
    ...templateCopy(
      { zh: '概念页', en: 'Concept page' },
      { zh: '一个概念/方法的定义、直觉、边界', en: 'Definition, intuition and boundaries of a concept or method' },
    ),
    ...templateContent([
      { type: 'heading', level: 2, text: { zh: '定义', en: 'Definition' } },
      { type: 'paragraph' },
      { type: 'heading', level: 2, text: { zh: '直觉理解', en: 'Intuition' } },
      { type: 'paragraph' },
      { type: 'heading', level: 2, text: { zh: '关键性质', en: 'Key properties' } },
      {
        type: 'bullets',
        items: [
          { zh: '性质一', en: 'Property one' },
          { zh: '性质二', en: 'Property two' },
        ],
      },
      { type: 'heading', level: 2, text: { zh: '适用边界', en: 'Scope and boundaries' } },
      { type: 'paragraph' },
      { type: 'heading', level: 2, text: { zh: '相关概念', en: 'Related concepts' } },
      { type: 'bullets', items: [{ zh: '[[相关概念]]（用双链）', en: '[[Related concept]] (use wiki links)' }] },
    ]),
    pageKind: 'concept',
  },
  {
    id: 'synthesis',
    ...templateCopy(
      { zh: '综述页', en: 'Synthesis page' },
      { zh: '跨文献比较、归纳、研究脉络', en: 'Cross-paper comparison, synthesis and research threads' },
    ),
    ...templateContent([
      { type: 'heading', level: 2, text: { zh: '主题与范围', en: 'Theme and scope' } },
      { type: 'paragraph' },
      { type: 'heading', level: 2, text: { zh: '代表工作', en: 'Representative work' } },
      { type: 'bullets', items: [{ zh: '用 / 插入文献引用（paper reference）', en: 'Use / to insert a paper reference' }] },
      { type: 'heading', level: 2, text: { zh: '横向比较', en: 'Cross-paper comparison' } },
      { type: 'paragraph' },
      { type: 'heading', level: 2, text: { zh: '共识与分歧', en: 'Consensus and disagreements' } },
      { type: 'paragraph' },
      { type: 'heading', level: 2, text: { zh: '开放问题', en: 'Open questions' } },
      { type: 'bullets', items: [{ zh: '尚未解决的问题', en: 'Unresolved questions' }] },
    ]),
    pageKind: 'synthesis',
  },
  {
    id: 'excerpt-card',
    ...templateCopy(
      { zh: '摘录卡', en: 'Excerpt card' },
      { zh: '提炼式摘录：来源锚点保真、正文自由改写', en: 'Distilled excerpt: source anchors stay intact, body can be rewritten' },
    ),
    ...templateContent([
      { type: 'heading', level: 2, text: { zh: '来源', en: 'Source' } },
      {
        type: 'paragraph',
        text: {
          zh: '（用 / 插入文献引用或摘录锚点；锚点不可手改）',
          en: '(Use / to insert a paper reference or excerpt anchor; anchors cannot be edited by hand)',
        },
      },
      { type: 'heading', level: 2, text: { zh: '提炼', en: 'Distillation' } },
      {
        type: 'paragraph',
        text: {
          zh: '（用自己的话重写要点，可自由改写）',
          en: '(Rewrite the key points in your own words; free editing is allowed)',
        },
      },
      { type: 'heading', level: 2, text: { zh: '原文快照', en: 'Original snapshot' } },
      {
        type: 'paragraph',
        text: {
          zh: '（如保留原文，放在此处且不再修改）',
          en: '(If you keep the original text, place it here and do not modify it)',
        },
      },
      { type: 'heading', level: 2, text: { zh: '我的推断', en: 'My inference' } },
      {
        type: 'paragraph',
        text: {
          zh: '（非原文主张的推断须写在这里）',
          en: '(Inferences not claimed by the source must go here)',
        },
      },
    ]),
    pageKind: 'excerpt',
  },
  {
    id: 'index-page',
    ...templateCopy(
      { zh: '索引页', en: 'Index page' },
      { zh: '主题入口：双链目录，少写正文', en: 'Topic entry point: a wiki-link directory with minimal prose' },
    ),
    ...templateContent([
      { type: 'heading', level: 2, text: { zh: '核心概念', en: 'Core concepts' } },
      { type: 'bullets', items: [{ zh: '[[概念页标题]]', en: '[[Concept page title]]' }] },
      { type: 'heading', level: 2, text: { zh: '论文卡片', en: 'Paper cards' } },
      { type: 'bullets', items: [{ zh: '[[论文卡片标题]]', en: '[[Paper card title]]' }] },
      { type: 'heading', level: 2, text: { zh: '待办', en: 'To do' } },
      { type: 'tasks', items: [{ zh: '待整理的笔记', en: 'Notes to organize' }] },
    ]),
    pageKind: 'index',
  },
  {
    id: 'research-log',
    ...templateCopy(
      { zh: '研究日志', en: 'Research log' },
      { zh: '按日期推进的实验/阅读日志', en: 'Dated log of experiments and reading' },
    ),
    ...templateContent([
      { type: 'heading', level: 2, text: { zh: 'YYYY-MM-DD', en: 'YYYY-MM-DD' } },
      {
        type: 'bullets',
        items: [
          { zh: '今天做了什么', en: 'What I did today' },
          { zh: '观察到什么', en: 'What I observed' },
          { zh: '卡在哪里', en: 'Where I got stuck' },
        ],
      },
      { type: 'heading', level: 2, text: { zh: '下一步', en: 'Next steps' } },
      { type: 'tasks', items: [{ zh: '明天第一件事', en: 'First thing tomorrow' }] },
    ]),
    pageKind: 'log',
  },
  {
    id: 'overview-page',
    ...templateCopy(
      { zh: '总览页', en: 'Overview page' },
      { zh: '全局研究状态：进行中、待读、待写', en: 'Overall research status: in progress, to read, to write' },
    ),
    ...templateContent([
      { type: 'heading', level: 2, text: { zh: '进行中的问题', en: 'Active questions' } },
      { type: 'bullets', items: [{ zh: '当前主攻问题', en: 'Current main question' }] },
      { type: 'heading', level: 2, text: { zh: '待读', en: 'To read' } },
      { type: 'tasks', items: [{ zh: '待读论文', en: 'Papers to read' }] },
      { type: 'heading', level: 2, text: { zh: '待写', en: 'To write' } },
      { type: 'tasks', items: [{ zh: '计划产出', en: 'Planned outputs' }] },
      { type: 'heading', level: 2, text: { zh: '本周进展', en: "This week's progress" } },
      { type: 'paragraph' },
    ]),
    pageKind: 'overview',
  },
];

/** 按界面语言选择模板正文；未知语言或缺少英文正文时回退中文，保持旧输出不变。 */
export function templateContentForLocale(
  template: NoteTemplate,
  locale: UiLanguage | null | undefined,
): JSONContent[] {
  return locale === 'en-US' && template.contentEn?.length > 0
    ? template.contentEn
    : template.content;
}

export const BASE_SLASH_COMMANDS: NoteSlashCommandItem[] = [
  { id: 'paragraph', label: 'Paragraph', labelZh: '正文', description: 'Plain text block', descriptionZh: '纯文本段落', aliases: ['text', 'p'] },
  { id: 'heading-1', label: 'Heading 1', labelZh: '一级标题', description: 'Large section title', descriptionZh: '大节标题', aliases: ['h1', 'title'] },
  { id: 'heading-2', label: 'Heading 2', labelZh: '二级标题', description: 'Medium section title', descriptionZh: '中节标题', aliases: ['h2', 'subtitle'] },
  { id: 'heading-3', label: 'Heading 3', labelZh: '三级标题', description: 'Small section title', descriptionZh: '小节标题', aliases: ['h3'] },
  { id: 'bullet-list', label: 'Bullet list', labelZh: '无序列表', description: 'Unordered list', descriptionZh: '项目符号列表', aliases: ['ul', 'list'] },
  { id: 'ordered-list', label: 'Ordered list', labelZh: '有序列表', description: 'Numbered list', descriptionZh: '编号列表', aliases: ['ol', 'number'] },
  { id: 'task-list', label: 'Task list', labelZh: '任务列表', description: 'Checklist with tasks', descriptionZh: '带勾选框的任务清单', aliases: ['todo', 'check'] },
  { id: 'quote', label: 'Quote', labelZh: '引用', description: 'Quoted or extracted text', descriptionZh: '引用或摘录文本', aliases: ['blockquote', 'cite'] },
  { id: 'code-block', label: 'Code block', labelZh: '代码块', description: 'Preformatted code block', descriptionZh: '预格式代码块', aliases: ['code', 'pre'] },
  { id: 'table', label: 'Table', labelZh: '表格', description: 'Insert a 3 x 3 table', descriptionZh: '插入 3×3 表格', aliases: ['grid'] },
  { id: 'component', label: 'Component block', labelZh: '组件块', description: 'Structured editable card block', descriptionZh: '结构化可编辑卡片块', aliases: ['card', 'block'] },
  { id: 'math', label: 'Math', labelZh: '公式', description: 'Inline LaTeX expression', descriptionZh: '行内 LaTeX 公式', aliases: ['formula', 'latex'] },
  { id: 'paper-reference', label: 'Paper reference', labelZh: '文献引用', description: 'Cite a library paper', descriptionZh: '引用文库中的文献', aliases: ['reference', 'cite', 'citation', 'paper', '文献', '引用'] },
  { id: 'reference-list', label: 'Reference list', labelZh: '参考文献列表', description: 'Insert or refresh the bibliography at the end', descriptionZh: '在文末插入或更新参考文献列表', aliases: ['references', 'bibliography', '参考文献'] },
  ...NOTE_TEMPLATES.map((template): NoteSlashCommandItem => ({
    id: `template:${template.id}`,
    label: template.label,
    labelEn: template.labelEn,
    description: template.description,
    descriptionEn: `Template - ${template.descriptionEn}`,
    aliases: ['template', template.id],
  })),
];

export function normalizeSuggestionQuery(query: string, triggers: string[]): string {
  let value = query.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  const sortedTriggers = [...triggers].sort((a, b) => b.length - a.length);

  let changed = true;
  while (changed) {
    changed = false;
    for (const trigger of sortedTriggers) {
      if (value.startsWith(trigger)) {
        value = value.slice(trigger.length).trimStart();
        changed = true;
      }
    }
  }

  return value.toLocaleLowerCase();
}

export function slashCommandItems(query: string): NoteSlashCommandItem[] {
  const normalized = normalizeSuggestionQuery(query, ['/']);
  if (!normalized) return BASE_SLASH_COMMANDS;

  return BASE_SLASH_COMMANDS.filter((item) => {
    const haystack = [
      item.id,
      item.label,
      item.labelEn ?? '',
      item.description ?? '',
      item.descriptionEn ?? '',
      ...(item.aliases ?? []),
    ].join(' ').toLocaleLowerCase();
    return haystack.includes(normalized);
  });
}

export function signature(value: {
  title: string;
  tagText: string;
  color: string;
  snapshot: EditorSnapshot;
}): string {
  return JSON.stringify({
    title: value.title.trim(),
    tagText: value.tagText.trim(),
    color: value.color,
    contentJson: value.snapshot.contentJson,
    contentText: value.snapshot.contentText,
  });
}

/** 廉价快照：按键期间只需要 JSON 与纯文本，不序列化 HTML。 */
export interface ContentSnapshot {
  contentJson: JSONContent;
  contentText: string;
}

/** 编辑器可读取的稳定来源；测试可注入假实现。 */
export interface EditorSnapshotSource {
  getJSON(): JSONContent;
  getText(options?: { blockSeparator?: string }): string;
  getHTML(): string;
  wordCount(): number;
}

export const NOTE_EDITOR_SNAPSHOT_THROTTLE_MS = 120;

// 有界字符串哈希：图片 base64 可能上百 KB，只哈希长度、首尾片段与若干等距中段窗口，
// 避免每次节流提交都遍历整段 data URL；普通长文本仍做全量哈希，保证段落中间的单字符
// 修改也能被签名发现。
const SIGNATURE_STRING_FULL_LIMIT = 256;
const SIGNATURE_STRING_EDGE = 64;
// 等距中段采样：等长的 data URL 只替换中段时也能改变哈希（5 个窗口含正中间）。
const SIGNATURE_STRING_SAMPLE_WINDOWS = 5;
const SIGNATURE_STRING_SAMPLE_WINDOW = 32;
const SIGNATURE_HASH_OFFSET = 2166136261;
const SIGNATURE_HASH_PRIME = 16777619;

function hashStringInto(hash: number, value: string, allowSampling = false): number {
  let result = hash >>> 0;
  const length = value.length;

  if (!allowSampling || length <= SIGNATURE_STRING_FULL_LIMIT) {
    for (let index = 0; index < length; index += 1) {
      result = Math.imul(result ^ value.charCodeAt(index), SIGNATURE_HASH_PRIME);
    }
    return result >>> 0;
  }

  result = Math.imul(result ^ length, SIGNATURE_HASH_PRIME);
  const edge = Math.min(SIGNATURE_STRING_EDGE, length);
  for (let index = 0; index < edge; index += 1) {
    result = Math.imul(result ^ value.charCodeAt(index), SIGNATURE_HASH_PRIME);
  }
  for (let index = length - edge; index < length; index += 1) {
    result = Math.imul(result ^ value.charCodeAt(index), SIGNATURE_HASH_PRIME);
  }

  const window = Math.min(SIGNATURE_STRING_SAMPLE_WINDOW, length);
  for (let sample = 1; sample <= SIGNATURE_STRING_SAMPLE_WINDOWS; sample += 1) {
    const center = Math.floor((length * sample) / (SIGNATURE_STRING_SAMPLE_WINDOWS + 1));
    const start = Math.max(0, Math.min(center - (window >> 1), length - window));
    result = Math.imul(result ^ start, SIGNATURE_HASH_PRIME);
    for (let index = start; index < start + window; index += 1) {
      result = Math.imul(result ^ value.charCodeAt(index), SIGNATURE_HASH_PRIME);
    }
  }
  return result >>> 0;
}

function hashJsonInto(hash: number, value: unknown): number {
  let result = hash >>> 0;

  if (value === null) return Math.imul(result ^ 0x01, SIGNATURE_HASH_PRIME) >>> 0;

  switch (typeof value) {
    case 'string':
      result = Math.imul(result ^ 0x02, SIGNATURE_HASH_PRIME) >>> 0;
      // 内嵌图片的 data URL 做长度+首尾+中段采样；正文文本始终全量哈希。
      return hashStringInto(result, value, value.startsWith('data:'));
    case 'number':
      result = Math.imul(result ^ 0x03, SIGNATURE_HASH_PRIME) >>> 0;
      return hashStringInto(result, String(value));
    case 'boolean':
      return Math.imul(result ^ (value ? 0x04 : 0x05), SIGNATURE_HASH_PRIME) >>> 0;
    case 'undefined':
      return Math.imul(result ^ 0x06, SIGNATURE_HASH_PRIME) >>> 0;
    default:
      break;
  }

  if (Array.isArray(value)) {
    result = Math.imul(result ^ 0x07, SIGNATURE_HASH_PRIME) >>> 0;
    result = hashStringInto(result, String(value.length));
    for (const item of value) result = hashJsonInto(result, item);
    return result >>> 0;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    result = Math.imul(result ^ 0x08, SIGNATURE_HASH_PRIME) >>> 0;
    result = hashStringInto(result, String(keys.length));
    for (const key of keys) {
      result = hashStringInto(result, key);
      result = hashJsonInto(result, record[key]);
    }
    return result >>> 0;
  }

  return Math.imul(result ^ 0x09, SIGNATURE_HASH_PRIME) >>> 0;
}

/** 稳定的内容哈希：相同 JSON 得到相同结果，不依赖 JSON.stringify 的大字符串。 */
export function contentHash(contentJson: JSONContent): string {
  return (hashJsonInto(SIGNATURE_HASH_OFFSET, contentJson) >>> 0).toString(16).padStart(8, '0');
}

/** 缓存的内容签名：两个定长哈希，元数据按键只需拼接，不再触碰正文。 */
export interface FastContentSignature {
  contentHash: string;
  textHash: string;
}

/** 只在内容 revision 变化时调用：哈希正文 JSON 与纯文本。 */
export function fastContentSignature(
  contentJson: JSONContent,
  contentText: string,
): FastContentSignature {
  return {
    contentHash: contentHash(contentJson),
    textHash: (hashStringInto(SIGNATURE_HASH_OFFSET, contentText) >>> 0).toString(16).padStart(8, '0'),
  };
}

/**
 * v3 增量签名：标题/标签/颜色 + 缓存的内容哈希 + 文本哈希。
 * 标题/标签/颜色按键复用内容签名，不重新遍历 contentJson
 * （8 张 base64 截图会 >10ms）。
 */
export function fastSignatureFromContent(
  meta: { title: string; tagText: string; color: string },
  content: FastContentSignature,
): string {
  return JSON.stringify([
    'v3',
    meta.title.trim(),
    meta.tagText.trim(),
    meta.color,
    content.contentHash,
    content.textHash,
  ]);
}

export function fastSignature(value: {
  title: string;
  tagText: string;
  color: string;
  contentJson: JSONContent;
  contentText: string;
}): string {
  return fastSignatureFromContent(
    value,
    fastContentSignature(value.contentJson, value.contentText),
  );
}

/**
 * v2 快速签名（正文文本原样保留），只用于识别升级前写入的草稿。
 * v3 把正文文本也换成哈希，字符串格式与 v2 不同。
 */
export function legacyFastSignatureV2(value: {
  title: string;
  tagText: string;
  color: string;
  contentJson: JSONContent;
  contentText: string;
}): string {
  return JSON.stringify([
    'v2',
    value.title.trim(),
    value.tagText.trim(),
    value.color,
    contentHash(value.contentJson),
    value.contentText,
  ]);
}

export function readEditorWordCount(editor: Editor): number {
  // Tiptap v3 declares CharacterCountStorage on @tiptap/core Storage via
  // module augmentation; the hoisted duplicate core types do not always see
  // it, so keep the optional runtime lookup and widen only the type here.
  return (editor.storage as Editor['storage'] & {
    characterCount?: { words?: () => number };
  }).characterCount?.words?.() ?? 0;
}

export function createEditorSnapshotSource(editor: Editor): EditorSnapshotSource {
  return {
    getJSON: () => editor.getJSON(),
    getText: (options) => editor.getText(options),
    getHTML: () => editor.getHTML(),
    wordCount: () => readEditorWordCount(editor),
  };
}

export function contentSnapshotFromSource(
  source: Pick<EditorSnapshotSource, 'getJSON' | 'getText'>,
): ContentSnapshot {
  const contentJson = source.getJSON();
  const contentText = collectText(contentJson) || source.getText({ blockSeparator: '\n\n' });
  return { contentJson, contentText };
}

export interface NoteEditorSnapshotTrackerOptions {
  /** 节流窗口，默认 120ms。 */
  intervalMs?: number;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancelSchedule?: (handle: unknown) => void;
  onCommit?: (snapshot: ContentSnapshot) => void;
}

export interface NoteEditorSnapshotTracker {
  /** onUpdate 调用：合并到当前节流窗口，不立即读取编辑器。 */
  markDirty(): void;
  hasPending(): boolean;
  /** 最近一次节流提交的廉价快照（不触发计算）。 */
  peek(): ContentSnapshot;
  /** 立即提交待处理快照（不含 HTML），用于外部更新比较。 */
  flushContent(): ContentSnapshot;
  /** 立即读取完整快照（含 HTML 与字数），用于保存/草稿/切换笔记。 */
  flush(): EditorSnapshot;
  dispose(): void;
}

type ScheduleHandle = unknown;

export function createNoteEditorSnapshotTracker(
  source: EditorSnapshotSource,
  options: NoteEditorSnapshotTrackerOptions = {},
): NoteEditorSnapshotTracker {
  const intervalMs = Math.max(0, Math.floor(options.intervalMs ?? NOTE_EDITOR_SNAPSHOT_THROTTLE_MS));
  const schedule = options.schedule
    ?? ((callback: () => void, delayMs: number) => globalThis.setTimeout(callback, delayMs));
  const cancelSchedule = options.cancelSchedule
    ?? ((handle: ScheduleHandle) => globalThis.clearTimeout(handle as Parameters<typeof globalThis.clearTimeout>[0]));

  let content = contentSnapshotFromSource(source);
  let pending = false;
  let timer: ScheduleHandle | null = null;
  let disposed = false;

  const commitPending = (): boolean => {
    if (timer !== null) {
      cancelSchedule(timer);
      timer = null;
    }
    if (!pending || disposed) return false;
    pending = false;
    content = contentSnapshotFromSource(source);
    options.onCommit?.(content);
    return true;
  };

  return {
    markDirty() {
      if (disposed) return;
      pending = true;
      if (timer === null) {
        timer = schedule(() => {
          timer = null;
          commitPending();
        }, intervalMs);
      }
    },

    hasPending() {
      return pending;
    },

    peek() {
      return content;
    },

    flushContent() {
      if (disposed) return content;
      commitPending();
      return content;
    },

    flush() {
      if (timer !== null) {
        cancelSchedule(timer);
        timer = null;
      }
      const hadPending = pending;
      pending = false;
      content = contentSnapshotFromSource(source);
      // 冲刷掉的挂起改动要同步推进 revision：按键签名缓存只在 revision 变化时重算，
      // 否则 flush 消费掉 pending 后 dirty 会一直停在 false，草稿判断随之失真。
      if (hadPending) options.onCommit?.(content);
      return {
        contentJson: content.contentJson,
        contentHtml: source.getHTML(),
        contentText: content.contentText,
        wordCount: source.wordCount(),
      };
    },

    dispose() {
      disposed = true;
      if (timer !== null) {
        cancelSchedule(timer);
        timer = null;
      }
      pending = false;
    },
  };
}

export function snapshotFromEditor(editor: Editor): EditorSnapshot {
  const content = contentSnapshotFromSource(createEditorSnapshotSource(editor));

  return {
    contentJson: content.contentJson,
    contentHtml: editor.getHTML(),
    contentText: content.contentText,
    wordCount: readEditorWordCount(editor),
  };
}

export function snapshotFromNote(note: Note | null): EditorSnapshot {
  return {
    contentJson: noteContentToTiptap(note),
    contentHtml: note?.contentHtml ?? '',
    contentText: note?.contentText ?? note?.content ?? '',
    wordCount: note?.wordCount ?? 0,
  };
}

export function isNoteRecord(value: unknown, noteId?: string | null): value is Note {
  if (!value || typeof value !== 'object') return false;
  const note = value as Partial<Note>;
  if (typeof note.id !== 'string') return false;
  if (noteId && note.id !== noteId) return false;
  return typeof note.updatedAt === 'number';
}

export function mergeAnchors(baseAnchors: NoteAnchor[], extraAnchors: Iterable<NoteAnchor>): NoteAnchor[] {
  const byId = new Map<string, NoteAnchor>();

  for (const anchor of baseAnchors) byId.set(anchor.id, anchor);
  for (const anchor of extraAnchors) byId.set(anchor.id, anchor);

  return Array.from(byId.values());
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name);
}

export function getImageFilesFromDataTransfer(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];

  const files: File[] = [];
  const seen = new Set<string>();
  const addFile = (file: File | null) => {
    if (!file || !isImageFile(file)) return;
    const key = `${file.name}:${file.size}:${file.lastModified}:${file.type}`;
    if (seen.has(key)) return;
    seen.add(key);
    files.push(file);
  };

  for (const file of Array.from(data.files ?? [])) addFile(file);
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file') addFile(item.getAsFile());
  }

  return files;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read image'));
      }
    });
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Failed to read image')));
    reader.readAsDataURL(file);
  });
}

export function insertImageFilesIntoView(
  view: EditorView,
  files: File[],
  position?: number | null,
): boolean {
  const imageFiles = files.filter(isImageFile);
  const imageType = view.state.schema.nodes.image;
  if (!imageType || imageFiles.length === 0) return false;

  void (async () => {
    view.focus();
    let insertPos = typeof position === 'number' ? position : null;

    for (const file of imageFiles) {
      const src = await readFileAsDataUrl(file);
      const imageNode = imageType.create({
        src,
        alt: file.name || 'pasted image',
        title: file.name || 'pasted image',
      });
      const state = view.state;
      const tr = typeof insertPos === 'number'
        ? state.tr.insert(Math.max(0, Math.min(insertPos, state.doc.content.size)), imageNode)
        : state.tr.replaceSelectionWith(imageNode);

      view.dispatch(tr.scrollIntoView());
      if (typeof insertPos === 'number') {
        insertPos = Math.min(insertPos + imageNode.nodeSize, view.state.doc.content.size);
      }
    }
  })().catch((error) => {
    console.error('Failed to insert image into note editor.', error);
  });

  return true;
}
