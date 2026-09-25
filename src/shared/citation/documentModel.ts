/**
 * Word 文档模型 v2：存放在文档 Custom XML Part（命名空间 urn:paperquay:word:v2）里的全部引用数据。
 *
 * 与 v1（document.settings 里的 pq:citations 等键）的区别：
 *  - **自包含**：每篇被引文献的元数据快照（CitationPaperLike）随文档保存。PaperQuay 没开、
 *    换机器、文献被移出库，都能按快照在本地重新渲染；连上 PaperQuay 时再用库里的最新数据刷新快照。
 *  - **手改保护**：记录每个引用上次写入的文本与签名，刷新时能区分「需要重写」与「用户手改过」。
 *  - **单一真相是文档扫描**：Custom XML Part 不进 Word 撤销栈，用户撤销插入后 Part 里可能多出
 *    引用记录——刷新只渲染扫描到的控件，模型只当缓存用（孤立记录在 pruneModel 里清掉）。
 *
 * 纯字符串/纯数据函数，无 DOM/Node/Office 依赖，便于在 node 下单测。
 */
import { normalizeStoredCitations } from './documentTags.ts';
import { renderCitations, type CitationRenderResult } from './format.ts';
import { normalizeCitationItems, type CitationItemInput } from './numbering.ts';
import { normalizeCitationStyle, type CitationStyleId } from './styles.ts';
import { cleanPart } from './text.ts';
import type { CitationPaperLike } from './types.ts';
import {
  assignBookmarkNames,
  buildBibliographyPackage,
  buildInlineCitationPackage,
  fnv1aBase36,
} from './wordOoxml.ts';

export const DOCUMENT_MODEL_NAMESPACE = 'urn:paperquay:word:v2';
export const DOCUMENT_MODEL_SCHEMA_VERSION = 2;
/** document.settings 里只保留这一个键作快速判断（v1 文档没有或为 '1'）。 */
export const SCHEMA_VERSION_SETTING_KEY = 'pq:schemaVersion';
/** 不支持 Custom XML Part 的宿主退化为把同一份 XML 存进 document.settings 的这个键。 */
export const MODEL_FALLBACK_SETTING_KEY = 'pq:model';

export interface DocumentPrefs {
  style: CitationStyleId;
  bibliographyTitle: string;
  /** 文献表是否带标题行。 */
  bibHeading: boolean;
  /** 顺序编码制正文引用上标。 */
  superscript: boolean;
  /** GB 7714-87 标点：full 全角紧凑 / half 半角带空格。 */
  punctuation: 'full' | 'half';
  /** 正文引用与文献表条目之间的跳转链接（超链接 + 隐藏书签）。 */
  links: boolean;
  /** 著者-出版年制文献表排序：alpha（默认，按首作者）/ appearance（按出现顺序）。 */
  bibliographyOrder: 'alpha' | 'appearance';
}

export interface DocumentCitation {
  citeId: string;
  items: CitationItemInput[];
  /** 上次写入控件的显示文本；控件当前文本与它不同 = 用户手改过。 */
  lastText?: string;
  /** 上次写入内容的签名（文本 + 链接/上标形态）；变了才需要重写。 */
  lastSignature?: string;
  /** 用户选择保留手改：刷新不再覆盖，直到用户重新编辑该引用。 */
  manualText?: string;
  updatedAt: number;
}

export interface ItemSnapshot {
  paper: CitationPaperLike;
  fetchedAt: number;
  /** 最近一次向 PaperQuay 查询时库里已没有这篇文献。 */
  missing?: boolean;
}

export interface DocumentModel {
  schemaVersion: 2;
  /** 回写「本文引用过」用的稳定文档 id。 */
  documentId: string;
  /** 每次保存 +1；同一文档里出现多份 Part（中途失败）时取 rev 最大的一份。 */
  rev: number;
  prefs: DocumentPrefs;
  citations: DocumentCitation[];
  items: Record<string, ItemSnapshot>;
}

export const DEFAULT_PREFS: DocumentPrefs = {
  style: 'gbt7714',
  bibliographyTitle: '参考文献',
  bibHeading: true,
  superscript: false,
  punctuation: 'full',
  links: true,
  bibliographyOrder: 'alpha',
};

