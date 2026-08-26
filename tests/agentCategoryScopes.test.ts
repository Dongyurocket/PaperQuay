import test from 'node:test';
import assert from 'node:assert/strict';

import {
  categoryDescendantIds,
  categoryPathForAgent,
  findMentionedCategoryScope,
  hasExplicitFullLibraryScope,
  normalizeCategoryScopeText,
  papersForCategoryScope,
  shouldUseFullLibraryCandidateSet,
} from '../src/features/agent/agentCategoryScopes.ts';
import type { LiteratureCategory, LiteraturePaper } from '../src/types/library.ts';

function category(overrides: Partial<LiteratureCategory> & Pick<LiteratureCategory, 'id' | 'name'>): LiteratureCategory {
  return {
    id: overrides.id,
    name: overrides.name,
    parentId: overrides.parentId ?? null,
    sortOrder: overrides.sortOrder ?? 0,
    isSystem: overrides.isSystem ?? false,
    systemKey: overrides.systemKey ?? null,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    paperCount: overrides.paperCount ?? 0,
  };
}

function paper(overrides: Partial<LiteraturePaper> & Pick<LiteraturePaper, 'id' | 'title'>): LiteraturePaper {
  return {
    id: overrides.id,
    title: overrides.title,
    titleZh: overrides.titleZh ?? null,
    year: overrides.year ?? null,
    publication: overrides.publication ?? null,
    doi: overrides.doi ?? null,
    url: overrides.url ?? null,
    abstractText: overrides.abstractText ?? null,
    keywords: overrides.keywords ?? [],
    importedAt: overrides.importedAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
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

test('full-library scope detection separates discovery from write requests', () => {
  assert.equal(hasExplicitFullLibraryScope('Use my full library for RAG'), true);
  assert.equal(shouldUseFullLibraryCandidateSet('recommend related papers about retrieval'), true);
  assert.equal(shouldUseFullLibraryCandidateSet('update metadata for selected papers'), false);
});

test('normalizeCategoryScopeText strips punctuation used around category mentions', () => {
  assert.equal(normalizeCategoryScopeText('AI / RAG："Graph-Learning"'), 'airaggraphlearning');
});

test('categoryDescendantIds includes non-system descendants only', () => {
  const root = category({ id: 'c-root', name: 'AI' });
  const child = category({ id: 'c-child', name: 'RAG', parentId: root.id });
  const grandchild = category({ id: 'c-grandchild', name: 'Graph RAG', parentId: child.id });
  const systemChild = category({
    id: 'c-system',
    name: 'Recent',
    parentId: root.id,
    isSystem: true,
    systemKey: 'recent',
  });

  assert.deepEqual(
    [...categoryDescendantIds(root, [root, child, grandchild, systemChild])].sort(),
    ['c-child', 'c-grandchild', 'c-root'],
  );
});

test('papersForCategoryScope returns papers from a category subtree', () => {
  const root = category({ id: 'c-root', name: 'AI' });
  const child = category({ id: 'c-child', name: 'RAG', parentId: root.id });
  const unrelated = category({ id: 'c-other', name: 'HCI' });
  const papers = [
    paper({ id: 'p-root', title: 'Root', categoryIds: [root.id] }),
    paper({ id: 'p-child', title: 'Child', categoryIds: [child.id] }),
    paper({ id: 'p-other', title: 'Other', categoryIds: [unrelated.id] }),
    paper({ id: 'p-none', title: 'None' }),
  ];

  assert.deepEqual(
    papersForCategoryScope(root, [root, child, unrelated], papers).map((item) => item.id),
    ['p-root', 'p-child'],
  );
});

test('findMentionedCategoryScope prefers the most specific category path', () => {
  const root = category({ id: 'c-root', name: 'Machine Learning', paperCount: 3 });
  const child = category({ id: 'c-child', name: 'Graph Learning', parentId: root.id, paperCount: 2 });
  const categories = [root, child];
  const papers = [
    paper({ id: 'p-root', title: 'Root', categoryIds: [root.id] }),
    paper({ id: 'p-child', title: 'Child', categoryIds: [child.id] }),
  ];

  const match = findMentionedCategoryScope(
    'please review Machine Learning / Graph Learning papers',
    categories,
    papers,
  );

  assert.equal(match?.category.id, child.id);
  assert.equal(match?.path, 'Machine Learning / Graph Learning');
  assert.deepEqual(match?.papers.map((item) => item.id), ['p-child']);
});

test('findMentionedCategoryScope supports system category aliases', () => {
  const favorites = category({
    id: 'favorites',
    name: 'Favorites',
    isSystem: true,
    systemKey: 'favorites',
  });
  const papers = [
    paper({ id: 'p-fav', title: 'Favorite', isFavorite: true }),
    paper({ id: 'p-plain', title: 'Plain' }),
  ];

  const match = findMentionedCategoryScope('show favorite papers', [favorites], papers);

  assert.equal(categoryPathForAgent(favorites, new Map([[favorites.id, favorites]])), '收藏');
  assert.equal(match?.category.id, favorites.id);
  assert.deepEqual(match?.papers.map((item) => item.id), ['p-fav']);
});
