import test from 'node:test';
import assert from 'node:assert/strict';
import type { LiteraturePaper } from '../src/types/library.ts';
import {
  formatBibliographyEntry,
  formatInlineApaCitation,
  normalizeNoteCitationStyle,
} from '../src/features/notes/bibliography.ts';

const journalPaper = {
  id: 'paper-j1',
  title: 'Attention Is All You Need',
  authors: [
    { name: 'Ashish Vaswani' },
    { name: 'Noam Shazeer' },
    { name: 'Niki Parmar' },
    { name: 'Jakob Uszkoreit' },
  ],
  year: '2017',
  publication: 'Advances in Neural Information Processing Systems',
  volume: '30',
  issue: null,
  pages: '5998-6008',
  doi: '10.48550/arXiv.1706.03762',
  url: 'https://arxiv.org/abs/1706.03762',
  itemType: 'conferencePaper',
} as unknown as LiteraturePaper;

const chinesePaper = {
  id: 'paper-c1',
  title: '深度学习综述',
  authors: [{ name: '张三' }, { name: '李四' }, { name: '王五' }, { name: '赵六' }],
  year: '2021',
  publication: '计算机学报',
  volume: '44',
  issue: '3',
  pages: '1-25',
  doi: null,
  url: null,
  itemType: 'journalArticle',
} as unknown as LiteraturePaper;

test('normalizeNoteCitationStyle falls back to gbt7714', () => {
  assert.equal(normalizeNoteCitationStyle('apa7'), 'apa7');
  assert.equal(normalizeNoteCitationStyle('ieee'), 'ieee');
  assert.equal(normalizeNoteCitationStyle('gbt7714'), 'gbt7714');
  assert.equal(normalizeNoteCitationStyle('unknown'), 'gbt7714');
  assert.equal(normalizeNoteCitationStyle(undefined), 'gbt7714');
});

test('GB/T 7714 journal entry: authors. title[J]. venue, year, volume(issue): pages', () => {
  assert.equal(
    formatBibliographyEntry(chinesePaper, '', 'gbt7714'),
    '张三, 李四, 王五, 等. 深度学习综述[J]. 计算机学报, 2021, 44(3): 1-25.',
  );
});

test('GB/T 7714 western authors use et al. after 3, conference paper gets [C]', () => {
  assert.equal(
    formatBibliographyEntry(journalPaper, '', 'gbt7714'),
    'Ashish Vaswani, Noam Shazeer, Niki Parmar, et al. Attention Is All You Need[C]. Advances in Neural Information Processing Systems, 2017, 30: 5998-6008. DOI: 10.48550/arXiv.1706.03762.',
  );
});

test('APA 7 entry: Author, A. A., & Author, B. B. (Year). Title. Venue, Volume(Issue), pages. doi url', () => {
  assert.equal(
    formatBibliographyEntry(journalPaper, '', 'apa7'),
    'Vaswani, A., Shazeer, N., Parmar, N., et al. (2017). Attention Is All You Need. Advances in Neural Information Processing Systems, 30, 5998-6008. https://doi.org/10.48550/arXiv.1706.03762',
  );
});

test('IEEE entry: initials first, quoted title, vol/no/pp', () => {
  assert.equal(
    formatBibliographyEntry(chinesePaper, '', 'ieee'),
    '张三, 李四, 王五, et al., "深度学习综述," 计算机学报, vol. 44, no. 3, pp. 1-25, 2021.',
  );
});

test('formatBibliographyEntry falls back to label when paper is missing', () => {
  assert.equal(formatBibliographyEntry(undefined, 'Unknown Paper', 'gbt7714'), 'Unknown Paper.');
});

test('formatInlineApaCitation renders (first author et al., year)', () => {
  assert.equal(formatInlineApaCitation(journalPaper, ''), '(Vaswani et al., 2017)');
  assert.equal(formatInlineApaCitation(chinesePaper, ''), '(张三 et al., 2021)');
  assert.equal(
    formatInlineApaCitation(
      { ...chinesePaper, authors: [{ name: '张三' }, { name: '李四' }] } as LiteraturePaper,
      '',
    ),
    '(张三 & 李四, 2021)',
  );
  assert.equal(
    formatInlineApaCitation(
      { ...chinesePaper, authors: [{ name: '张三' }] } as LiteraturePaper,
      '',
    ),
    '(张三, 2021)',
  );
  assert.equal(formatInlineApaCitation(undefined, 'Some Paper'), '(Some Paper)');
});
