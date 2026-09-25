/**
 * Word 加载项 v2 文档操作（office-addin/src/word/operations.ts）的端到端单测。
 *
 * 用内存 FakeWordAdapter 模拟 Word：控件序列（正文引用 + 文献表）、每个控件当前文本、
 * 写入的 OOXML、Custom XML Part 与 document.settings。覆盖用户最常见的写作流程：
 * 插入 → 插表 → 中间补一条 → 编号重排 → 删表 → 重建 → 复制粘贴 → 手改 → 取消链接 → v1 迁移。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createOperations } from '../office-addin/src/word/operations.ts';
import type { Capabilities, DocumentScan, WordAdapter } from '../office-addin/src/word/types.ts';
import type { CitationPaperLike } from '../src/shared/citation/index.ts';

interface FakeControl {
  kind: 'cite' | 'bib';
  citeId: string | null;
  text: string;
  ooxml: string;
}

/** OOXML 包 → 显示文本（拼接所有 w:t，段落之间换行）。 */
function textOfPackage(ooxml: string): string {
  const paragraphs = ooxml.split('</w:p>');
  return paragraphs
    .map((paragraph) => {
      const parts: string[] = [];
      const pattern = /<w:t[^>]*>([^<]*)<\/w:t>|<w:tab\/>/g;
      let match = pattern.exec(paragraph);
      while (match) {
        parts.push(match[1] === undefined ? '\t' : match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
        match = pattern.exec(paragraph);
      }
      return parts.join('');
    })
    .filter((line) => line.length > 0)
    .join('\n');
}

class FakeWord implements WordAdapter {
  controls: FakeControl[] = [];
  /** 插入位置（控件序列下标）；默认追加到末尾。 */
  cursor: number | null = null;
  parts: string[] = [];
  settings: Record<string, unknown> = {};
  rewrites = 0;
  trackChanges = false;

  capabilities(): Capabilities {
    return { wordApi13: true, customXmlParts: true, dialogApi: true, changeTracking: true };
  }

  async scan(): Promise<DocumentScan> {
    const ordered: string[] = [];
    const texts = new Map<string, string>();
    let hasBibliography = false;
    for (const control of this.controls) {
      if (control.kind === 'bib') hasBibliography = true;
      else if (control.citeId) {
        ordered.push(control.citeId);
        if (!texts.has(control.citeId)) texts.set(control.citeId, control.text);
      }
    }
    return { ordered, texts, hasBibliography };
  }

  private insertAt(control: FakeControl): void {
    const index = this.cursor === null ? this.controls.length : this.cursor;
    this.controls.splice(index, 0, control);
    this.cursor = null;
  }

  async insertCitation(citeId: string, ooxml: string): Promise<void> {
    this.insertAt({ kind: 'cite', citeId, ooxml, text: textOfPackage(ooxml) });
  }

  async rewriteCitations(updates: Array<{ citeId: string; ooxml: string }>): Promise<void> {
    for (const update of updates) {
      for (const control of this.controls) {
        if (control.citeId === update.citeId) {
          control.ooxml = update.ooxml;
          control.text = textOfPackage(update.ooxml);
          this.rewrites += 1;
        }
      }
    }
  }

  async retagDuplicates(splits: Array<{ citeId: string; occurrence: number; newCiteId: string }>): Promise<void> {
    for (const split of splits) {
      const matches = this.controls.filter((control) => control.citeId === split.citeId);
      const target = matches[split.occurrence];
      if (target) target.citeId = split.newCiteId;
    }
  }

  async writeBibliography(ooxml: string, _fallback: string, mode: 'update' | 'insertAtSelection'): Promise<void> {
    const existing = this.controls.find((control) => control.kind === 'bib');
    if (existing) {
      existing.ooxml = ooxml;
      existing.text = textOfPackage(ooxml);
      return;
    }
    if (mode === 'update') throw new Error('no bibliography');
    this.insertAt({ kind: 'bib', citeId: null, ooxml, text: textOfPackage(ooxml) });
  }

  async deleteCitation(citeId: string): Promise<void> {
    this.controls = this.controls.filter((control) => control.citeId !== citeId);
  }

  async unlinkAll(): Promise<number> {
    const count = this.controls.length;
    this.controls = [];
    return count;
  }

  async select(): Promise<void> {}
  async citeIdAtSelection(): Promise<string | null> {
    return null;
  }
  async isTrackingChanges(): Promise<boolean | null> {
    return this.trackChanges;
  }
  async readModelXml(): Promise<string[]> {
    return [...this.parts];
  }
  async writeModelXml(xml: string): Promise<void> {
    this.parts = [xml];
  }
  getSetting(key: string): unknown {
    return this.settings[key];
  }
  async setSettings(values: Record<string, unknown>, remove: string[] = []): Promise<void> {
    Object.assign(this.settings, values);
    for (const key of remove) delete this.settings[key];
  }
  documentTitle(): string {
    return '测试文档.docx';
  }

  citationTexts(): string[] {
    return this.controls.filter((control) => control.kind === 'cite').map((control) => control.text);
  }
  bibliography(): FakeControl | undefined {
    return this.controls.find((control) => control.kind === 'bib');
  }
}

const papers: Record<string, CitationPaperLike & { id: string }> = {
  a: { id: 'a', title: '深度学习综述', year: '2021', itemType: 'journalArticle', publication: '计算机学报', volume: '44', issue: '3', pages: '1-25', authors: [{ name: '张三' }] },
  b: { id: 'b', title: 'Attention Is All You Need', year: '2017', itemType: 'conferencePaper', publication: 'NeurIPS', authors: [{ name: 'Ashish Vaswani', familyName: 'Vaswani', givenName: 'Ashish' }] },
  c: { id: 'c', title: '统计学习方法', year: '2019', itemType: 'book', publisher: '清华大学出版社', publisherPlace: '北京', authors: [{ name: '李航' }] },
};

function counterIds() {
  let counter = 0;
  return () => `c${String((counter += 1)).padStart(7, '0')}`;
}

async function cite(ops: ReturnType<typeof createOperations>, ...ids: string[]) {
  return ops.insertCitation(
    ids.map((id) => ({ paperId: id, label: papers[id].title })),
    ids.map((id) => papers[id]),
  );
}

test('插入 → 插入文献表 → 正文变成指向书签的超链接，文献表条目带书签', async () => {
  const word = new FakeWord();
  const ops = createOperations(word, counterIds());
  await ops.loadModel();
  await cite(ops, 'a');
  await cite(ops, 'b');
  assert.deepEqual(word.citationTexts(), ['[1]', '[2]']);
  assert.ok(word.controls.every((control) => !control.ooxml.includes('w:hyperlink')), '没有文献表时正文不加链接');

  const result = await ops.insertOrUpdateBibliography();
  assert.equal(result.plan?.linked, true);
  const bib = word.bibliography();
  assert.ok(bib);
  assert.match(bib!.text, /^参考文献\n\[1\]\t张三\. 深度学习综述\[J\]/);
  const anchors = word.controls
    .filter((control) => control.kind === 'cite')
    .map((control) => /w:anchor="([^"]+)"/.exec(control.ooxml)?.[1]);
  const bookmarks = [...bib!.ooxml.matchAll(/w:bookmarkStart w:id="\d+" w:name="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(anchors, bookmarks, '正文第 n 条的链接指向文献表第 n 条的书签');
  assert.ok(anchors.every((anchor) => anchor?.startsWith('_PQ_')));
});

test('在中间补一条引用：全文编号按文档顺序重排，文献表同步', async () => {
  const word = new FakeWord();
  const ops = createOperations(word, counterIds());
  await ops.loadModel();
  await cite(ops, 'a');
  await cite(ops, 'b');
  await ops.insertOrUpdateBibliography();
  word.cursor = 1; // 光标放在第一、二条引用之间
  await cite(ops, 'c');
  assert.deepEqual(word.citationTexts(), ['[1]', '[2]', '[3]']);
  const lines = word.bibliography()!.text.split('\n');
  assert.match(lines[2], /^\[2\]\t李航\. 统计学习方法\[M\]\. 北京: 清华大学出版社, 2019\.$/);
  assert.match(lines[3], /^\[3\]\tVaswani A\. Attention Is All You Need\[C\]/);
  // 同一文献再次引用同号；多篇合并区间折叠
  await cite(ops, 'a', 'b', 'c');
  assert.equal(word.citationTexts()[3], '[1-3]');
});

test('刷新是差量的：内容没变不重写；删掉文献表后链接去掉，重建后恢复', async () => {
  const word = new FakeWord();
  const ops = createOperations(word, counterIds());
  await ops.loadModel();
  await cite(ops, 'a');
  await cite(ops, 'b');
  await ops.insertOrUpdateBibliography();
  const before = word.rewrites;
  const idle = await ops.refresh();
  assert.equal(idle.rewritten, 0);
  assert.equal(word.rewrites, before);

  word.controls = word.controls.filter((control) => control.kind !== 'bib');
  const unlinked = await ops.refresh();
  assert.equal(unlinked.plan?.linked, false);
  assert.ok(word.controls.every((control) => !control.ooxml.includes('w:hyperlink')));

  await ops.insertOrUpdateBibliography();
  assert.ok(word.controls.filter((control) => control.kind === 'cite').every((control) => control.ooxml.includes('w:hyperlink')));
});

test('复制粘贴出的重复引用被拆成独立 id；手改的引用先询问、选择保留后不再覆盖', async () => {
  const word = new FakeWord();
  const ops = createOperations(word, counterIds());
  await ops.loadModel();
  await cite(ops, 'a');
  await cite(ops, 'b');
  // 用户复制了第一条引用粘贴到末尾
  word.controls.push({ ...word.controls[0] });
  const split = await ops.refresh();
  assert.equal(split.splitDuplicates, 1);
  const ids = word.controls.map((control) => control.citeId);
  assert.equal(new Set(ids).size, 3, '三个控件三个不同 id');
  assert.deepEqual(word.citationTexts(), ['[1]', '[2]', '[1]']);

  // 手改第二条
  word.controls[1].text = '[2，见附录]';
  const asked = await ops.refresh();
  assert.equal(asked.pendingManualEdits.length, 1);
  assert.equal(word.controls[1].text, '[2，见附录]', 'ask 模式不覆盖手改');
  await ops.refresh({ manualEdits: 'keep' });
  word.cursor = 0;
  await cite(ops, 'c'); // 前面插入新引用 → 其它编号都变了
  assert.equal(word.controls[2].text, '[2，见附录]', '保留的手改不被覆盖');
  assert.equal(word.citationTexts()[0], '[1]');
  await ops.refresh({ manualEdits: 'overwrite' });
  // 覆盖只针对新出现的手改；已选择保留的仍保留，直到重新编辑
  const kept = ops.getModel().citations.find((citation) => citation.citeId === word.controls[2].citeId);
  assert.equal(kept?.manualText, '[2，见附录]');
  await ops.editCitation(kept!.citeId, [{ paperId: 'b' }], []);
  assert.equal(word.controls[2].text, '[3]', '重新编辑后放弃手改，按新编号重写');
});

test('样式切换与首选项：著者-出版年制、上标、关闭链接', async () => {
  const word = new FakeWord();
  const ops = createOperations(word, counterIds());
  await ops.loadModel();
  await cite(ops, 'b');
  await cite(ops, 'a');
  await ops.insertOrUpdateBibliography();
  await ops.updatePrefs({ style: 'apa7' });
  assert.deepEqual(word.citationTexts(), ['(Vaswani, 2017)', '(张三, 2021)']);
  assert.ok(word.controls[0].ooxml.includes('w:hyperlink'), '著者-出版年制同样可跳转');
  await ops.updatePrefs({ style: 'gbt7714', superscript: true });
  assert.ok(word.controls[0].ooxml.includes('superscript'));
  await ops.updatePrefs({ links: false });
  assert.ok(word.controls.every((control) => !control.ooxml.includes('w:hyperlink')));
  // 首选项随文档保存：重新加载后仍在
  const reopened = createOperations(word, counterIds());
  const model = await reopened.loadModel();
  assert.equal(model.prefs.superscript, true);
  assert.equal(model.prefs.links, false);
});

test('文档自包含：PaperQuay 离线时用文档内快照刷新；快照更新后条目变化', async () => {
  const word = new FakeWord();
  const ops = createOperations(word, counterIds());
  await ops.loadModel();
  await cite(ops, 'a');
  await ops.insertOrUpdateBibliography();
  // 重新打开文档（新的 operations 实例，只能读 Custom XML Part）
  const reopened = createOperations(word, counterIds());
  await reopened.loadModel();
  const result = await reopened.refresh();
  assert.deepEqual(result.missingSnapshots, []);
  assert.match(word.bibliography()!.text, /深度学习综述/);
  await reopened.applySnapshots([{ ...papers.a, title: '深度学习综述（修订版）' }], []);
  await reopened.refresh();
  assert.match(word.bibliography()!.text, /深度学习综述（修订版）/);
});

test('删除引用、撤销造成的孤立记录被清理；取消链接清空模型但保留首选项', async () => {
  const word = new FakeWord();
  const ops = createOperations(word, counterIds());
  await ops.loadModel();
  await cite(ops, 'a');
  await cite(ops, 'b');
  const firstId = word.controls[0].citeId!;
  await ops.removeCitation(firstId);
  assert.deepEqual(word.citationTexts(), ['[1]']);
  // 模拟 Word 撤销插入：控件没了，模型里还有记录
  word.controls = [];
  await ops.refresh();
  assert.equal(ops.getModel().citations.length, 0);
  await cite(ops, 'c');
  await ops.updatePrefs({ style: 'ieee' });
  const removed = await ops.unlink(false);
  assert.equal(removed, 1);
  assert.equal(ops.getModel().citations.length, 0);
  assert.equal(ops.getModel().prefs.style, 'ieee');
});

test('v1（0.3.x）文档迁移：读旧设置、清除旧键、首次刷新强制重写（清掉 REF 域）', async () => {
  const word = new FakeWord();
  word.settings = {
    'pq:schemaVersion': '1',
    'pq:style': 'gbt7714',
    'pq:citations': JSON.stringify([
      { citeId: 'aaaa1111', items: [{ paperId: 'a', label: '深度学习综述' }], updatedAt: 1 },
      { citeId: 'bbbb2222', items: [{ paperId: 'b', label: 'Attention Is All You Need' }], updatedAt: 2 },
    ]),
    'pq:superscript': '1',
    'pq:crossref': '1',
    'pq:documentId': 'doc-legacy',
  };
  word.controls = [
    { kind: 'cite', citeId: 'aaaa1111', text: '[1]', ooxml: '<w:fldSimple w:instr=" REF r_a \\h "/>' },
    { kind: 'cite', citeId: 'bbbb2222', text: '[2]', ooxml: '<w:fldSimple w:instr=" REF r_b \\h "/>' },
    { kind: 'bib', citeId: null, text: '参考文献', ooxml: '' },
  ];
  const ops = createOperations(word, counterIds());
  const model = await ops.loadModel();
  assert.equal(model.documentId, 'doc-legacy');
  assert.equal(model.prefs.superscript, true);
  assert.equal(word.settings['pq:schemaVersion'], '2');
  assert.equal(word.settings['pq:citations'], undefined, '旧键已清除');
  const result = await ops.refresh();
  assert.equal(result.rewritten, 2, '迁移后首次刷新重写全部引用');
  assert.ok(word.controls.every((control) => !control.ooxml.includes('fldSimple')));
  // 迁移时没有快照：标记缺失，等连上 PaperQuay 补齐；文献表用 label 兜底
  assert.deepEqual(result.missingSnapshots.sort(), ['a', 'b']);
  assert.match(word.bibliography()!.text, /深度学习综述/);
});
