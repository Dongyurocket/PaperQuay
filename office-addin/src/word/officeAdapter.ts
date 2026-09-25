/**
 * WordAdapter 的 Office.js 实现。
 *
 * 兼容底线：WordApi 1.1（Word 2016 批量授权版）。用到的 1.1 以上 API 都先做能力检测：
 *  - parentContentControlOrNullObject（1.3）→ 1.1 退回 parentContentControl + 捕获 ItemNotFound；
 *  - changeTrackingMode（1.4）→ 读不到时返回 null（未知）。
 * 文档数据用公共 API 的 Custom XML Part（Word 2013+）；宿主不支持时退回 document.settings。
 *
 * 稳健性：Office.js 的一个批次里任一操作失败会让整批 sync 失败，而且批次不是事务。因此所有
 * insertOoxml 都「先试 OOXML、失败再用 insertText 纯文本兜底」，分两个 Word.run 执行，保证文档
 * 不会停留在清空了却没写入的中间态（0.3.5 的文献表被清空问题）。
 */
import {
  BIBLIOGRAPHY_CONTROL_TAG,
  BIBLIOGRAPHY_CONTROL_TITLE,
  CITATION_CONTROL_TITLE,
  DOCUMENT_MODEL_NAMESPACE,
  MODEL_FALLBACK_SETTING_KEY,
  encodeCitationControlTag,
  isBibliographyControlTag,
  parseCitationControlTag,
} from '../../../src/shared/citation/index.ts';
import type { Capabilities, DocumentScan, WordAdapter } from './types.ts';

const TAG_PATTERN = /<w:tag\b[^>]*\bw:val="([^"]*)"/g;

function isSetSupported(name: string, version: string): boolean {
  try {
    return Boolean(Office.context.requirements && Office.context.requirements.isSetSupported(name, version));
  } catch {
    return false;
  }
}

function asyncCall<T>(invoke: (callback: (result: Office.AsyncResult<T>) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    invoke((result) => {
      if (result.status === Office.AsyncResultStatus.Succeeded) resolve(result.value);
      else reject(new Error(result.error ? result.error.message : 'Office 异步调用失败'));
    });
  });
}

function errorText(error: unknown): string {
  if (!error) return '未知错误';
  const record = error as { message?: string; debugInfo?: { message?: string } };
  return (record.debugInfo && record.debugInfo.message) || record.message || String(error);
}

