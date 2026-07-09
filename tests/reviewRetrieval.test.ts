import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cosineSimilarity,
  retrieveNotes,
  retrievePapers,
  scorePaper,
  tokenize,
} from '../src/features/review/reviewRetrieval.ts';
import type { LiteraturePaper } from '../src/types/library.ts';
import type { Note } from '../src/types/notes.ts';

function makePaper(overrides: Partial<LiteraturePaper> & { id: string; title: string }): LiteraturePaper {
  return {
    id: overrides.id,
    title: overrides.title,
    year: overrides.year ?? null,
    publication: overrides.publication ?? null,
    doi: overrides.doi ?? null,
    url: overrides.url ?? null,
    abstractText: overrides.abstractText ?? null,
    keywords: overrides.keywords ?? [],
    importedAt: overrides.importedAt ?? 0,
    updatedAt: overrides.updatedAt ?? 0,
    lastReadAt: overrides.lastReadAt ?? null,
    readingProgress: overrides.readingProgress ?? 0,
    isFavorite: overrides.isFavorite ?? false,
    userNote: overrides.userNote ?? null,
    aiSummary: overrides.aiSummary ?? null,
    citation: overrides.citation ?? null,
    source: overrides.source ?? 'local',
    sortOrder: overrides.sortOrder ?? 0,
    authors: overrides.authors ?? [],
    tags: overrides.tags ?? [],
    categoryIds: overrides.categoryIds ?? [],
    attachments: overrides.attachments ?? [],
  };
}

function makeNote(overrides: Partial<Note> & { id: string; title: string }): Note {
  return {
    id: overrides.id,
    title: overrides.title,
    content: overrides.content ?? '',
    contentText: overrides.contentText ?? null,
    excerpt: overrides.excerpt ?? '',
    anchors: overrides.anchors ?? [],
    tags: overrides.tags ?? [],
    updatedAt: overrides.updatedAt ?? 0,
    ...overrides,
  } as Note;
}

test('tokenize splits latin words and produces CJK bi-grams', () => {
  const tokens = tokenize('multimodal RAG 检索增强');
  assert.ok(tokens.includes('multimodal'));
  assert.ok(tokens.includes('rag'));
  // bi-grams of 检索增强
  assert.ok(tokens.includes('检索'));
  assert.ok(tokens.includes('索增'));
  assert.ok(tokens.includes('增强'));
});

test('different queries return different results', () => {
  const papers = [
    makePaper({ id: 'a', title: 'Multimodal RAG for document understanding', updatedAt: 1 }),
    makePaper({ id: 'b', title: 'Graph neural networks for molecules', updatedAt: 2 }),
    makePaper({ id: 'c', title: 'Diffusion models for image generation', updatedAt: 3 }),
  ];

  const rag = retrievePapers('multimodal RAG', papers).map((item) => item.paper.id);
  const graph = retrievePapers('graph neural networks', papers).map((item) => item.paper.id);

  assert.deepEqual(rag, ['a']);
  assert.deepEqual(graph, ['b']);
  assert.notDeepEqual(rag, graph);
});

test('empty query returns empty results', () => {
  const papers = [makePaper({ id: 'a', title: 'Anything', updatedAt: 5 })];
  assert.deepEqual(retrievePapers('', papers), []);
  assert.deepEqual(retrievePapers('   ', papers), []);
  assert.deepEqual(retrieveNotes('', [makeNote({ id: 'n', title: 'note' })]), []);
});

test('query with no matches returns empty (no recent-N fallback)', () => {
  const papers = [
    makePaper({ id: 'a', title: 'Graph neural networks', updatedAt: 100 }),
    makePaper({ id: 'b', title: 'Diffusion models', updatedAt: 200 }),
  ];
  // Even though the library is small (<=12), unrelated query must NOT return papers.
  assert.deepEqual(retrievePapers('quantum cryptography blockchain', papers), []);
});

test('Chinese bi-gram query matches Chinese titles/abstracts', () => {
  const papers = [
    makePaper({ id: 'a', title: '多模态检索增强生成综述', updatedAt: 1 }),
    makePaper({ id: 'b', title: '图神经网络在分子设计中的应用', updatedAt: 2 }),
    makePaper({
      id: 'c',
      title: 'Unrelated English title',
      abstractText: '本文研究检索增强生成在阅读中的应用',
      updatedAt: 3,
    }),
  ];

  const ids = retrievePapers('检索增强', papers).map((item) => item.paper.id);
  assert.ok(ids.includes('a'));
  assert.ok(ids.includes('c'));
  assert.ok(!ids.includes('b'));
});

test('field weighting ranks title hit above abstract-only hit', () => {
  const titleHit = makePaper({ id: 'title', title: 'transformer architectures', updatedAt: 1 });
  const abstractHit = makePaper({
    id: 'abstract',
    title: 'Some unrelated heading',
    abstractText: 'we discuss transformer layers in passing',
    updatedAt: 999,
  });

  const ranked = retrievePapers('transformer', [abstractHit, titleHit]).map((item) => item.paper.id);
  assert.deepEqual(ranked, ['title', 'abstract']);
  assert.ok(scorePaper(tokenize('transformer'), titleHit) > scorePaper(tokenize('transformer'), abstractHit));
});

test('cosineSimilarity behaves correctly', () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([], [1]), 0);
  assert.ok(cosineSimilarity([1, 1], [2, 2]) > 0.99);
});
