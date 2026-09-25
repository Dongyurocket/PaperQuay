/**
 * 加载项的文档操作（与 UI、Office.js 解耦，node 下可用 FakeWordAdapter 单测）。
 *
 * 数据流：文档扫描（真实顺序，单一真相）→ 文档模型（Custom XML Part 缓存 + 条目快照）
 *        → 本地渲染（src/shared/citation，与 PaperQuay 同一真源）→ 差量写回。
 *
 * 所有写操作都经 queue.ts 串行执行（UI 层负责），这里不做并发保护。
 */
import {
  DOCUMENT_MODEL_SCHEMA_VERSION,
  SCHEMA_VERSION_SETTING_KEY,
  V1_SETTING_KEYS,
  applyDuplicateSplit,
  bookmarkIdBase,
  citedPaperIds,
  createCitationId,
  createEmptyModel,
  diffRender,
  findCitation,
  keepManualEdit,
  migrateV1Settings,
  normalizePrefs,
  pickLatestModel,
  planDuplicateSplit,
  planRender,
  pruneModel,
  recordRendered,
  removeCitation,
  serializeModelXml,
  upsertCitation,
  upsertSnapshots,
  type CitationItemInput,
  type CitationPaperLike,
  type DocumentModel,
  type DocumentPrefs,
  type ManualEdit,
  type RenderPlan,
} from '../../../src/shared/citation/index.ts';
import type { DocumentScan, WordAdapter } from './types.ts';

export interface RefreshOptions {
  /** 手改冲突的处理：ask = 返回给 UI 让用户选；keep / overwrite = 直接执行。 */
  manualEdits?: 'ask' | 'keep' | 'overwrite';
  /** 强制重写全部引用（迁移、样式切换后）。 */
  force?: boolean;
}

export interface RefreshResult {
  plan: RenderPlan | null;
  scan: DocumentScan;
  rewritten: number;
  /** manualEdits === 'ask' 时未处理的手改，UI 决定后以 keep/overwrite 再调一次。 */
  pendingManualEdits: ManualEdit[];
  /** 文档里有引用但快照缺失的 paperId（需要连上 PaperQuay 补齐）。 */
  missingSnapshots: string[];
  splitDuplicates: number;
}

export interface Operations {
  loadModel(): Promise<DocumentModel>;
  getModel(): DocumentModel;
  updatePrefs(patch: Partial<DocumentPrefs>): Promise<RefreshResult>;
  insertCitation(items: CitationItemInput[], papers: CitationPaperLike[]): Promise<RefreshResult>;
  editCitation(citeId: string, items: CitationItemInput[], papers: CitationPaperLike[]): Promise<RefreshResult>;
  removeCitation(citeId: string): Promise<RefreshResult>;
  refresh(options?: RefreshOptions): Promise<RefreshResult>;
  insertOrUpdateBibliography(): Promise<RefreshResult>;
  unlink(stripLinks: boolean): Promise<number>;
  applySnapshots(papers: CitationPaperLike[], missing: string[]): Promise<void>;
  citedPaperIds(): string[];
}

