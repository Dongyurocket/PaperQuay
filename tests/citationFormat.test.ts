/**
 * 引用格式化真源（`src/shared/citation/`）的单元测试。
 *
 * 该模块是笔记、Electron 桥、Word 加载项三端共用的唯一实现，因此这里的断言同时也是
 * 三端的行为契约：编号派生、GB/T 7714 的条目形态、著者-出版年制、文档标签编解码。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CITATION_STYLE_IDS,
  DEFAULT_CITATION_STYLE,
  assignCitationNumbers,
  buildBibliographyEntryParagraph,
  buildNumericCitationOoxml,
  citationBookmarkName,
  citationStyleKind,
  collapseSeqRanges,
  encodeCitationControlTag,
  escapeXmlText,
  extractBibliographyTagCount,
  extractCitationControlTagsFromOoxml,
  findStoredCitation,
  formatBibliographyEntry,
  formatBibliographyLines,
  formatNumberRanges,
  getCitationStyle,
  hasBibliographyControlInOoxml,
  isBibliographyControlTag,
  normalizeCitationItem,
  normalizeCitationStyle,
  normalizeStoredCitations,
  parseCitationControlTag,
  removeStoredCitation,
  renderCitations,
  serializeStoredCitations,
  upsertStoredCitation,
  wrapAffixes,
  type CitationPaperLike,
  type StoredCitation,
} from '../src/shared/citation/index.ts';

const journalPaper: CitationPaperLike = {
  id: 'p-journal',
  title: '深度学习综述',
  year: '2021',
  itemType: 'journalArticle',
  publication: '计算机学报',
  volume: '44',
  issue: '3',
  pages: '1-25',
  authors: [{ name: '张三' }, { name: '李四' }, { name: '王五' }, { name: '赵六' }],
};

const conferencePaper: CitationPaperLike = {
  id: 'p-conf',
  title: 'Attention Is All You Need',
  year: '2017',
  itemType: 'conferencePaper',
  publication: 'NeurIPS',
  volume: '30',
  authors: [{ name: 'Ashish Vaswani' }],
};

const bookPaper: CitationPaperLike = {
  id: 'p-book',
  title: '统计学习方法',
  year: '2019',
  itemType: 'book',
  publisher: '清华大学出版社',
  publisherPlace: '北京',
  authors: [{ name: '李航' }],
};

const structuredPaper: CitationPaperLike = {
  id: 'p-struct',
  title: 'Deep Learning',
  year: '2015',
  itemType: 'journalArticle',
  publication: 'Nature',
  volume: '521',
  authors: [{ name: 'Yann LeCun', givenName: 'Yann', familyName: 'LeCun' }],
};

function resolver(papers: CitationPaperLike[]) {
  const byId = new Map(papers.map((paper) => [paper.id as string, paper]));
  return (paperId: string) => byId.get(paperId);
}

test('引用样式注册表：id 集合、默认值与未知值回退', () => {
  assert.deepEqual([...CITATION_STYLE_IDS], ['gbt7714', 'gbt7714-87', 'gbt7714-author-date', 'apa7', 'ieee']);
  assert.equal(DEFAULT_CITATION_STYLE, 'gbt7714');
  assert.equal(citationStyleKind('gbt7714'), 'numeric');
  assert.equal(citationStyleKind('gbt7714-87'), 'numeric');
  assert.equal(citationStyleKind('ieee'), 'numeric');
  assert.equal(citationStyleKind('apa7'), 'author-date');
  assert.equal(citationStyleKind('gbt7714-author-date'), 'author-date');
  assert.equal(normalizeCitationStyle('apa7'), 'apa7');
  assert.equal(normalizeCitationStyle('gbt7714-87'), 'gbt7714-87');
  assert.equal(normalizeCitationStyle('unknown'), 'gbt7714');
  assert.equal(normalizeCitationStyle(undefined), 'gbt7714');
  assert.equal(getCitationStyle('ieee').kind, 'numeric');
  assert.equal(getCitationStyle('nope').id, 'gbt7714');
});

test('编号派生：同文献同号、按首次出现顺序、连续区间折叠', () => {
  const numbers = assignCitationNumbers([
    { paperId: 'b' },
    { paperId: 'a' },
    { paperId: 'b' },
  ]);
  assert.equal(numbers.get('b'), 1);
  assert.equal(numbers.get('a'), 2);
  assert.equal(numbers.size, 2);

  assert.equal(formatNumberRanges([3, 1, 2, 5]), '1-3,5');
  assert.equal(formatNumberRanges([2, 2]), '2');
  assert.equal(formatNumberRanges([1, 2, 3, 4]), '1-4');
  assert.equal(formatNumberRanges([]), '');
  assert.equal(formatNumberRanges([0, -3, Number.NaN]), '');
});

test('引用条目归一化：保留后缀句点、丢弃无 paperId 的输入', () => {
  const item = normalizeCitationItem({ paperId: ' p1 ', suffix: '。', prefix: ' 参见 ', locator: '25' });
  assert.deepEqual(item, {
    paperId: 'p1',
    label: null,
    locator: '25',
    prefix: '参见',
    suffix: '。',
    suppressAuthor: false,
  });
  assert.equal(normalizeCitationItem({ locator: '25' }), null);
  assert.equal(normalizeCitationItem(null), null);
});

test('前后缀拼装：前缀补空格（开括号除外）、后缀标点不吞句点', () => {
  assert.equal(wrapAffixes('[1]', '参见', '。'), '参见 [1]。');
  assert.equal(wrapAffixes('[1]', '（', '）'), '（[1]）');
  assert.equal(wrapAffixes('[1]', '（见', '）'), '（见 [1]）');
  assert.equal(wrapAffixes('[1]', '参见', 'pp. 5'), '参见 [1] pp. 5');
  assert.equal(wrapAffixes('[1]', null, null), '[1]');
});

test('GB/T 7714 条目形态：期刊、会议、专著出版地、结构化西文作者', () => {
  assert.equal(
    formatBibliographyEntry(journalPaper, '', 'gbt7714'),
    '张三, 李四, 王五, 等. 深度学习综述[J]. 计算机学报, 2021, 44(3): 1-25.',
  );
  assert.equal(
    formatBibliographyEntry(conferencePaper, '', 'gbt7714'),
    'Ashish Vaswani. Attention Is All You Need[C]//NeurIPS. 2017, 30.',
  );
  assert.equal(
    formatBibliographyEntry(bookPaper, '', 'gbt7714'),
    '李航. 统计学习方法[M]. 北京: 清华大学出版社, 2019.',
  );
  // 有结构化姓名时用「姓 + 名首字母」；只有 name 时保持原样（旧数据不劣化）。
  const structured = formatBibliographyEntry(structuredPaper, '', 'gbt7714');
  assert.match(structured, /^LeCun Y\. Deep Learning\[J\]\. Nature, 2015, 521\.$/);
  assert.doesNotMatch(structured, /Yann LeCun/);
});

test('GB 7714-87（CAJ-CD）：全角标点、西文姓全大写、论文集 [A]…[C]、3 名截断', () => {
  // 期刊：作者.题名[J].刊名，年，卷（期）：页码.（4 名作者截断为前 3 + 等）
  assert.equal(
    formatBibliographyEntry(journalPaper, '', 'gbt7714-87'),
    '张三，李四，王五，等.深度学习综述[J].计算机学报，2021，44（3）：1-25.',
  );
  // 结构化西文作者：姓全大写 + 名缩写不加缩写点
  assert.equal(
    formatBibliographyEntry(structuredPaper, '', 'gbt7714-87'),
    'LECUN Y.Deep Learning[J].Nature，2015，521.',
  );
  // 论文集析出：题名[A].论文集名[C].年.（87 规范的论文集格式不含卷期）
  assert.equal(
    formatBibliographyEntry(conferencePaper, '', 'gbt7714-87'),
    'Ashish Vaswani.Attention Is All You Need[A].NeurIPS[C].2017.',
  );
  // 专著：书名[M].出版地：出版者，年.
  assert.equal(
    formatBibliographyEntry(bookPaper, '', 'gbt7714-87'),
    '李航.统计学习方法[M].北京：清华大学出版社，2019.',
  );
  // 学位论文：题名[D].保存地点：保存单位，年.
  assert.equal(
    formatBibliographyEntry(
      {
        id: 'p-thesis',
        title: '基于深度学习的机器翻译研究',
        itemType: 'thesis',
        institution: '清华大学',
        publisherPlace: '北京',
        year: '2020',
        authors: [{ name: '王芳' }],
      },
      '',
      'gbt7714-87',
    ),
    '王芳.基于深度学习的机器翻译研究[D].北京：清华大学，2020.',
  );
  // 电子文献：题名[EB/OL].年.路径.
  assert.equal(
    formatBibliographyEntry(
      {
        id: 'p-web',
        title: '某在线资源',
        itemType: 'webpage',
        url: 'https://example.com/x',
        year: '2021',
        authors: [{ name: '张三' }],
      },
      '',
      'gbt7714-87',
    ),
    '张三.某在线资源[EB/OL].2021.https://example.com/x.',
  );
  // 西文 4 名结构化作者：前 3 名 + ，et al
  const westernFour: CitationPaperLike = {
    id: 'p-west4',
    title: 'Some Paper',
    itemType: 'journalArticle',
    publication: 'Nature',
    year: '2020',
    authors: [
      { name: 'Yann LeCun', givenName: 'Yann', familyName: 'LeCun' },
      { name: 'Yoshua Bengio', givenName: 'Yoshua', familyName: 'Bengio' },
      { name: 'Geoffrey Hinton', givenName: 'Geoffrey', familyName: 'Hinton' },
      { name: 'Ashish Vaswani', givenName: 'Ashish', familyName: 'Vaswani' },
    ],
  };
  assert.equal(
    formatBibliographyEntry(westernFour, '', 'gbt7714-87'),
    'LECUN Y，BENGIO Y，HINTON G，et al.Some Paper[J].Nature，2020.',
  );
});

test('GB 7714-87 标点开关：half 输出半角标点带空格', () => {
  assert.equal(
    formatBibliographyEntry(journalPaper, '', 'gbt7714-87', { punctuation: 'half' }),
    '张三, 李四, 王五, 等. 深度学习综述[J]. 计算机学报, 2021, 44(3): 1-25.',
  );
  assert.equal(
    formatBibliographyEntry(structuredPaper, '', 'gbt7714-87', { punctuation: 'half' }),
    'LECUN Y. Deep Learning[J]. Nature, 2015, 521.',
  );
  assert.equal(
    formatBibliographyEntry(bookPaper, '', 'gbt7714-87', { punctuation: 'half' }),
    '李航. 统计学习方法[M]. 北京: 清华大学出版社, 2019.',
  );
  assert.equal(
    formatBibliographyEntry(conferencePaper, '', 'gbt7714-87', { punctuation: 'half' }),
    'Ashish Vaswani. Attention Is All You Need[A]. NeurIPS[C]. 2017.',
  );
  // renderCitations 透传 punctuation；其他样式不受影响
  const render = renderCitations(
    { style: 'gbt7714-87', punctuation: 'half', items: [{ paperId: 'p-journal' }] },
    resolver([journalPaper]),
  );
  assert.equal(render.entries[0]?.text, '张三, 李四, 王五, 等. 深度学习综述[J]. 计算机学报, 2021, 44(3): 1-25.');
  const renderOther = renderCitations(
    { style: 'gbt7714', punctuation: 'half', items: [{ paperId: 'p-journal' }] },
    resolver([journalPaper]),
  );
  assert.equal(renderOther.entries[0]?.text, '张三, 李四, 王五, 等. 深度学习综述[J]. 计算机学报, 2021, 44(3): 1-25.');
});

test('交叉引用 OOXML：书签名、区间折叠、XML 转义', () => {
  assert.equal(citationBookmarkName('p-abc_123'), 'r_p_abc_123');
  assert.ok(citationBookmarkName('x').startsWith('r_'));
  assert.deepEqual(collapseSeqRanges([3, 1, 2, 5]), [
    [1, 3],
    [5, 5],
  ]);
  assert.deepEqual(collapseSeqRanges([2, 2, 0, -1]), [[2, 2]]);
  assert.equal(escapeXmlText('a<b>&"c"'), 'a&lt;b&gt;&amp;&quot;c&quot;');
});

test('交叉引用 OOXML：正文引用域与文献表书签段落', () => {
  const seqByPaperId = new Map([
    ['p-a', 1],
    ['p-b', 2],
    ['p-c', 3],
    ['p-e', 5],
  ]);
  // 多篇连续折叠：[1-3] 只建首尾两个 REF 域，分别指向序号 1 和 3 的书签
  const multi = buildNumericCitationOoxml(
    [{ paperId: 'p-a' }, { paperId: 'p-b' }, { paperId: 'p-c' }],
    seqByPaperId,
  );
  assert.ok(multi);
  assert.ok(multi!.startsWith('<w:r><w:t xml:space="preserve">[</w:t></w:r>'));
  assert.equal((multi!.match(/<w:fldSimple/g) || []).length, 2);
  assert.match(multi!, /w:instr=" REF r_p_a \\h "/);
  assert.match(multi!, /w:instr=" REF r_p_c \\h "/);
  // 单篇带页码与前后缀：间距规则与 formatNumericInline 一致
  const single = buildNumericCitationOoxml(
    [{ paperId: 'p-e', locator: '25', prefix: '参见', suffix: '。' }],
    seqByPaperId,
  );
  assert.ok(single);
  assert.ok(single!.includes('>参见 </w:t>'));
  assert.ok(single!.includes('REF r_p_e'));
  assert.ok(single!.includes('>25</w:t>'));
  assert.ok(single!.endsWith('<w:r><w:t xml:space="preserve">。</w:t></w:r>'));
  // 缺序号的文献返回 null（调用方退化纯文本）
  assert.equal(buildNumericCitationOoxml([{ paperId: 'missing' }], seqByPaperId), null);
  // 文献表段落：序号包书签、文本转义
  const paragraph = buildBibliographyEntryParagraph(1, '张三. 标题 <含>&特殊字符', 'p-a', 42);
  assert.match(paragraph, /<w:bookmarkStart w:id="42" w:name="r_p_a"\/>/);
  assert.match(paragraph, /<w:bookmarkEnd w:id="42"\/>/);
  assert.match(paragraph, /&lt;含&gt;&amp;特殊字符/);
  // author-date 无序号：不建书签
  const plain = buildBibliographyEntryParagraph(null, '某某条目', 'p-a', 43);
  assert.doesNotMatch(plain, /bookmarkStart/);
});

test('数字年份/卷期不再被丢弃（导入链路可能给数字）', () => {
  const numeric: CitationPaperLike = {
    id: 'p-numeric',
    title: '数字字段',
    year: 2021,
    itemType: 'journalArticle',
    publication: '某刊',
    volume: 12,
    issue: 3,
    pages: '1-10',
  };
  assert.equal(
    formatBibliographyEntry(numeric, '', 'gbt7714'),
    '数字字段[J]. 某刊, 2021, 12(3): 1-10.',
  );
});

test('文献已移出库：用插入时的标题快照兜底并列入 missingPaperIds', () => {
  assert.equal(formatBibliographyEntry(undefined, 'Unknown Paper', 'gbt7714'), 'Unknown Paper.');
  const result = renderCitations(
    {
      style: 'gbt7714',
      groups: [{ citeId: 'c1', items: [{ paperId: 'gone', label: 'Snapshot Title' }] }],
    },
    () => undefined,
  );
  assert.equal(result.groups[0].inline, '[1]');
  assert.equal(result.entries[0].text, 'Snapshot Title.');
  assert.equal(result.entries[0].missing, true);
  assert.deepEqual(result.missingPaperIds, ['gone']);
});

test('顺序编码制内联：连续折叠、单条带页码、多篇同组', () => {
  const papers: CitationPaperLike[] = ['p1', 'p2', 'p3', 'p4'].map((id) => ({
    id,
    title: `题名 ${id}`,
    year: '2020',
    itemType: 'journalArticle',
    publication: '刊',
  }));
  const result = renderCitations(
    {
      style: 'gbt7714',
      groups: [
        { citeId: 'c1', items: [{ paperId: 'p1' }, { paperId: 'p2' }, { paperId: 'p3' }] },
        { citeId: 'c2', items: [{ paperId: 'p4', locator: '25' }] },
         { citeId: 'c3', items: [{ paperId: 'p1' }, { paperId: 'p4' }] },
      ],
    },
    resolver(papers),
  );
  assert.equal(result.groups[0].inline, '[1-3]');
  assert.equal(result.groups[1].inline, '[4]25');
  assert.equal(result.groups[2].inline, '[1,4]');
  // 文献表行有编号前缀，但 entries[].text 保持无前缀（加载项自己拼 [seq]）。
  assert.deepEqual(result.bibliography.split('\n'), [
    '[1] 题名 p1[J]. 刊, 2020.',
    '[2] 题名 p2[J]. 刊, 2020.',
    '[3] 题名 p3[J]. 刊, 2020.',
    '[4] 题名 p4[J]. 刊, 2020.',
  ]);
  assert.equal(result.entries[0].text, '题名 p1[J]. 刊, 2020.');
  assert.equal(formatBibliographyLines('author-date', result.entries)[0], '题名 p1[J]. 刊, 2020.');
});

test('著者-出版年制：内联标签、抑制作者、文献表年份不重复', () => {
  const cjk = renderCitations(
    { style: 'gbt7714-author-date', items: [{ paperId: 'p-journal' }] },
    resolver([journalPaper]),
  );
  assert.equal(cjk.kind, 'author-date');
  assert.equal(cjk.inline, '(张三 等, 2021)');
  assert.equal(cjk.entries[0].text, '张三, 李四, 王五, 等. 2021. 深度学习综述[J]. 计算机学报, 44(3): 1-25.');
  assert.equal(cjk.bibliography, cjk.entries[0].text);

  const apa = renderCitations({ style: 'apa7', items: [{ paperId: 'p-journal' }] }, resolver([journalPaper]));
  assert.equal(apa.inline, '(张三 et al., 2021)');

  const suppressed = renderCitations(
    { style: 'gbt7714-author-date', items: [{ paperId: 'p-journal', suppressAuthor: true, locator: '25' }] },
    resolver([journalPaper]),
  );
  assert.equal(suppressed.inline, '(2021, 25)');
});

test('著者-出版年制文献表：默认按首作者字母序，可切回引用顺序', () => {
  const papers: CitationPaperLike[] = [
    {
      id: 'p-smith',
      title: 'Smith Paper',
      year: '2020',
      itemType: 'journalArticle',
      publication: 'X',
      authors: [{ name: 'J Smith', givenName: 'J', familyName: 'Smith' }],
    },
    {
      id: 'p-alpha',
      title: 'Alpha Paper',
      year: '2019',
      itemType: 'journalArticle',
      publication: 'Y',
      authors: [{ name: 'B Alpha', givenName: 'B', familyName: 'Alpha' }],
    },
  ];
  const groups = [
    { citeId: 'c1', items: [{ paperId: 'p-smith' }] },
    { citeId: 'c2', items: [{ paperId: 'p-alpha' }] },
  ];
  const alpha = renderCitations({ style: 'apa7', groups }, resolver(papers));
  assert.deepEqual(alpha.entries.map((entry) => entry.paperId), ['p-alpha', 'p-smith']);

  const appearance = renderCitations(
    { style: 'apa7', groups, bibliographyOrder: 'appearance' },
    resolver(papers),
  );
  assert.deepEqual(appearance.entries.map((entry) => entry.paperId), ['p-smith', 'p-alpha']);
});

test('文档标签：引用域编码/解析与文献表标签识别', () => {
  assert.equal(encodeCitationControlTag('ab12cd34'), 'pq:c|ab12cd34');
  assert.equal(parseCitationControlTag('pq:c|ab12cd34'), 'ab12cd34');
  assert.equal(parseCitationControlTag('pq:bib'), null);
  assert.equal(parseCitationControlTag('pq:c|xy'), null);
  assert.equal(parseCitationControlTag(undefined), null);
  assert.equal(isBibliographyControlTag('pq:bib'), true);
  assert.equal(isBibliographyControlTag(' pq:bib '), true);
  assert.equal(isBibliographyControlTag('pq:c|ab12cd34'), false);
});

test('OOXML 扫描：按文档顺序取 citeId、忽略非引用标签', () => {
  const ooxml = [
    '<w:sdt><w:sdtPr><w:tag w:val="pq:c|aaaa1111"/></w:sdtPr><w:sdtContent>正文</w:sdtContent></w:sdt>',
    '<w:sdt><w:sdtPr><w:tag w:val="pq:c|bbbb2222"/></w:sdtPr><w:sdtContent>[2]</w:sdtContent></w:sdt>',
    '<w:sdt><w:sdtPr><w:tag w:val="pq:bib"/></w:sdtPr><w:sdtContent>参考文献</w:sdtContent></w:sdt>',
    '<w:sdt><w:sdtPr><w:tag w:val="pq:c|cccc3333"/></w:sdtPr><w:sdtContent>[3]</w:sdtContent></w:sdt>',
  ].join('');
  assert.deepEqual(extractCitationControlTagsFromOoxml(ooxml), ['aaaa1111', 'bbbb2222', 'cccc3333']);
  assert.equal(extractBibliographyTagCount(ooxml), 1);
  assert.equal(hasBibliographyControlInOoxml(ooxml), true);
  assert.deepEqual(extractCitationControlTagsFromOoxml(''), []);
  assert.equal(hasBibliographyControlInOoxml(null), false);
});

test('文档设置里的引用明细：序列化/反序列化与增删改查', () => {
  const citations = normalizeStoredCitations(
    JSON.stringify([
      { citeId: 'AAAA1111', items: [{ paperId: 'p1', locator: '25' }], updatedAt: 5 },
      { citeId: 'bad', items: [{ paperId: 'p2' }] },
      { citeId: 'bbbb2222', items: [] },
      'not-an-object',
    ]),
  );
  assert.equal(citations.length, 1);
  assert.equal(citations[0].citeId, 'aaaa1111');
  assert.equal(citations[0].items[0].locator, '25');
  assert.deepEqual(normalizeStoredCitations('{oops'), []);

  const added: StoredCitation = { citeId: 'cccc3333', items: [{ paperId: 'p3' }], updatedAt: 9 };
  const withAdded = upsertStoredCitation(citations, added);
  assert.equal(withAdded.length, 2);
  assert.equal(findStoredCitation(withAdded, 'cccc3333')?.updatedAt, 9);

  const replaced = upsertStoredCitation(withAdded, { ...added, updatedAt: 10 });
  assert.equal(replaced.length, 2);
  assert.equal(findStoredCitation(replaced, 'cccc3333')?.updatedAt, 10);

  // 往返会补齐规范化字段（null/false），因此只比对身份与关键内容。
  const roundTrip = normalizeStoredCitations(serializeStoredCitations(replaced));
  assert.deepEqual(roundTrip.map((item) => [item.citeId, item.updatedAt]), [
    ['aaaa1111', 5],
    ['cccc3333', 10],
  ]);
  assert.equal(roundTrip[1].items[0].paperId, 'p3');
  assert.deepEqual(removeStoredCitation(replaced, 'cccc3333').map((item) => item.citeId), ['aaaa1111']);
});
