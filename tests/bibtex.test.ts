import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCitationKey,
  escapeBibtexValue,
  inferBibtexEntryType,
  papersToBibtex,
  paperToBibtexEntry,
} from '../src/utils/bibtex.ts';
import type { LiteraturePaper } from '../src/types/library.ts';

function paper(overrides: Partial<LiteraturePaper> = {}): LiteraturePaper {
  return {
    id: overrides.id ?? 'paper-1',
    title: overrides.title ?? 'Electric VTOL design exploration',
    titleZh: overrides.titleZh ?? null,
    year: overrides.year ?? '2026',
    publication: overrides.publication ?? null,
    doi: overrides.doi ?? null,
    url: overrides.url ?? null,
    abstractText: overrides.abstractText ?? null,
    keywords: overrides.keywords ?? [],
    importedAt: 0,
    updatedAt: 0,
    lastReadAt: null,
    readingProgress: 0,
    isFavorite: false,
    userNote: null,
    aiSummary: null,
    citation: null,
    itemType: overrides.itemType ?? null,
    publisher: overrides.publisher ?? null,
    institution: overrides.institution ?? null,
    reportNumber: overrides.reportNumber ?? null,
    volume: overrides.volume ?? null,
    issue: overrides.issue ?? null,
    pages: overrides.pages ?? null,
    isbn: overrides.isbn ?? null,
    issn: overrides.issn ?? null,
    source: 'local',
    sortOrder: 0,
    authors: overrides.authors ?? [
      { id: 'a1', name: 'Xue Chen', givenName: 'Xue', familyName: 'Chen', sortOrder: 0 },
      { id: 'a2', name: 'Xuanyu Yao', givenName: 'Xuanyu', familyName: 'Yao', sortOrder: 1 },
    ],
    tags: [],
    categoryIds: [],
    attachments: [],
  };
}

test('escapeBibtexValue escapes BibTeX special characters', () => {
  assert.equal(escapeBibtexValue('A & B % 50%'), 'A \\& B \\% 50\\%');
  assert.equal(escapeBibtexValue('plain text'), 'plain text');
});

test('buildCitationKey combines family name, year and first significant title word', () => {
  assert.equal(buildCitationKey(paper()), 'chen2026electric');
  assert.equal(
    buildCitationKey(paper({ authors: [], title: 'The Study of Things', year: '' })),
    'paperstudy',
  );
});

test('buildCitationKey deduplicates with letter suffixes', () => {
  const used = new Set<string>();
  const first = buildCitationKey(paper(), used);
  const second = buildCitationKey(paper({ id: 'paper-2' }), used);

  assert.equal(first, 'chen2026electric');
  assert.equal(second, 'chen2026electricb');
});

test('inferBibtexEntryType heuristics and itemType support', () => {
  assert.equal(inferBibtexEntryType(paper({ itemType: 'book' })), 'book');
  assert.equal(inferBibtexEntryType(paper({ itemType: 'bookSection' })), 'incollection');
  assert.equal(inferBibtexEntryType(paper({ itemType: 'thesis', title: 'Deep Learning on Edge' })), 'phdthesis');
  assert.equal(inferBibtexEntryType(paper({ itemType: 'thesis', title: 'Master Thesis in Robotics' })), 'mastersthesis');
  assert.equal(inferBibtexEntryType(paper({ itemType: 'report' })), 'techreport');
  assert.equal(inferBibtexEntryType(paper({ publication: 'Journal of Aircraft' })), 'article');
  assert.equal(inferBibtexEntryType(paper({ publication: 'NeurIPS 2025' })), 'inproceedings');
  assert.equal(inferBibtexEntryType(paper({ publication: 'arXiv preprint' })), 'misc');
  assert.equal(inferBibtexEntryType(paper({ publication: null, doi: '10.1/x' })), 'article');
  assert.equal(inferBibtexEntryType(paper({ publication: null, doi: null })), 'misc');
});

test('paperToBibtexEntry renders fields and forced citation key', () => {
  const entry = paperToBibtexEntry(
    paper({ doi: '10.1234/vtol', titleZh: '电动垂直起降设计探索' }),
    { citationKey: 'chen2026electric' },
  );

  assert.match(entry, /^@article\{chen2026electric,/);
  assert.match(entry, /author = \{Chen, Xue and Yao, Xuanyu\}/);
  assert.match(entry, /year = \{2026\}/);
  assert.match(entry, /doi = \{10\.1234\/vtol\}/);
  // bibtex 方言下中文标题进入 note 字段
  assert.match(entry, /note = \{电动垂直起降设计探索\}/);
});

test('paperToBibtexEntry renders books, reports, and theses with academic fields', () => {
  const bookEntry = paperToBibtexEntry(
    paper({
      itemType: 'book',
      title: 'Reinforcement Learning: An Introduction',
      publisher: 'MIT Press',
      year: '2018',
      isbn: '978-0262039246',
      volume: '2',
    }),
    { citationKey: 'sutton2018reinforcement' },
  );
  assert.match(bookEntry, /^@book\{sutton2018reinforcement,/);
  assert.match(bookEntry, /publisher = \{MIT Press\}/);
  assert.match(bookEntry, /isbn = \{978-0262039246\}/);
  assert.match(bookEntry, /volume = \{2\}/);

  const reportEntry = paperToBibtexEntry(
    paper({
      itemType: 'report',
      title: 'GPT-4 Technical Report',
      institution: 'OpenAI',
      reportNumber: 'arXiv:2303.08774',
      year: '2023',
    }),
    { citationKey: 'openai2023gpt4' },
  );
  assert.match(reportEntry, /^@techreport\{openai2023gpt4,/);
  assert.match(reportEntry, /institution = \{OpenAI\}/);
  assert.match(reportEntry, /number = \{arXiv:2303\.08774\}/);

  const thesisEntry = paperToBibtexEntry(
    paper({
      itemType: 'thesis',
      title: 'Graph Representation Learning',
      institution: 'Stanford University',
      year: '2021',
    }),
    { citationKey: 'leskovec2021graph' },
  );
  assert.match(thesisEntry, /^@phdthesis\{leskovec2021graph,/);
  assert.match(thesisEntry, /school = \{Stanford University\}/);
});

test('papersToBibtex joins entries with blank lines and deduplicates keys', () => {
  const output = papersToBibtex([
    paper({ id: 'p1' }),
    paper({ id: 'p2' }),
  ]);

  const keys = [...output.matchAll(/^@\w+\{([^,]+),/gm)].map((match) => match[1]);
  assert.deepEqual(keys, ['chen2026electric', 'chen2026electricb']);
  assert.ok(output.endsWith('\n'));
});
