import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_TRANSLATED_PDF_LOCATIONS,
  buildPaperFileLocationTargets,
  flattenPaperFileLocationCandidates,
  resolvePaperFileLocations,
  resolvePaperFileLocationsOnDisk,
} from '../src/features/literature/paperFileLocations.ts';
import type { LiteratureAttachment, LiteraturePaper } from '../src/types/library.ts';
import { buildMineruCachePaths } from '../src/utils/mineruCache.ts';

function attachment(overrides: Partial<LiteratureAttachment> & Pick<LiteratureAttachment, 'id' | 'kind'>): LiteratureAttachment {
  return {
    id: overrides.id,
    paperId: 'paper-1',
    kind: overrides.kind,
    originalPath: overrides.originalPath ?? null,
    storedPath: overrides.storedPath ?? '',
    relativePath: overrides.relativePath ?? null,
    language: overrides.language ?? null,
    fileName: overrides.fileName ?? 'file.pdf',
    mimeType: 'application/pdf',
    fileSize: 1,
    contentHash: null,
    createdAt: overrides.createdAt ?? 1,
    missing: overrides.missing ?? false,
  };
}

function paper(attachments: LiteratureAttachment[]): LiteraturePaper {
  return {
    id: 'paper-1',
    title: 'Noise reduction of multi-rotor',
    titleZh: null,
    year: '2024',
    publication: null,
    doi: null,
    url: null,
    abstractText: null,
    keywords: [],
    importedAt: 1,
    updatedAt: 1,
    lastReadAt: null,
    readingProgress: 0,
    isFavorite: false,
    userNote: null,
    aiSummary: null,
    citation: null,
    source: 'local',
    sortOrder: 0,
    authors: [],
    tags: [],
    categoryIds: [],
    attachments,
    ragEnabled: true,
  };
}

const pdf = attachment({ id: 'a-pdf', kind: 'pdf', storedPath: 'D:\\lib\\papers\\paper.pdf' });

test('reader file locations preserve standalone cache identity and include explicitly opened JSON', () => {
  const workspaceItem = { itemKey: 'standalone:file', workspaceId: 'standalone:D:\\paper.pdf', groupKey: 'standalone:file', title: 'Standalone', creators: '', year: '', itemType: 'pdf', source: 'standalone' as const, localPdfPath: pdf.storedPath };
  const targets = buildPaperFileLocationTargets(paper([pdf]), { mineruCacheDir: 'D:\\cache', workspaceItem, mineruPath: 'D:\\custom\\result.json' });
  const output = targets.find((target) => target.kind === 'mineru-output')!;
  assert.equal(output.candidates[0], buildMineruCachePaths('D:\\cache', workspaceItem).markdownPath);
  assert.ok(output.candidates.includes('D:\\custom\\result.json'));
  const flags = flattenPaperFileLocationCandidates(targets).map((path) => path === 'D:\\custom\\result.json');
  assert.equal(resolvePaperFileLocations(targets, flags).find((location) => location.kind === 'mineru-output')?.path, 'D:\\custom\\result.json');
});

test('builds targets for PDF and MinerU output with all three cache naming candidates', () => {
  const targets = buildPaperFileLocationTargets(paper([pdf]), {
    mineruCacheDir: 'D:\\cache',
    autoLoadSiblingJson: false,
  });

  assert.deepEqual(targets.map((target) => target.kind), ['pdf', 'mineru-output']);
  assert.deepEqual(targets[0].candidates, ['D:\\lib\\papers\\paper.pdf']);

  const output = targets[1].candidates;
  assert.equal(output.length, 12);
  assert.ok(output.every((candidate) => candidate.startsWith('D:\\cache\\')));
  assert.ok(output[0].includes('document-'));
  assert.ok(output.slice(0, 3).every((candidate) => candidate.endsWith('\\full.md')));
  assert.ok(output.slice(3).every((candidate) => candidate.endsWith('.json')));
});

