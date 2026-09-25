/**
 * Word 加载项 v2 的 OOXML 构建器与文档模型（src/shared/citation/wordOoxml.ts、documentModel.ts）。
 *
 * 0.3.5 的交叉引用失败根因是给 insertOoxml 传了裸 <w:p> 片段；这里用 xmldom 真解析每个产物，
 * 断言：完整 flat-OPC 包、命名空间正确、超链接 anchor 与文献表书签一一对应、隐藏书签命名规则。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';

import {
  BOOKMARK_PREFIX,
  applyDuplicateSplit,
  assignBookmarkNames,
  bookmarkNameFor,
  buildBibliographyPackage,
  buildInlineCitationPackage,
  createEmptyModel,
  diffRender,
  escapeXmlText,
  keepManualEdit,
  migrateV1Settings,
  parseModelXml,
  pickLatestModel,
  planDuplicateSplit,
  planRender,
  pruneModel,
  recordRendered,
  serializeModelXml,
  upsertCitation,
  upsertSnapshots,
  type CitationPaperLike,
  type DocumentModel,
} from '../src/shared/citation/index.ts';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const PKG_NS = 'http://schemas.microsoft.com/office/2006/xmlPackage';

function parseXml(xml: string) {
  const errors: string[] = [];
  const doc = new DOMParser({
    onError: (level: string, message: string) => {
      if (level !== 'warning') errors.push(message);
    },
  }).parseFromString(xml, 'text/xml');
  assert.deepEqual(errors, [], `XML 解析错误：${errors.join('; ')}`);
  return doc;
}

function assertPackage(xml: string) {
  const doc = parseXml(xml);
  const root = doc.documentElement!;
  assert.equal(root.localName, 'package');
  assert.equal(root.namespaceURI, PKG_NS);
  const parts = Array.from(doc.getElementsByTagNameNS(PKG_NS, 'part')).map((part) => part.getAttributeNS(PKG_NS, 'name'));
  assert.ok(parts.includes('/_rels/.rels'), '缺少 /_rels/.rels');
  assert.ok(parts.includes('/word/document.xml'), '缺少 /word/document.xml');
  const body = doc.getElementsByTagNameNS(W_NS, 'body');
  assert.equal(body.length, 1, 'document.xml 必须有且只有一个 w:body（w 命名空间已声明）');
  return doc;
}

const papers: CitationPaperLike[] = [
  { id: 'p-a', title: '深度学习综述', year: '2021', itemType: 'journalArticle', publication: '计算机学报', authors: [{ name: '张三' }] },
  { id: 'p-b', title: 'Attention <Is> All & You Need', year: '2017', itemType: 'conferencePaper', publication: 'NeurIPS', authors: [{ name: 'Ashish Vaswani', familyName: 'Vaswani', givenName: 'Ashish' }] },
  { id: 'p-c', title: '统计学习方法', year: '2019', itemType: 'book', publisher: '清华大学出版社', publisherPlace: '北京', authors: [{ name: '李航' }] },
];

function modelWith(citations: Array<{ citeId: string; paperIds: string[] }>): DocumentModel {
  let model = upsertSnapshots(createEmptyModel('doc-test'), papers, [], 1);
  for (const citation of citations) {
    model = upsertCitation(model, {
      citeId: citation.citeId,
      items: citation.paperIds.map((paperId) => ({ paperId })),
      updatedAt: 1,
    });
  }
  return model;
}

test('隐藏书签名：下划线前缀、≤40 字符、只含字母数字下划线、冲突加后缀、稳定', () => {
  const taken = new Set<string>();
  const first = bookmarkNameFor('p-a', taken);
  assert.ok(first.startsWith(BOOKMARK_PREFIX));
  assert.match(first, /^_[A-Za-z0-9_]{1,39}$/);
  const collided = bookmarkNameFor('p-a', taken);
  assert.equal(collided, `${first}_2`);
  assert.equal(bookmarkNameFor('p-a', new Set()), first, '同一 paperId 的书签名应稳定');
  const longId = 'x'.repeat(200);
  assert.ok(bookmarkNameFor(longId, new Set()).length <= 40);
  const names = assignBookmarkNames(['p-a', 'p-b', 'p-a']);
  assert.equal(names.size, 2);
  assert.notEqual(names.get('p-a'), names.get('p-b'));
});

test('正文引用包：完整 flat-OPC、超链接指向书签、run 去下划线、上标写进 rPr', () => {
  const bookmarks = new Map([['p-a', '_PQ_a'], ['p-c', '_PQ_c']]);
  const xml = buildInlineCitationPackage(
    [{ text: '参见 ' }, { text: '[' }, { text: '1', paperId: 'p-a' }, { text: '-' }, { text: '3', paperId: 'p-c' }, { text: ']' }],
    { bookmarks, superscript: true },
  );
  const doc = assertPackage(xml);
  const links = Array.from(doc.getElementsByTagNameNS(W_NS, 'hyperlink'));
  assert.deepEqual(links.map((link) => link.getAttributeNS(W_NS, 'anchor')), ['_PQ_a', '_PQ_c']);
  for (const link of links) {
    const underline = link.getElementsByTagNameNS(W_NS, 'u')[0];
    assert.equal(underline?.getAttributeNS(W_NS, 'val'), 'none');
  }
  assert.equal(doc.getElementsByTagNameNS(W_NS, 'vertAlign').length, 6);
  const text = Array.from(doc.getElementsByTagNameNS(W_NS, 't')).map((node) => node.textContent).join('');
  assert.equal(text, '参见 [1-3]');
  // 没有书签映射时输出纯文本，不产生超链接
  const plain = assertPackage(buildInlineCitationPackage([{ text: '[1]', paperId: 'p-a' }], {}));
  assert.equal(plain.getElementsByTagNameNS(W_NS, 'hyperlink').length, 0);
});

test('文献表包：每条一个书签包住整段、带段落样式与 styles 部件、XML 转义', () => {
  const bookmarks = assignBookmarkNames(['p-a', 'p-b']);
  const xml = buildBibliographyPackage(
    [
      { paperId: 'p-a', seq: 1, text: '张三. 深度学习综述[J]. 计算机学报, 2021.' },
      { paperId: 'p-b', seq: 2, text: 'Vaswani A. Attention <Is> All & You Need[C]//NeurIPS. 2017.' },
    ],
    { kind: 'numeric', heading: true, title: '参考文献', bookmarks, bookmarkIdBase: 500 },
  );
  const doc = assertPackage(xml);
  const starts = Array.from(doc.getElementsByTagNameNS(W_NS, 'bookmarkStart'));
  assert.deepEqual(starts.map((node) => node.getAttributeNS(W_NS, 'name')), [bookmarks.get('p-a'), bookmarks.get('p-b')]);
  assert.deepEqual(starts.map((node) => node.getAttributeNS(W_NS, 'id')), ['500', '501']);
  assert.equal(doc.getElementsByTagNameNS(W_NS, 'bookmarkEnd').length, 2);
  assert.equal(doc.getElementsByTagNameNS(W_NS, 'p').length, 3, '标题 + 2 条');
  assert.equal(doc.getElementsByTagNameNS(W_NS, 'style').length, 1, '附带 PaperQuay 参考文献段落样式');
  assert.ok(xml.includes('Attention &lt;Is&gt; All &amp; You Need'));
  // 无标题行、著者-出版年：不带 [n] 与制表符
  const authorDate = parseXml(
    buildBibliographyPackage([{ paperId: 'p-a', seq: 1, text: '条目' }], { kind: 'author-date', heading: false, title: 'x' }),
  );
  assert.equal(authorDate.getElementsByTagNameNS(W_NS, 'p').length, 1);
  assert.equal(authorDate.getElementsByTagNameNS(W_NS, 'tab').length, 0);
  assert.equal(escapeXmlText(`a<b>&"c"'`), 'a&lt;b&gt;&amp;&quot;c&quot;&apos;');
});

test('planRender：有文献表时正文链接与文献表书签一一对应；无文献表时不加链接', () => {
  const model = modelWith([
    { citeId: 'c0000001', paperIds: ['p-a'] },
    { citeId: 'c0000002', paperIds: ['p-b', 'p-c'] },
    { citeId: 'c0000003', paperIds: ['p-a'] },
  ]);
  const ordered = ['c0000001', 'c0000002', 'c0000003'];
  const plan = planRender(model, ordered, { hasBibliography: true, bookmarkIdBase: 10 });
  assert.equal(plan.linked, true);
  assert.deepEqual(plan.citations.map((citation) => citation.text), ['[1]', '[2-3]', '[1]']);
  const bibliography = assertPackage(plan.bibliographyOoxml);
  const bookmarkNames = new Set(
    Array.from(bibliography.getElementsByTagNameNS(W_NS, 'bookmarkStart')).map((node) => node.getAttributeNS(W_NS, 'name')),
  );
  for (const citation of plan.citations) {
    const inline = assertPackage(citation.ooxml);
    for (const link of Array.from(inline.getElementsByTagNameNS(W_NS, 'hyperlink'))) {
      assert.ok(bookmarkNames.has(link.getAttributeNS(W_NS, 'anchor')), '每个超链接都要落在文献表书签上');
    }
  }
  const unlinked = planRender(model, ordered, { hasBibliography: false });
  assert.equal(unlinked.linked, false);
  assert.ok(unlinked.citations.every((citation) => !citation.ooxml.includes('w:hyperlink')));
  assert.notEqual(unlinked.citations[0].signature, plan.citations[0].signature, '链接形态变化必须改变签名');
  // 著者-出版年制同样可跳转
  const authorDate = planRender({ ...model, prefs: { ...model.prefs, style: 'apa7' } }, ordered, { hasBibliography: true });
  assert.equal((authorDate.citations[1].ooxml.match(/<w:hyperlink /g) || []).length, 2);
});

test('文档模型 XML Part：往返、特殊字符不破坏 CDATA、多份时取 rev 最大', () => {
  const model = modelWith([{ citeId: 'c0000001', paperIds: ['p-b'] }]);
  // 复制后再改，避免污染文件级共享的 papers 夹具。
  model.items['p-b'] = { ...model.items['p-b'], paper: { ...model.items['p-b'].paper, title: 'x ]]> <y> & z' } };
  model.rev = 3;
  const xml = serializeModelXml(model);
  parseXml(xml);
  const restored = parseModelXml(xml);
  assert.equal(restored?.items['p-b'].paper.title, 'x ]]> <y> & z');
  assert.equal(restored?.citations[0].citeId, 'c0000001');
  const older = serializeModelXml({ ...model, rev: 2 });
  const picked = pickLatestModel(['<other/>', older, xml]);
  assert.equal(picked.index, 2);
  assert.equal(picked.model?.rev, 3);
  assert.equal(parseModelXml('<pq:model xmlns:pq="urn:paperquay:word:v2"><![CDATA[not json]]></pq:model>'), null);
});

test('v1 → v2 迁移：读旧设置键，样式/标题/上标/交叉引用开关保留', () => {
  const settings: Record<string, unknown> = {
    'pq:style': 'gbt7714-87',
    'pq:citations': JSON.stringify([{ citeId: 'abcd1234', items: [{ paperId: 'p-a', label: '深度学习综述' }], updatedAt: 5 }]),
    'pq:bibliographyTitle': '主要参考文献',
    'pq:bibHeading': '0',
    'pq:superscript': '1',
    'pq:punctuation': 'half',
    'pq:crossref': '0',
    'pq:documentId': 'doc-legacy',
  };
  const model = migrateV1Settings((key) => settings[key]);
  assert.equal(model.documentId, 'doc-legacy');
  assert.equal(model.citations[0].citeId, 'abcd1234');
  assert.equal(model.citations[0].items[0].label, '深度学习综述');
  assert.deepEqual(
    [model.prefs.style, model.prefs.bibliographyTitle, model.prefs.bibHeading, model.prefs.superscript, model.prefs.punctuation, model.prefs.links],
    ['gbt7714-87', '主要参考文献', false, true, 'half', false],
  );
  const empty = migrateV1Settings(() => undefined);
  assert.equal(empty.prefs.style, 'gbt7714');
  assert.equal(empty.prefs.links, true);
});

test('diffRender：只重写变化的引用；识别手改；保留手改后跳过', () => {
  let model = modelWith([
    { citeId: 'c0000001', paperIds: ['p-a'] },
    { citeId: 'c0000002', paperIds: ['p-b'] },
  ]);
  const ordered = ['c0000001', 'c0000002'];
  const first = planRender(model, ordered, { hasBibliography: false });
  // 首次：控件里是插入时的文本，但没有 lastSignature → 全部重写
  let diff = diffRender(model, new Map([['c0000001', '[1]'], ['c0000002', '[2]']]), first.citations);
  assert.deepEqual(diff.rewrite, ['c0000001', 'c0000002']);
  model = recordRendered(model, first.citations, diff.rewrite);
  // 再次刷新：内容没变 → 不碰
  diff = diffRender(model, new Map([['c0000001', '[1]'], ['c0000002', '[2]']]), first.citations);
  assert.deepEqual(diff.rewrite, []);
  assert.deepEqual(diff.unchanged, ['c0000001', 'c0000002']);
  // 用户手改第二条
  diff = diffRender(model, new Map([['c0000001', '[1]'], ['c0000002', '[2，见附录]']]), first.citations);
  assert.deepEqual(diff.manualEdits.map((edit) => edit.citeId), ['c0000002']);
  model = keepManualEdit(model, 'c0000002', '[2，见附录]');
  // 在前面插入一条新引用 → 编号变化；保留手改的那条仍跳过
  model = upsertCitation(model, { citeId: 'c0000000', items: [{ paperId: 'p-c' }], updatedAt: 2 });
  const reordered = ['c0000000', 'c0000001', 'c0000002'];
  const second = planRender(model, reordered, { hasBibliography: false });
  diff = diffRender(model, new Map([['c0000000', '[1]'], ['c0000001', '[1]'], ['c0000002', '[2，见附录]']]), second.citations);
  assert.deepEqual(diff.kept, ['c0000002']);
  assert.ok(diff.rewrite.includes('c0000001'), '编号从 [1] 变 [2] 必须重写');
});

test('复制粘贴导致的重复 citeId：第二次起拆成新 id 并复制引用明细；pruneModel 清孤立记录', () => {
  const model = modelWith([
    { citeId: 'c0000001', paperIds: ['p-a'] },
    { citeId: 'c0000009', paperIds: ['p-c'] },
  ]);
  const ordered = ['c0000001', 'c0000001', 'c0000001'];
  let counter = 0;
  const plan = planDuplicateSplit(ordered, () => `n000000${(counter += 1)}`);
  assert.deepEqual(plan.map((entry) => [entry.occurrence, entry.newCiteId]), [[1, 'n0000001'], [2, 'n0000002']]);
  const split = applyDuplicateSplit(model, ordered, plan);
  assert.deepEqual(split.ordered, ['c0000001', 'n0000001', 'n0000002']);
  assert.equal(split.model.citations.find((citation) => citation.citeId === 'n0000002')?.items[0].paperId, 'p-a');
  const pruned = pruneModel(split.model, split.ordered);
  assert.equal(pruned.citations.some((citation) => citation.citeId === 'c0000009'), false);
  assert.equal('p-c' in pruned.items, false, '不再被引用的快照被清掉');
  assert.equal('p-a' in pruned.items, true);
});
