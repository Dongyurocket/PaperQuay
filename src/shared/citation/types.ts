/**
 * 引用格式化真源的结构化类型（最小面）。
 *
 * 本目录（src/shared/citation）是引用/参考文献格式化的唯一实现，同时被三处使用：
 *   1. 渲染层：`src/features/notes/bibliography.ts` 再导出（保持笔记侧既有 API）；
 *   2. Electron 主进程：经 esbuild 产物 `electron/generated/citationFormatters.cjs`
 *      供 `electron/backend/officeBridge.cjs`、`electron/backend/noteVault.cjs` 使用；
 *   3. Word 加载项：经 esbuild 产物 `office-addin/dist/citation-shared.js`。
 *
 * 因此这里**不得**依赖 DOM、Node 或应用层模块，只允许纯函数与纯类型。
 * `src/types/library.ts` 的 `LiteraturePaper` / `LiteratureAuthor` 在结构上可赋值给下面的
 * `CitationPaperLike` / `CitationAuthorLike`，无需转换。
 */

export interface CitationAuthorLike {
  name?: string | null;
  givenName?: string | null;
  familyName?: string | null;
}

/** 允许直接传姓名串（旧数据/外部输入），也允许传结构化作者对象。 */
export type CitationAuthorInput = CitationAuthorLike | string;

export interface CitationPaperLike {
  id?: string | null;
  title?: string | null;
  titleZh?: string | null;
  /** 年份/卷/期/页允许数字：导入链路可能给出数字，格式化层按文本渲染（见 text.ts cleanPart）。 */
  year?: string | number | null;
  publication?: string | null;
  doi?: string | null;
  url?: string | null;
  itemType?: string | null;
  publisher?: string | null;
  /** 出版地（GB/T 7714 专著/会议论文的“出版地: 出版者”）。 */
  publisherPlace?: string | null;
  institution?: string | null;
  reportNumber?: string | null;
  volume?: string | number | null;
  issue?: string | number | null;
  pages?: string | number | null;
  isbn?: string | null;
  issn?: string | null;
  authors?: CitationAuthorInput[] | null;
}
