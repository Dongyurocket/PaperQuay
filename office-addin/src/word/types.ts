/**
 * Word 文档访问的抽象接口。operations.ts 只依赖这里，不直接碰 Office.js：
 *  - 生产实现：./officeAdapter.ts（Office.js，WordApi 1.1 底线 + 能力检测降级）；
 *  - 测试实现：tests/ 里的内存 FakeWordAdapter，模拟控件、文本与 OOXML。
 */

export interface ScannedControl {
  /** 引用控件的 citeId；文献表控件为 null。 */
  citeId: string | null;
  isBibliography: boolean;
  /** 控件当前显示文本（用于手改检测）。 */
  text: string;
}

export interface DocumentScan {
  /** 正文引用 citeId，按真实文档顺序（可能含重复：复制粘贴）。 */
  ordered: string[];
  /** citeId → 当前文本（重复 id 取第一次出现）。 */
  texts: Map<string, string>;
  hasBibliography: boolean;
}

export interface Capabilities {
  /** WordApi 1.3：parentContentControlOrNullObject、contentControls.getByTag 等。 */
  wordApi13: boolean;
  /** Custom XML Part（公共 API，Word 2013+）。 */
  customXmlParts: boolean;
  /** Dialog API 1.1（快速引用对话框）。 */
  dialogApi: boolean;
  /** 修订模式读取（WordApi 1.4 的 changeTrackingMode；不支持时为 null 未知）。 */
  changeTracking: boolean;
}

export interface WordAdapter {
  capabilities(): Capabilities;

  /** 按文档顺序扫描引用控件与文献表控件。 */
  scan(): Promise<DocumentScan>;

  /** 在当前选区插入新引用控件并写入内容；返回是否成功（选区不可写时抛错）。 */
  insertCitation(citeId: string, ooxml: string, fallbackText: string): Promise<void>;

  /** 批量改写引用控件内容（按 tag 定位；同一 tag 多个控件时全部改写）。 */
  rewriteCitations(updates: Array<{ citeId: string; ooxml: string; fallbackText: string }>): Promise<void>;

  /** 把指定 occurrence 的重复控件改成新 tag（复制粘贴拆分）。 */
  retagDuplicates(splits: Array<{ citeId: string; occurrence: number; newCiteId: string }>): Promise<void>;

  /** 已有文献表：原位重建；没有：在光标处新建（光标段非空时另起一段）。 */
  writeBibliography(ooxml: string, fallbackText: string, mode: 'update' | 'insertAtSelection'): Promise<void>;

  /** 删除指定引用控件（连同内容）。 */
  deleteCitation(citeId: string): Promise<void>;

  /** 取消链接：删除全部 PaperQuay 控件、保留内容；stripLinks 时把内容摊平成纯文本。 */
  unlinkAll(stripLinks: boolean): Promise<number>;

  /** 选中/滚动到某个引用或文献表。 */
  select(target: { citeId: string } | { bibliography: true }): Promise<void>;

  /** 光标所在的引用 citeId（不在引用内返回 null）。 */
  citeIdAtSelection(): Promise<string | null>;

  /** 当前文档是否处于修订模式（未知返回 null）。 */
  isTrackingChanges(): Promise<boolean | null>;

  /* ---- 文档级持久化（Custom XML Part / settings） ---- */
  readModelXml(): Promise<string[]>;
  /** 写入新的模型 XML 并删除旧的（先加后删，失败时留下的多份由 rev 裁决）。 */
  writeModelXml(xml: string): Promise<void>;
  getSetting(key: string): unknown;
  setSettings(values: Record<string, unknown>, remove?: string[]): Promise<void>;

  /** 文档文件名（回写「本文引用过」用）。 */
  documentTitle(): string;
}