export function createDocumentId(random: () => number = Math.random): string {
  return `doc-${random().toString(16).slice(2, 10)}${Date.now().toString(16)}`;
}

export function createEmptyModel(documentId: string = createDocumentId()): DocumentModel {
  return { schemaVersion: 2, documentId, rev: 0, prefs: { ...DEFAULT_PREFS }, citations: [], items: {} };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function normalizePrefs(value: unknown): DocumentPrefs {
  const record = asRecord(value);
  return {
    style: normalizeCitationStyle(record.style),
    bibliographyTitle: cleanPart(record.bibliographyTitle) || DEFAULT_PREFS.bibliographyTitle,
    bibHeading: record.bibHeading !== false,
    superscript: record.superscript === true,
    punctuation: record.punctuation === 'half' ? 'half' : 'full',
    links: record.links !== false,
    bibliographyOrder: record.bibliographyOrder === 'appearance' ? 'appearance' : 'alpha',
  };
}

const CITE_ID_PATTERN = /^[0-9a-z]{4,32}$/;

export function normalizeModel(value: unknown): DocumentModel {
  const record = asRecord(value);
  const citations: DocumentCitation[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(record.citations) ? record.citations : []) {
    const entry = asRecord(raw);
    const citeId = cleanPart(entry.citeId).toLowerCase();
    if (!CITE_ID_PATTERN.test(citeId) || seen.has(citeId)) continue;
    const items = normalizeCitationItems(entry.items);
    if (items.length === 0) continue;
    seen.add(citeId);
    citations.push({
      citeId,
      items,
      lastText: typeof entry.lastText === 'string' ? entry.lastText : undefined,
      lastSignature: typeof entry.lastSignature === 'string' ? entry.lastSignature : undefined,
      manualText: typeof entry.manualText === 'string' ? entry.manualText : undefined,
      updatedAt: Number(entry.updatedAt) || 0,
    });
  }
  const items: Record<string, ItemSnapshot> = {};
  for (const [paperId, raw] of Object.entries(asRecord(record.items))) {
    const snapshot = asRecord(raw);
    if (!paperId || !snapshot.paper || typeof snapshot.paper !== 'object') continue;
    items[paperId] = {
      paper: snapshot.paper as CitationPaperLike,
      fetchedAt: Number(snapshot.fetchedAt) || 0,
      ...(snapshot.missing === true ? { missing: true } : {}),
    };
  }
  return {
    schemaVersion: 2,
    documentId: cleanPart(record.documentId) || createDocumentId(),
    rev: Math.max(0, Math.floor(Number(record.rev) || 0)),
    prefs: normalizePrefs(record.prefs),
    citations,
    items,
  };
}

/* ------------------------------------------------------------ XML 编解码 */

/**
 * Part 内容：`<pq:model xmlns:pq="urn:paperquay:word:v2" rev="N"><![CDATA[json]]></pq:model>`。
 * JSON 里的 `<`、`>`、`&` 转成 \u 转义，保证 CDATA 里不会出现 `]]>`，也避免个别宿主改写。
 */
export function serializeModelXml(model: DocumentModel): string {
  const json = JSON.stringify(model)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<pq:model xmlns:pq="${DOCUMENT_MODEL_NAMESPACE}" rev="${model.rev}"><![CDATA[${json}]]></pq:model>`
  );
}

export function parseModelXml(xml: unknown): DocumentModel | null {
  if (typeof xml !== 'string' || !xml.includes(DOCUMENT_MODEL_NAMESPACE)) return null;
  const match = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(xml);
  if (!match) return null;
  try {
    return normalizeModel(JSON.parse(match[1]));
  } catch {
    return null;
  }
}

/** 同一文档里有多份 Part 时取 rev 最大的一份（保存是「先加新、再删旧」，中途失败会留下两份）。 */
export function pickLatestModel(xmls: unknown[]): { model: DocumentModel | null; index: number } {
  let best: DocumentModel | null = null;
  let index = -1;
  xmls.forEach((xml, position) => {
    const model = parseModelXml(xml);
    if (model && (!best || model.rev >= best.rev)) {
      best = model;
      index = position;
    }
  });
  return { model: best, index };
}

/* ------------------------------------------------------------ v1 迁移 */

/**
 * 从 v1（0.3.x）的 document.settings 构建 v2 模型。
 * getSetting 返回 Office.context.document.settings.get(key) 的原始值。
 */
export function migrateV1Settings(getSetting: (key: string) => unknown): DocumentModel {
  const model = createEmptyModel(cleanPart(getSetting('pq:documentId')) || createDocumentId());
  const stored = normalizeStoredCitations(getSetting('pq:citations'));
  model.citations = stored.map((citation) => ({
    citeId: citation.citeId,
    items: citation.items,
    updatedAt: citation.updatedAt,
  }));
  const title = cleanPart(getSetting('pq:bibliographyTitle'));
  model.prefs = normalizePrefs({
    style: getSetting('pq:style'),
    bibliographyTitle: title || DEFAULT_PREFS.bibliographyTitle,
    bibHeading: getSetting('pq:bibHeading') !== '0',
    superscript: getSetting('pq:superscript') === '1',
    punctuation: getSetting('pq:punctuation'),
    links: getSetting('pq:crossref') !== '0',
  });
  return model;
}

/** v1 的全部设置键（迁移成功后清除，避免旧版加载项再读到过期数据）。 */
export const V1_SETTING_KEYS = [
  'pq:style',
  'pq:locale',
  'pq:citations',
  'pq:citedPaperIds',
  'pq:bibControlId',
  'pq:documentTitle',
  'pq:bibliographyTitle',
  'pq:bibHeading',
  'pq:superscript',
  'pq:punctuation',
  'pq:crossref',
] as const;

/* ------------------------------------------------------------ 模型操作 */

export function findCitation(model: DocumentModel, citeId: string): DocumentCitation | undefined {
  return model.citations.find((citation) => citation.citeId === citeId);
}

export function upsertCitation(model: DocumentModel, citation: DocumentCitation): DocumentModel {
  const citations = model.citations.filter((item) => item.citeId !== citation.citeId);
  citations.push(citation);
  return { ...model, citations };
}

export function removeCitation(model: DocumentModel, citeId: string): DocumentModel {
  return { ...model, citations: model.citations.filter((item) => item.citeId !== citeId) };
}

export function upsertSnapshots(
  model: DocumentModel,
  papers: CitationPaperLike[],
  missingIds: string[] = [],
  now: number = Date.now(),
): DocumentModel {
  const items = { ...model.items };
  for (const paper of papers) {
    const paperId = cleanPart(paper?.id);
    if (paperId) items[paperId] = { paper, fetchedAt: now };
  }
  for (const paperId of missingIds) {
    const existing = items[paperId];
    if (existing) items[paperId] = { ...existing, missing: true };
  }
  return { ...model, items };
}

/** 模型里被引用到的全部 paperId（按首次出现）。 */
export function citedPaperIds(model: DocumentModel, orderedCiteIds?: string[]): string[] {
  const order = orderedCiteIds ?? model.citations.map((citation) => citation.citeId);
  const ids: string[] = [];
  for (const citeId of order) {
    for (const item of findCitation(model, citeId)?.items ?? []) {
      if (!ids.includes(item.paperId)) ids.push(item.paperId);
    }
  }
  return ids;
}

/** 删除文档里已不存在的引用记录与不再被引用的快照（撤销、手动删除控件后）。 */
export function pruneModel(model: DocumentModel, presentCiteIds: string[]): DocumentModel {
  const present = new Set(presentCiteIds);
  const citations = model.citations.filter((citation) => present.has(citation.citeId));
  const used = new Set<string>();
  for (const citation of citations) {
    for (const item of citation.items) used.add(item.paperId);
  }
  const items: Record<string, ItemSnapshot> = {};
  for (const [paperId, snapshot] of Object.entries(model.items)) {
    if (used.has(paperId)) items[paperId] = snapshot;
  }
  return { ...model, citations, items };
}

/* ------------------------------------------------------------ 重复 citeId */

export interface DuplicateSplit {
  citeId: string;
  /** 该 citeId 在文档顺序里的第几次出现（从 0 计；第 0 次保留原 id）。 */
  occurrence: number;
  newCiteId: string;
}

/** 同一 citeId 在文档里出现多次（用户复制粘贴了引用）：第 2 次起每次分配新 citeId。 */
export function planDuplicateSplit(ordered: string[], createId: () => string): DuplicateSplit[] {
  const counts = new Map<string, number>();
  const taken = new Set(ordered);
  const plan: DuplicateSplit[] = [];
  for (const citeId of ordered) {
    const occurrence = counts.get(citeId) ?? 0;
    counts.set(citeId, occurrence + 1);
    if (occurrence === 0) continue;
    let newCiteId = createId();
    while (taken.has(newCiteId)) newCiteId = createId();
    taken.add(newCiteId);
    plan.push({ citeId, occurrence, newCiteId });
  }
  return plan;
}

/** 按拆分计划把文档顺序里的重复项换成新 id，并复制引用记录。 */
export function applyDuplicateSplit(
  model: DocumentModel,
  ordered: string[],
  plan: DuplicateSplit[],
): { model: DocumentModel; ordered: string[] } {
  if (plan.length === 0) return { model, ordered };
  const counts = new Map<string, number>();
  const nextOrdered = ordered.map((citeId) => {
    const occurrence = counts.get(citeId) ?? 0;
    counts.set(citeId, occurrence + 1);
    const hit = plan.find((entry) => entry.citeId === citeId && entry.occurrence === occurrence);
    return hit ? hit.newCiteId : citeId;
  });
  let nextModel = model;
  for (const entry of plan) {
    const source = findCitation(model, entry.citeId);
    if (!source) continue;
    nextModel = upsertCitation(nextModel, {
      citeId: entry.newCiteId,
      items: source.items.map((item) => ({ ...item })),
      updatedAt: Date.now(),
    });
  }
  return { model: nextModel, ordered: nextOrdered };
}

/* ------------------------------------------------------------ 渲染计划 */

export interface CitationOutput {
  citeId: string;
  text: string;
  /** insertOoxml 用的完整 flat-OPC 包。 */
  ooxml: string;
  signature: string;
}

export interface RenderPlan {
  render: CitationRenderResult;
  citations: CitationOutput[];
  /** 文献表包；文档里没有文献表时仍给出（插入文献表时用）。 */
  bibliographyOoxml: string;
  bibliographyText: string;
  /** 是否启用了跳转链接（需要文献表存在 + 首选项开启）。 */
  linked: boolean;
  bookmarks: Map<string, string>;
}

export interface RenderPlanOptions {
  /** 文档里是否已有（或即将有）文献表：没有文献表时正文不加链接（书签无处落点）。 */
  hasBibliography: boolean;
  bookmarkIdBase?: number;
}

export function snapshotResolver(model: DocumentModel): (paperId: string) => CitationPaperLike | undefined {
  return (paperId) => model.items[paperId]?.paper;
}

/** 按文档顺序（ordered citeIds，已去重拆分）在本地渲染全文，产出每个控件与文献表的 OOXML。 */
export function planRender(model: DocumentModel, ordered: string[], options: RenderPlanOptions): RenderPlan {
  const groups: Array<{ citeId: string; items: CitationItemInput[] }> = [];
  for (const citeId of ordered) {
    const citation = findCitation(model, citeId);
    if (citation) groups.push({ citeId, items: citation.items });
  }
  const prefs = model.prefs;
  const render = renderCitations(
    {
      style: prefs.style,
      groups,
      bibliographyTitle: prefs.bibliographyTitle,
      bibliographyOrder: prefs.bibliographyOrder,
      punctuation: prefs.punctuation,
    },
    snapshotResolver(model),
  );
  const linked = prefs.links && options.hasBibliography && render.entries.length > 0;
  const bookmarks = linked
    ? assignBookmarkNames(render.entries.map((entry) => entry.paperId))
    : new Map<string, string>();
  const superscript = prefs.superscript && render.kind === 'numeric';
  const citations: CitationOutput[] = [];
  for (const group of render.groups) {
    if (!group.citeId) continue;
    const ooxml = buildInlineCitationPackage(group.segments, { bookmarks, superscript });
    citations.push({ citeId: group.citeId, text: group.inline, ooxml, signature: fnv1aBase36(ooxml) });
  }
  const bibliographyOoxml = buildBibliographyPackage(render.entries, {
    kind: render.kind,
    heading: prefs.bibHeading,
    title: prefs.bibliographyTitle,
    bookmarks,
    bookmarkIdBase: options.bookmarkIdBase,
  });
  const lines = render.entries.map((entry) =>
    render.kind === 'numeric' ? `[${entry.seq}] ${entry.text}` : entry.text,
  );
  const bibliographyText = [...(prefs.bibHeading ? [prefs.bibliographyTitle] : []), ...lines].join('\n');
  return { render, citations, bibliographyOoxml, bibliographyText, linked, bookmarks };
}

/* ------------------------------------------------------------ 差量 */

/** Word 读回的控件文本会把段落/软回车等变成空白，比较前统一规整（含零宽空格、不换行空格、全角空格）。 */
const INVISIBLE_SPACES = new RegExp(`[${String.fromCharCode(0x200b, 0xa0, 0x3000)}]`, 'g');

export function normalizeControlText(value: unknown): string {
  return String(value ?? '')
    .replace(INVISIBLE_SPACES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ManualEdit {
  citeId: string;
  currentText: string;
  expectedText: string;
}

export interface CitationDiff {
  /** 需要重写的 citeId（内容/形态变化，或控件当前文本与应有文本不一致且不是手改）。 */
  rewrite: string[];
  /** 用户手改过、且尚未决定「保留/覆盖」的引用。 */
  manualEdits: ManualEdit[];
  /** 用户已选择保留手改、本次跳过的 citeId。 */
  kept: string[];
  /** 内容与形态都没变、本次不碰的 citeId。 */
  unchanged: string[];
}

/**
 * 比较「上次写入」「控件当前」「本次应写入」三方：
 *  - 已记录 manualText 且当前仍等于它 → 保留跳过；
 *  - 当前 ≠ 上次写入（且上次写入已知）且 ≠ 应写入 → 用户手改，交给用户决定；
 *  - 签名变化或当前 ≠ 应写入 → 重写；
 *  - 都一致 → 不碰文档（减少修订标记与光标跳动）。
 */
export function diffRender(
  model: DocumentModel,
  currentTexts: Map<string, string>,
  outputs: CitationOutput[],
): CitationDiff {
  const diff: CitationDiff = { rewrite: [], manualEdits: [], kept: [], unchanged: [] };
  for (const output of outputs) {
    const citation = findCitation(model, output.citeId);
    const current = normalizeControlText(currentTexts.get(output.citeId));
    const expected = normalizeControlText(output.text);
    const last = citation?.lastText !== undefined ? normalizeControlText(citation.lastText) : undefined;
    if (citation?.manualText !== undefined && current === normalizeControlText(citation.manualText)) {
      diff.kept.push(output.citeId);
      continue;
    }
    if (last !== undefined && current && current !== last && current !== expected) {
      diff.manualEdits.push({
        citeId: output.citeId,
        currentText: currentTexts.get(output.citeId) ?? '',
        expectedText: output.text,
      });
      continue;
    }
    if (citation?.lastSignature !== output.signature || current !== expected) diff.rewrite.push(output.citeId);
    else diff.unchanged.push(output.citeId);
  }
  return diff;
}

/** 写入成功后把本次输出记入模型（lastText/lastSignature），并清掉 manualText（已被覆盖）。 */
export function recordRendered(model: DocumentModel, outputs: CitationOutput[], written: string[]): DocumentModel {
  const writtenSet = new Set(written);
  const byId = new Map<string, CitationOutput>();
  for (const output of outputs) byId.set(output.citeId, output);
  return {
    ...model,
    citations: model.citations.map((citation) => {
      const output = byId.get(citation.citeId);
      if (!output || !writtenSet.has(citation.citeId)) return citation;
      return {
        citeId: citation.citeId,
        items: citation.items,
        updatedAt: citation.updatedAt,
        lastText: output.text,
        lastSignature: output.signature,
      };
    }),
  };
}

/** 用户选择「保留手改」：记下当前文本，此后刷新跳过该引用，直到重新编辑它。 */
export function keepManualEdit(model: DocumentModel, citeId: string, currentText: string): DocumentModel {
  return {
    ...model,
    citations: model.citations.map((citation) =>
      citation.citeId === citeId ? { ...citation, manualText: currentText } : citation,
    ),
  };
}
