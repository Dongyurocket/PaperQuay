/**
 * Word OOXML 构建器（v2）：正文引用与参考文献表的 flat-OPC 包。
 *
 * 交叉引用方案（与 Zotero 同款）：
 *  - 文献表每个条目整段包在**隐藏书签** `_PQ_<hash>` 里（下划线开头的书签不出现在
 *    Word「书签」对话框，不污染用户书签）；
 *  - 正文引用里每个编号 / 每个「著者, 年」是 `<w:hyperlink w:anchor="_PQ_…">` 内部超链接，
 *    run 属性显式「无下划线 + 自动颜色」，外观与正文一致；Ctrl+点击跳到条目，导出 PDF 保留链接，
 *    F9 更新域也不会出现「错误！未定义书签」（这里不是域）。
 *
 * `Word.Range.insertOoxml` 只接受完整的 flat-OPC 包（`pkg:package` + `/word/document.xml`，
 * 且声明 `xmlns:w`），0.3.5 传裸 `<w:p>` 片段正是交叉引用失败的根因；这里统一经 wrapPackage 输出。
 *
 * 全部为纯字符串函数，无 DOM/Node 依赖（与 src/shared/citation 其余模块同约束）。
 */
import type { CitationSegment } from './format.ts';
import { cleanPart } from './text.ts';