export function createOperations(adapter: WordAdapter, createId: () => string = () => createCitationId()): Operations {
  let model: DocumentModel = createEmptyModel();
  let loaded = false;

  async function persist(next: DocumentModel): Promise<void> {
    const saved: DocumentModel = { ...next, rev: next.rev + 1 };
    await adapter.writeModelXml(serializeModelXml(saved));
    model = saved;
  }

  async function loadModel(): Promise<DocumentModel> {
    const xmls = await adapter.readModelXml();
    const { model: stored } = pickLatestModel(xmls);
    const schema = String(adapter.getSetting(SCHEMA_VERSION_SETTING_KEY) ?? '');
    if (stored) {
      model = stored;
    } else if (schema !== String(DOCUMENT_MODEL_SCHEMA_VERSION) && adapter.getSetting('pq:citations') != null) {
      // v1（0.3.x）文档：从旧设置键迁移，随后第一次刷新会强制全量重写（清掉 REF 域）。
      model = migrateV1Settings((key) => adapter.getSetting(key));
      await persist(model);
      await adapter.setSettings({ [SCHEMA_VERSION_SETTING_KEY]: String(DOCUMENT_MODEL_SCHEMA_VERSION) }, [...V1_SETTING_KEYS]);
      model = { ...model, citations: model.citations.map((citation) => ({ ...citation, lastSignature: 'v1' })) };
    } else {
      model = createEmptyModel();
    }
    loaded = true;
    return model;
  }

  async function ensureLoaded(): Promise<void> {
    if (!loaded) await loadModel();
  }

  async function refresh(options: RefreshOptions = {}): Promise<RefreshResult> {
    await ensureLoaded();
    let scan = await adapter.scan();
    // 1) 复制粘贴产生的重复 citeId：拆成独立引用（各自可编辑）。
    const splits = planDuplicateSplit(scan.ordered, createId);
    let working = model;
    if (splits.length > 0) {
      await adapter.retagDuplicates(splits);
      const applied = applyDuplicateSplit(working, scan.ordered, splits);
      working = applied.model;
      const texts = new Map(scan.texts);
      for (const split of splits) texts.set(split.newCiteId, scan.texts.get(split.citeId) ?? '');
      scan = { ...scan, ordered: applied.ordered, texts };
    }
    // 2) 文档里已不存在的引用（撤销、手动删除）从模型清掉；文档里有但模型没有的（从别的文档粘贴）保留原文不动。
    working = pruneModel(working, scan.ordered);
    const known = scan.ordered.filter((citeId) => findCitation(working, citeId));
    const missingSnapshots = citedPaperIds(working, known).filter((paperId) => !working.items[paperId]);

    if (known.length === 0) {
      if (working !== model) await persist(working);
      return { plan: null, scan, rewritten: 0, pendingManualEdits: [], missingSnapshots, splitDuplicates: splits.length };
    }

    const plan = planRender(working, known, { hasBibliography: scan.hasBibliography, bookmarkIdBase: bookmarkIdBase() });
    const diff = diffRender(working, scan.texts, plan.citations);
    const rewrite = new Set(options.force ? plan.citations.map((citation) => citation.citeId) : diff.rewrite);
    let pending: ManualEdit[] = [];
    if (!options.force) {
      if (options.manualEdits === 'overwrite') {
        for (const edit of diff.manualEdits) rewrite.add(edit.citeId);
      } else if (options.manualEdits === 'keep') {
        for (const edit of diff.manualEdits) working = keepManualEdit(working, edit.citeId, edit.currentText);
      } else {
        pending = diff.manualEdits;
      }
    }

    const updates = plan.citations
      .filter((citation) => rewrite.has(citation.citeId))
      .map((citation) => ({ citeId: citation.citeId, ooxml: citation.ooxml, fallbackText: citation.text }));
    if (updates.length > 0) await adapter.rewriteCitations(updates);
    if (scan.hasBibliography) await adapter.writeBibliography(plan.bibliographyOoxml, plan.bibliographyText, 'update');

    working = recordRendered(working, plan.citations, [...rewrite, ...diff.unchanged]);
    await persist(working);
    return {
      plan,
      scan,
      rewritten: updates.length,
      pendingManualEdits: pending,
      missingSnapshots,
      splitDuplicates: splits.length,
    };
  }

  async function insertCitation(items: CitationItemInput[], papers: CitationPaperLike[]): Promise<RefreshResult> {
    await ensureLoaded();
    if (items.length === 0) throw new Error('请先选择至少一篇文献。');
    const citeId = createId();
    let next = upsertSnapshots(model, papers);
    next = upsertCitation(next, { citeId, items, updatedAt: Date.now() });
    // 先用单组渲染得到可插入的内容（此时还不知道全文编号；紧接着的 refresh 会按文档顺序重排）。
    const provisional = planRender(next, [citeId], { hasBibliography: false });
    const first = provisional.citations[0];
    // 先写模型再插控件：插入失败时模型里多一条孤立记录，下一次 refresh 的 pruneModel 会清掉。
    await persist(next);
    await adapter.insertCitation(citeId, first.ooxml, first.text);
    return refresh({ manualEdits: 'ask' });
  }

  async function editCitation(citeId: string, items: CitationItemInput[], papers: CitationPaperLike[]): Promise<RefreshResult> {
    await ensureLoaded();
    if (items.length === 0) return removeCitationOp(citeId);
    let next = upsertSnapshots(model, papers);
    // 重新编辑 = 放弃手改保留：清掉 lastText/lastSignature/manualText，下一次刷新必然按新内容重写，
    // 不会把控件里残留的手改文本误判为新的手改。
    next = upsertCitation(next, { citeId, items, updatedAt: Date.now() });
    await persist(next);
    return refresh({ manualEdits: 'ask' });
  }

  async function removeCitationOp(citeId: string): Promise<RefreshResult> {
    await ensureLoaded();
    await adapter.deleteCitation(citeId);
    await persist(removeCitation(model, citeId));
    return refresh({ manualEdits: 'ask' });
  }

  async function insertOrUpdateBibliography(): Promise<RefreshResult> {
    await ensureLoaded();
    const scan = await adapter.scan();
    const known = scan.ordered.filter((citeId) => findCitation(model, citeId));
    if (known.length === 0) throw new Error('文档里还没有 PaperQuay 引用，无法生成参考文献表。');
    if (!scan.hasBibliography) {
      const plan = planRender(model, known, { hasBibliography: true, bookmarkIdBase: bookmarkIdBase() });
      await adapter.writeBibliography(plan.bibliographyOoxml, plan.bibliographyText, 'insertAtSelection');
    }
    // 文献表就位后全文刷新：正文引用升级为指向条目书签的跳转链接。
    return refresh({ manualEdits: 'ask' });
  }

  async function updatePrefs(patch: Partial<DocumentPrefs>): Promise<RefreshResult> {
    await ensureLoaded();
    await persist({ ...model, prefs: normalizePrefs({ ...model.prefs, ...patch }) });
    return refresh({ manualEdits: 'ask' });
  }

  async function unlink(stripLinks: boolean): Promise<number> {
    await ensureLoaded();
    const removed = await adapter.unlinkAll(stripLinks);
    await persist({ ...createEmptyModel(model.documentId), prefs: model.prefs });
    return removed;
  }

  async function applySnapshots(papers: CitationPaperLike[], missing: string[]): Promise<void> {
    await ensureLoaded();
    await persist(upsertSnapshots(model, papers, missing));
  }

  return {
    loadModel,
    getModel: () => model,
    updatePrefs,
    insertCitation,
    editCitation,
    removeCitation: removeCitationOp,
    refresh,
    insertOrUpdateBibliography,
    unlink,
    applySnapshots,
    citedPaperIds: () => citedPaperIds(model),
  };
}
