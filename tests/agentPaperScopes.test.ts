import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveAgentWorkspacePaperScope } from '../src/features/agent/agentPaperScopes.ts';
import { resolveAgentPaperScope } from '../src/services/agentPaperScope.ts';
import type { LiteratureCategory, LiteraturePaper } from '../src/types/library.ts';
import type { AgentChatMessage } from '../src/features/agent/AgentWorkspace.types.ts';

function paper(id: string, categoryIds: string[] = []): LiteraturePaper {
  return {
    id, title: id, titleZh: null, year: null, publication: null, doi: null, url: null,
    abstractText: null, keywords: [], importedAt: 1, updatedAt: 1, lastReadAt: null,
    readingProgress: 0, isFavorite: false, userNote: null, aiSummary: null, citation: null,
    source: 'local', sortOrder: 0, authors: [], tags: [], categoryIds, attachments: [],
  };
}

function category(id: string, name: string): LiteratureCategory {
  return { id, name, parentId: null, sortOrder: 0, isSystem: false, systemKey: null, createdAt: 1, updatedAt: 1, paperCount: 0 };
}

function scopedMessage(paperScopeIds: string[]): AgentChatMessage {
  return { id: 'history', role: 'user', content: '请分析这些论文', createdAt: 1, paperScopeIds };
}

const papers = [paper('paper-a', ['category-a']), paper('paper-b', ['category-b'])];
const categories = [category('category-a', '旧分类'), category('category-b', '新分类'), category('category-empty', '空分类')];
const input = {
  instruction: '继续分析', papers, categories, messages: [scopedMessage(['paper-a'])],
  selectedPaperIds: new Set<string>(), ragEnabled: true,
};

test('new full-library and category requests take precedence over the historical paper scope', () => {
  const fullLibrary = resolveAgentWorkspacePaperScope({ ...input, instruction: '检索全库论文' });
  assert.equal(fullLibrary.source, 'full-library');
  assert.deepEqual(fullLibrary.paperIds, ['paper-a', 'paper-b']);
  const newCategory = resolveAgentWorkspacePaperScope({ ...input, instruction: '检索新分类中的全部文献' });
  assert.equal(newCategory.source, 'category');
  assert.deepEqual(newCategory.paperIds, ['paper-b']);
  assert.equal(newCategory.categoryScope?.category.id, 'category-b');
});

test('an explicit inline scope takes precedence over mentions and historical or sidebar scopes', () => {
  const result = resolveAgentWorkspacePaperScope({ ...input, instruction: '检索全库和新分类', inlinePaperIds: ['paper-a', 'paper-a'], selectedPaperIds: new Set(['paper-b']) });
  assert.equal(result.source, 'inline');
  assert.deepEqual(result.paperIds, ['paper-a']);
  assert.deepEqual(result.papers.map((item) => item.id), ['paper-a']);
});

test('deleted inline IDs and explicitly empty inline scopes remain empty through the service boundary', () => {
  for (const inlinePaperIds of [['paper-deleted'], []]) {
    const result = resolveAgentWorkspacePaperScope({ ...input, instruction: '检索全库和新分类', inlinePaperIds, selectedPaperIds: new Set(['paper-b']) });
    assert.equal(result.source, 'inline');
    assert.deepEqual(result.paperIds, inlinePaperIds);
    assert.deepEqual(result.papers, []);
    assert.deepEqual(result.unavailablePaperIds, inlinePaperIds);
    const serviceScope = resolveAgentPaperScope(papers, result.paperIds);
    assert.equal(serviceScope.mode, 'empty');
    assert.deepEqual(serviceScope.ids, []);
    assert.deepEqual(serviceScope.unavailableIds, inlinePaperIds);
  }
});

test('a mentioned empty category does not fall back to historical, selected, or full-library candidates', () => {
  const result = resolveAgentWorkspacePaperScope({ ...input, instruction: '检索空分类中的全部文献', selectedPaperIds: new Set(['paper-b']) });
  assert.equal(result.source, 'category');
  assert.equal(result.categoryScope?.category.id, 'category-empty');
  assert.deepEqual(result.paperIds, []);
  assert.deepEqual(result.papers, []);
});

test('sidebar and historical scopes retain deleted IDs and do not expand an empty scope', () => {
  const selected = resolveAgentWorkspacePaperScope({ ...input, selectedPaperIds: new Set(['paper-deleted']) });
  assert.equal(selected.source, 'selected');
  assert.deepEqual(selected.paperIds, ['paper-deleted']);
  assert.deepEqual(selected.papers, []);
  const staleHistory = resolveAgentWorkspacePaperScope({ ...input, messages: [scopedMessage(['paper-deleted'])] });
  assert.equal(staleHistory.source, 'history');
  assert.deepEqual(staleHistory.paperIds, ['paper-deleted']);
  assert.deepEqual(staleHistory.papers, []);
  const emptyHistory = resolveAgentWorkspacePaperScope({ ...input, messages: [...input.messages, scopedMessage([])] });
  assert.equal(emptyHistory.source, 'history');
  assert.deepEqual(emptyHistory.paperIds, []);
  assert.deepEqual(emptyHistory.papers, []);
});

test('only a new unscoped RAG chat defaults to the full library', () => {
  const initial = resolveAgentWorkspacePaperScope({ ...input, messages: [] });
  assert.equal(initial.source, 'full-library');
  assert.deepEqual(initial.paperIds, ['paper-a', 'paper-b']);
  const withoutRag = resolveAgentWorkspacePaperScope({ ...input, messages: [], ragEnabled: false });
  assert.equal(withoutRag.source, 'empty');
  assert.deepEqual(withoutRag.paperIds, []);
  const history = resolveAgentWorkspacePaperScope(input);
  assert.equal(history.source, 'history');
  assert.deepEqual(history.paperIds, ['paper-a']);
});