export const BIBLIOGRAPHY_PARAGRAPH_STYLE_ID = 'PaperQuayBibliography';
export const BIBLIOGRAPHY_PARAGRAPH_STYLE_NAME = 'PaperQuay 参考文献';
export const BOOKMARK_PREFIX = '_PQ_';
/** Word 书签名上限 40 字符。 */
const BOOKMARK_MAX_LENGTH = 40;

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export function escapeXmlText(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 32 位 FNV-1a → base36（纯 JS，结果稳定，跨端一致）。 */
export function fnv1aBase36(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * paperId → 隐藏书签名 `_PQ_<hash>`；`taken` 是本次文献表里已占用的名字，冲突时追加 `_2`、`_3`。
 * 名字只含字母数字下划线、以下划线开头、不超过 40 字符。
 */
export function bookmarkNameFor(paperId: string, taken: Set<string>): string {
  const base = `${BOOKMARK_PREFIX}${fnv1aBase36(cleanPart(paperId) || 'x')}`;
  let candidate = base;
  let counter = 2;
  while (taken.has(candidate)) {
    candidate = `${base}_${counter}`.slice(0, BOOKMARK_MAX_LENGTH);
    counter += 1;
  }
  taken.add(candidate);
  return candidate;
}

/** 为一组 paperId 分配书签名（按传入顺序，冲突加后缀）。 */
export function assignBookmarkNames(paperIds: string[]): Map<string, string> {
  const taken = new Set<string>();
  const names = new Map<string, string>();
  for (const paperId of paperIds) {
    if (!names.has(paperId)) names.set(paperId, bookmarkNameFor(paperId, taken));
  }
  return names;
}

export function isPaperQuayBookmarkName(name: unknown): boolean {
  return typeof name === 'string' && name.startsWith(BOOKMARK_PREFIX);
}

export interface RunOptions {
  superscript?: boolean;
  /** 超链接里的 run：显式去掉下划线与蓝色，外观与正文一致。 */
  plainLink?: boolean;
}

function runProperties(options: RunOptions): string {
  const parts: string[] = [];
  if (options.plainLink) parts.push('<w:color w:val="auto"/><w:u w:val="none"/>');
  if (options.superscript) parts.push('<w:vertAlign w:val="superscript"/>');
  return parts.length > 0 ? `<w:rPr>${parts.join('')}</w:rPr>` : '';
}

export function textRun(text: string, options: RunOptions = {}): string {
  if (!text) return '';
  return `<w:r>${runProperties(options)}<w:t xml:space="preserve">${escapeXmlText(text)}</w:t></w:r>`;
}

export interface InlineCitationOptions {
  /** paperId → 书签名；缺失（或整个 map 为空）时该段输出纯文本。 */
  bookmarks?: Map<string, string> | null;
  superscript?: boolean;
}

/** 正文引用的 run 序列（不含段落），供 wrapInlinePackage 包装。 */
export function buildInlineCitationRuns(segments: CitationSegment[], options: InlineCitationOptions = {}): string {
  const superscript = Boolean(options.superscript);
  return segments
    .map((segment) => {
      const anchor = segment.paperId ? options.bookmarks?.get(segment.paperId) : undefined;
      if (!anchor) return textRun(segment.text, { superscript });
      return (
        `<w:hyperlink w:anchor="${escapeXmlText(anchor)}" w:history="1">` +
        textRun(segment.text, { superscript, plainLink: true }) +
        `</w:hyperlink>`
      );
    })
    .join('');
}

export interface BibliographyEntryInput {
  paperId: string;
  seq: number;
  text: string;
}

export interface BibliographyOoxmlOptions {
  kind: 'numeric' | 'author-date';
  heading: boolean;
  title: string;
  /** paperId → 书签名；为空时不建书签。 */
  bookmarks?: Map<string, string> | null;
  /** 书签 w:id 起点（同一文档内需唯一；调用方用随机基数）。 */
  bookmarkIdBase?: number;
}

function paragraph(inner: string, styleId?: string): string {
  const pPr = styleId ? `<w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>` : '';
  return `<w:p>${pPr}${inner}</w:p>`;
}

/** 文献表段落序列（标题段 + 条目段）。顺序编码制条目以 `[n]` + 制表符开头（样式里定义悬挂缩进）。 */
export function buildBibliographyParagraphs(entries: BibliographyEntryInput[], options: BibliographyOoxmlOptions): string {
  const parts: string[] = [];
  if (options.heading) parts.push(paragraph(textRun(cleanPart(options.title))));
  let bookmarkId = options.bookmarkIdBase ?? 1000;
  for (const entry of entries) {
    const label = options.kind === 'numeric' ? `[${entry.seq}]` : '';
    // 条目文本已由格式化器定稿（含结尾句点）；只去首尾空白，不能用 cleanPart（会吃掉结尾的「.」）。
    const body =
      (label ? `${textRun(label)}<w:r><w:tab/></w:r>` : '') + textRun(String(entry.text ?? '').trim());
    const name = options.bookmarks?.get(entry.paperId);
    if (name) {
      const id = bookmarkId;
      bookmarkId += 1;
      parts.push(
        paragraph(
          `<w:bookmarkStart w:id="${id}" w:name="${escapeXmlText(name)}"/>${body}<w:bookmarkEnd w:id="${id}"/>`,
          BIBLIOGRAPHY_PARAGRAPH_STYLE_ID,
        ),
      );
    } else {
      parts.push(paragraph(body, BIBLIOGRAPHY_PARAGRAPH_STYLE_ID));
    }
  }
  return parts.join('');
}

/** 「PaperQuay 参考文献」段落样式：悬挂缩进 + 编号后制表位（用户可在 Word 里改）。 */
function stylesPart(kind: 'numeric' | 'author-date'): string {
  // numeric：左缩进 0.75cm 悬挂 0.75cm（[12] 与正文对齐）；author-date：首行悬挂 2 字符。
  const indent = kind === 'numeric' ? '<w:ind w:left="425" w:hanging="425"/>' : '<w:ind w:left="420" w:hanging="420"/>';
  const tabs = kind === 'numeric' ? '<w:tabs><w:tab w:val="left" w:pos="425"/></w:tabs>' : '';
  return (
    `<w:styles xmlns:w="${W_NS}">` +
    `<w:style w:type="paragraph" w:customStyle="1" w:styleId="${BIBLIOGRAPHY_PARAGRAPH_STYLE_ID}">` +
    `<w:name w:val="${BIBLIOGRAPHY_PARAGRAPH_STYLE_NAME}"/><w:basedOn w:val="Normal"/><w:qFormat/>` +
    `<w:pPr>${tabs}${indent}</w:pPr>` +
    `</w:style></w:styles>`
  );
}

/**
 * 把 body 内容（段落序列）包成 `insertOoxml` 可接受的 flat-OPC 包。
 * `withStyles` 时附带 styles 部件（仅文献表需要）。
 */
export function wrapPackage(bodyXml: string, withStyles: 'numeric' | 'author-date' | null = null): string {
  const documentRels = withStyles
    ? `<pkg:part pkg:name="/word/_rels/document.xml.rels" pkg:contentType="application/vnd.openxmlformats-package.relationships+xml">` +
      `<pkg:xmlData><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${R_NS}/styles" Target="styles.xml"/>` +
      `</Relationships></pkg:xmlData></pkg:part>`
    : '';
  const styles = withStyles
    ? `<pkg:part pkg:name="/word/styles.xml" pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml">` +
      `<pkg:xmlData>${stylesPart(withStyles)}</pkg:xmlData></pkg:part>`
    : '';
  return (
    `<pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage">` +
    `<pkg:part pkg:name="/_rels/.rels" pkg:contentType="application/vnd.openxmlformats-package.relationships+xml">` +
    `<pkg:xmlData><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="${R_NS}/officeDocument" Target="word/document.xml"/>` +
    `</Relationships></pkg:xmlData></pkg:part>` +
    documentRels +
    `<pkg:part pkg:name="/word/document.xml" pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml">` +
    `<pkg:xmlData><w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>${bodyXml}</w:body></w:document></pkg:xmlData></pkg:part>` +
    styles +
    `</pkg:package>`
  );
}

/** 正文引用的完整包：单段落里放 run（Word 插入行内内容时会并入当前段落）。 */
export function buildInlineCitationPackage(segments: CitationSegment[], options: InlineCitationOptions = {}): string {
  return wrapPackage(`<w:p>${buildInlineCitationRuns(segments, options)}</w:p>`);
}

export function buildBibliographyPackage(entries: BibliographyEntryInput[], options: BibliographyOoxmlOptions): string {
  return wrapPackage(buildBibliographyParagraphs(entries, options), options.kind);
}

/** 书签 w:id 起点：随机基数避免与文档里既有书签冲突；同一批次内递增即可。 */
export function bookmarkIdBase(random: () => number = Math.random): number {
  return 100000 + Math.floor(random() * 800000);
}