test('adds sibling full.md next to the PDF only when autoLoadSiblingJson is on', () => {
  const withSibling = buildPaperFileLocationTargets(paper([pdf]), { mineruCacheDir: '', autoLoadSiblingJson: true });
  assert.deepEqual(withSibling.find((target) => target.kind === 'mineru-output')?.candidates, [
    'D:\\lib\\papers\\full.md', 'D:\\lib\\papers\\content_list_v2.json',
    'D:\\lib\\papers\\content_list.json', 'D:\\lib\\papers\\middle.json',
  ]);

  const withoutSibling = buildPaperFileLocationTargets(paper([pdf]), { mineruCacheDir: '', autoLoadSiblingJson: false });
  assert.deepEqual(withoutSibling.find((target) => target.kind === 'mineru-output')?.candidates, []);
});

test('lists non-missing translated PDFs newest first, capped, with language', () => {
  const translated = Array.from({ length: MAX_TRANSLATED_PDF_LOCATIONS + 1 }, (_, index) => attachment({
    id: `t-${index}`,
    kind: 'translated-pdf',
    storedPath: `D:\\lib\\translated\\t-${index}.pdf`,
    language: index === 0 ? 'zh-CN' : null,
    createdAt: index,
  }));
  const missing = attachment({ id: 't-missing', kind: 'translated-pdf', storedPath: 'D:\\x.pdf', missing: true, createdAt: 99 });
  const targets = buildPaperFileLocationTargets(paper([pdf, ...translated, missing]), {});
  const translatedTargets = targets.filter((target) => target.kind === 'translated-pdf');

  assert.equal(translatedTargets.length, MAX_TRANSLATED_PDF_LOCATIONS);
  assert.deepEqual(translatedTargets.map((target) => target.id), ['translated-pdf:t-3', 'translated-pdf:t-2', 'translated-pdf:t-1']);
  assert.ok(translatedTargets.every((target) => target.id !== 'translated-pdf:t-missing'));
});

test('resolves relative attachment paths against the storage directory', () => {
  const relative = attachment({ id: 'rel', kind: 'pdf', storedPath: 'old\\paper.pdf', relativePath: 'papers/paper.pdf' });
  const targets = buildPaperFileLocationTargets(paper([relative]), { storageDir: 'E:\\Library' });
  assert.deepEqual(targets[0].candidates, ['E:\\Library\\papers/paper.pdf']);
});

test('picks the first existing candidate per target and null when none exist', () => {
  const targets = buildPaperFileLocationTargets(paper([pdf]), { mineruCacheDir: 'D:\\cache', autoLoadSiblingJson: false });
  const candidates = flattenPaperFileLocationCandidates(targets);
  const output = targets[1].candidates;
  const flags = candidates.map((candidate) => candidate === pdf.storedPath || candidate === output[1]);
  const resolved = resolvePaperFileLocations(targets, flags);

  assert.equal(resolved[0].path, pdf.storedPath);
  assert.equal(resolved[1].path, output[1]);
});

test('finds sibling content_list.json and prefers markdown over JSON', async () => {
  const options = { mineruCacheDir: 'D:\\cache', autoLoadSiblingJson: true };
  const json = 'D:\\lib\\papers\\content_list.json';
  const markdown = 'D:\\lib\\papers\\full.md';
  const lookup = async (existing: string[]) => resolvePaperFileLocationsOnDisk(
    paper([pdf]), options, async (paths) => paths.map((path) => existing.includes(path)),
  );
  assert.equal((await lookup([json])).find((item) => item.kind === 'mineru-output')?.path, json);
  assert.equal((await lookup([json, markdown])).find((item) => item.kind === 'mineru-output')?.path, markdown);
});

test('does not locate sibling JSON or markdown when sibling loading is disabled', async () => {
  const checked: string[] = [];
  const resolved = await resolvePaperFileLocationsOnDisk(
    paper([pdf]), { mineruCacheDir: 'D:\\cache', autoLoadSiblingJson: false },
    async (paths) => { checked.push(...paths); return paths.map((path) => path.includes('lib\\papers\\content_list')); },
  );
  assert.equal(resolved.find((item) => item.kind === 'mineru-output')?.path, null);
  assert.ok(!checked.some((path) => path.startsWith('D:\\lib\\papers\\') && path !== pdf.storedPath));
});

test('paper without any PDF yields empty candidates and no disk call', async () => {
  let calls = 0;
  const resolved = await resolvePaperFileLocationsOnDisk(paper([]), { mineruCacheDir: 'D:\\cache' }, async (paths) => {
    calls += 1;
    return paths.map(() => true);
  });

  assert.equal(calls, 0);
  assert.ok(resolved.every((location) => location.path === null));
});