export function createOfficeAdapter(): WordAdapter {
  const caps: Capabilities = {
    wordApi13: isSetSupported('WordApi', '1.3'),
    customXmlParts: Boolean(Office.context.document && (Office.context.document as Office.Document).customXmlParts),
    dialogApi: isSetSupported('DialogApi', '1.1'),
    changeTracking: isSetSupported('WordApi', '1.4'),
  };

  async function scan(): Promise<DocumentScan> {
    return Word.run(async (context) => {
      const body = context.document.body;
      const ooxml = body.getOoxml();
      const controls = body.contentControls;
      controls.load('items/tag,items/text');
      await context.sync();
      const ordered: string[] = [];
      let hasBibliography = false;
      const xml = typeof ooxml.value === 'string' ? ooxml.value : '';
      TAG_PATTERN.lastIndex = 0;
      let match = TAG_PATTERN.exec(xml);
      while (match) {
        const citeId = parseCitationControlTag(match[1]);
        if (citeId) ordered.push(citeId);
        else if (isBibliographyControlTag(match[1])) hasBibliography = true;
        match = TAG_PATTERN.exec(xml);
      }
      const texts = new Map<string, string>();
      const fallbackOrder: string[] = [];
      for (const control of controls.items) {
        const citeId = parseCitationControlTag(control.tag);
        if (citeId) {
          fallbackOrder.push(citeId);
          if (!texts.has(citeId)) texts.set(citeId, control.text);
        } else if (isBibliographyControlTag(control.tag)) {
          hasBibliography = true;
        }
      }
      // OOXML 里取不到（极少数宿主返回异常格式）时退回控件集合顺序。
      return { ordered: ordered.length > 0 || fallbackOrder.length === 0 ? ordered : fallbackOrder, texts, hasBibliography };
    });
  }

  function decorate(control: Word.ContentControl, tag: string, title: string): void {
    control.tag = tag;
    control.title = title;
    control.appearance = 'Hidden';
  }

  async function insertCitation(citeId: string, ooxml: string, fallbackText: string): Promise<void> {
    const tag = encodeCitationControlTag(citeId);
    try {
      await Word.run(async (context) => {
        const range = context.document.getSelection();
        const control = range.insertContentControl();
        decorate(control, tag, CITATION_CONTROL_TITLE);
        control.insertOoxml(ooxml, 'Replace');
        await context.sync();
      });
    } catch (error) {
      // OOXML 被拒（老版本/受限文档）：纯文本兜底，下一次刷新会再尝试升级为链接。
      await Word.run(async (context) => {
        const existing = context.document.body.contentControls.getByTag(tag);
        existing.load('items');
        await context.sync();
        const control = existing.items.length > 0 ? existing.items[0] : context.document.getSelection().insertContentControl();
        decorate(control, tag, CITATION_CONTROL_TITLE);
        control.insertText(fallbackText, 'Replace');
        await context.sync();
      }).catch((fallbackError: unknown) => {
        throw new Error(`插入引用失败：${errorText(fallbackError)}（OOXML：${errorText(error)}）`);
      });
    }
  }

  async function rewriteCitations(updates: Array<{ citeId: string; ooxml: string; fallbackText: string }>): Promise<void> {
    if (updates.length === 0) return;
    const run = (mode: 'ooxml' | 'text', subset: typeof updates) =>
      Word.run(async (context) => {
        const collections = subset.map((update) => {
          const collection = context.document.body.contentControls.getByTag(encodeCitationControlTag(update.citeId));
          collection.load('items');
          return { update, collection };
        });
        await context.sync();
        for (const { update, collection } of collections) {
          for (const control of collection.items) {
            if (mode === 'ooxml') control.insertOoxml(update.ooxml, 'Replace');
            else control.insertText(update.fallbackText, 'Replace');
            control.appearance = 'Hidden';
          }
        }
        await context.sync();
      });
    try {
      await run('ooxml', updates);
    } catch {
      // 整批失败时逐条重试，定位到坏的那条再退文本，其余保持链接形态。
      for (const update of updates) {
        try {
          await run('ooxml', [update]);
        } catch {
          await run('text', [update]);
        }
      }
    }
  }

  async function retagDuplicates(splits: Array<{ citeId: string; occurrence: number; newCiteId: string }>): Promise<void> {
    if (splits.length === 0) return;
    await Word.run(async (context) => {
      const byTag = new Map<string, Word.ContentControlCollection>();
      for (const split of splits) {
        if (byTag.has(split.citeId)) continue;
        const collection = context.document.body.contentControls.getByTag(encodeCitationControlTag(split.citeId));
        collection.load('items');
        byTag.set(split.citeId, collection);
      }
      await context.sync();
      // 重复控件内容相同，哪一个保留原 id 无关紧要；按集合顺序给第 2 个起分配新 id。
      for (const split of splits) {
        const control = byTag.get(split.citeId)?.items[split.occurrence];
        if (control) control.tag = encodeCitationControlTag(split.newCiteId);
      }
      await context.sync();
    });
  }

  async function removeTrailingEmptyParagraph(context: Word.RequestContext, control: Word.ContentControl): Promise<void> {
    // insertOoxml 插入整段内容后 Word 常在末尾多留一个空段落。
    const paragraphs = control.paragraphs;
    paragraphs.load('items/text');
    await context.sync();
    const items = paragraphs.items;
    if (items.length > 1 && items[items.length - 1].text.trim() === '') {
      items[items.length - 1].delete();
      await context.sync();
    }
  }

  async function writeBibliography(ooxml: string, fallbackText: string, mode: 'update' | 'insertAtSelection'): Promise<void> {
    const locate = async (context: Word.RequestContext): Promise<Word.ContentControl> => {
      const existing = context.document.body.contentControls.getByTag(BIBLIOGRAPHY_CONTROL_TAG);
      existing.load('items');
      await context.sync();
      if (existing.items.length > 0) return existing.items[0];
      if (mode === 'update') throw new Error('文档里没有参考文献表。');
      // 新表插到光标处：光标所在段落非空时另起一段，避免把表插进句子中间。
      const paragraphs = context.document.getSelection().paragraphs;
      paragraphs.load('items/text');
      await context.sync();
      const host = paragraphs.items[0];
      const target = !host
        ? context.document.body.insertParagraph('', 'End')
        : host.text.trim().length > 0
          ? host.insertParagraph('', 'After')
          : host;
      const control = target.insertContentControl();
      decorate(control, BIBLIOGRAPHY_CONTROL_TAG, BIBLIOGRAPHY_CONTROL_TITLE);
      await context.sync();
      return control;
    };

    try {
      await Word.run(async (context) => {
        const control = await locate(context);
        control.appearance = 'Hidden';
        control.insertOoxml(ooxml, 'Replace');
        await context.sync();
        await removeTrailingEmptyParagraph(context, control).catch(() => undefined);
      });
    } catch (error) {
      await Word.run(async (context) => {
        const control = await locate(context);
        control.clear();
        const lines = fallbackText.split('\n');
        lines.forEach((line, index) => {
          if (index === 0) control.insertText(line, 'Start');
          else control.insertParagraph(line, 'End');
        });
        await context.sync();
      }).catch((fallbackError: unknown) => {
        throw new Error(`写入参考文献表失败：${errorText(fallbackError)}（OOXML：${errorText(error)}）`);
      });
    }
  }

  async function deleteCitation(citeId: string): Promise<void> {
    await Word.run(async (context) => {
      const collection = context.document.body.contentControls.getByTag(encodeCitationControlTag(citeId));
      collection.load('items');
      await context.sync();
      for (const control of collection.items) control.delete(false);
      await context.sync();
    });
  }

  async function unlinkAll(stripLinks: boolean): Promise<number> {
    return Word.run(async (context) => {
      const controls = context.document.body.contentControls;
      controls.load('items/tag,items/text');
      await context.sync();
      let removed = 0;
      for (const control of controls.items) {
        const isCitation = parseCitationControlTag(control.tag) !== null;
        if (!isCitation && !isBibliographyControlTag(control.tag)) continue;
        // 默认保留超链接与隐藏书签（交出文档后仍可 Ctrl+点击跳转）；选择去掉链接时把正文引用摊平为纯文本。
        if (stripLinks && isCitation) control.insertText(control.text, 'Replace');
        control.delete(true);
        removed += 1;
      }
      await context.sync();
      return removed;
    });
  }

  async function select(target: { citeId: string } | { bibliography: true }): Promise<void> {
    await Word.run(async (context) => {
      const tag = 'citeId' in target ? encodeCitationControlTag(target.citeId) : BIBLIOGRAPHY_CONTROL_TAG;
      const collection = context.document.body.contentControls.getByTag(tag);
      collection.load('items');
      await context.sync();
      if (collection.items.length === 0) throw new Error('文档里找不到该引用。');
      collection.items[0].select('Select');
      await context.sync();
    });
  }

  async function citeIdAtSelection(): Promise<string | null> {
    try {
      return await Word.run(async (context) => {
        const selection = context.document.getSelection();
        if (caps.wordApi13) {
          const control = selection.parentContentControlOrNullObject;
          control.load('tag');
          await context.sync();
          return control.isNullObject ? null : parseCitationControlTag(control.tag);
        }
        const control = selection.parentContentControl;
        control.load('tag');
        await context.sync();
        return parseCitationControlTag(control.tag);
      });
    } catch {
      return null;
    }
  }

  async function isTrackingChanges(): Promise<boolean | null> {
    if (!caps.changeTracking) return null;
    try {
      return await Word.run(async (context) => {
        const document = context.document as Word.Document & { changeTrackingMode?: string };
        document.load('changeTrackingMode');
        await context.sync();
        return document.changeTrackingMode !== undefined && document.changeTrackingMode !== 'Off';
      });
    } catch {
      return null;
    }
  }

  /* ---------------------------------------------------------------- 持久化 */

  function settingsApi(): Office.Settings {
    return Office.context.document.settings;
  }

  function saveSettings(): Promise<void> {
    return asyncCall<void>((callback) => settingsApi().saveAsync(callback as (result: Office.AsyncResult<void>) => void));
  }

  async function readModelXml(): Promise<string[]> {
    if (!caps.customXmlParts) {
      const value = settingsApi().get(MODEL_FALLBACK_SETTING_KEY);
      return typeof value === 'string' ? [value] : [];
    }
    const parts = await asyncCall<Office.CustomXmlPart[]>((callback) =>
      Office.context.document.customXmlParts.getByNamespaceAsync(DOCUMENT_MODEL_NAMESPACE, callback),
    );
    const xmls: string[] = [];
    for (const part of parts) {
      xmls.push(await asyncCall<string>((callback) => part.getXmlAsync(callback)));
    }
    return xmls;
  }

  async function writeModelXml(xml: string): Promise<void> {
    if (!caps.customXmlParts) {
      settingsApi().set(MODEL_FALLBACK_SETTING_KEY, xml);
      await saveSettings();
      return;
    }
    const old = await asyncCall<Office.CustomXmlPart[]>((callback) =>
      Office.context.document.customXmlParts.getByNamespaceAsync(DOCUMENT_MODEL_NAMESPACE, callback),
    );
    // 先加新再删旧：中途失败最多留下多份，读取时按 rev 取最新（pickLatestModel）。
    await asyncCall<Office.CustomXmlPart>((callback) => Office.context.document.customXmlParts.addAsync(xml, callback));
    for (const part of old) {
      await asyncCall<void>((callback) => part.deleteAsync(callback as (result: Office.AsyncResult<void>) => void)).catch(() => undefined);
    }
  }

  function getSetting(key: string): unknown {
    try {
      return settingsApi().get(key);
    } catch {
      return null;
    }
  }

  async function setSettings(values: Record<string, unknown>, remove: string[] = []): Promise<void> {
    for (const key of Object.keys(values)) settingsApi().set(key, values[key]);
    for (const key of remove) settingsApi().remove(key);
    await saveSettings();
  }

  function documentTitle(): string {
    try {
      const url = Office.context.document.url || '';
      const name = url.split(/[\\/]/).pop() || '';
      return decodeURIComponent(name) || '未命名文档';
    } catch {
      return '未命名文档';
    }
  }

  return {
    capabilities: () => caps,
    scan,
    insertCitation,
    rewriteCitations,
    retagDuplicates,
    writeBibliography,
    deleteCitation,
    unlinkAll,
    select,
    citeIdAtSelection,
    isTrackingChanges,
    readModelXml,
    writeModelXml,
    getSetting,
    setSettings,
    documentTitle,
  };
}
