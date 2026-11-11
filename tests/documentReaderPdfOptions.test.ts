import test from 'node:test';
import assert from 'node:assert/strict';

import type { LocalDirectoryFileEntry } from '../src/services/desktop.ts';
import type { PdfSource, WorkspaceItem } from '../src/types/reader.ts';
import { normalizePathForCompare } from '../src/utils/path.ts';
import {
  buildAvailablePdfOptions,
  canSwitchToOriginalPdf,
  resolveAnnotationSaveDirectory,
  resolveCurrentLocalPdfPath,
  resolveCurrentPdfVariantLabel,
  resolveOriginalPdfPath,
  resolvePdfCompareLeftSource,
} from '../src/features/reader/documentReaderPdfOptions.ts';

function item(overrides: Partial<WorkspaceItem> = {}): WorkspaceItem {
  return {
    itemKey: overrides.itemKey ?? 'item-1',
    title: overrides.title ?? 'Paper Title',
    creators: overrides.creators ?? 'Author',
    year: overrides.year ?? '2026',
    itemType: overrides.itemType ?? 'journalArticle',
    source: overrides.source ?? 'native-library',
    workspaceId: overrides.workspaceId ?? 'workspace-1',
    groupKey: overrides.groupKey ?? 'group-1',
    ...overrides,
  };
}

function file(path: string, name = path.split(/[\\/]/).pop() ?? path): LocalDirectoryFileEntry {
  return {
    path,
    name,
    size: 1,
    modifiedAtMs: 1,
  };
}

const zh = (value: string) => value;

test('original and current PDF path helpers prefer explicit local paths', () => {
  const document = item({
    localPdfPath: 'D:/papers/original.pdf',
    attachmentKey: 'att-1',
    attachmentFilename: 'remote.pdf',
  });

  assert.equal(resolveOriginalPdfPath(document, 'D:/downloads'), 'D:/papers/original.pdf');
  assert.equal(
    resolveOriginalPdfPath(item({ attachmentKey: 'att-1', attachmentFilename: 'remote.pdf' }), 'D:/downloads'),
    'D:/downloads\\item-1-remote.pdf',
  );
  assert.equal(resolveCurrentLocalPdfPath('', { kind: 'local-path', path: 'D:/papers/current.pdf' }), 'D:/papers/current.pdf');
  assert.equal(resolveCurrentLocalPdfPath('D:/papers/explicit.pdf', { kind: 'local-path', path: 'D:/papers/current.pdf' }), 'D:/papers/explicit.pdf');
});

test('PDF variant labels distinguish remote, original, and annotated copies', () => {
  assert.equal(
    resolveCurrentPdfVariantLabel({
      currentLocalPdfPath: '',
      originalPdfPath: '',
      pdfSource: { kind: 'remote-url', url: 'https://example.test/paper.pdf' } as PdfSource,
      localize: zh,
    }),
    '远程 PDF',
  );
  assert.equal(
    resolveCurrentPdfVariantLabel({
      currentLocalPdfPath: 'D:/papers/original.pdf',
      originalPdfPath: 'D:\\papers\\original.pdf',
      pdfSource: { kind: 'local-path', path: 'D:/papers/original.pdf' },
      localize: zh,
    }),
    '原始 PDF',
  );
  assert.equal(
    resolveCurrentPdfVariantLabel({
      currentLocalPdfPath: 'D:/papers/annotated.pdf',
      originalPdfPath: 'D:/papers/original.pdf',
      pdfSource: { kind: 'local-path', path: 'D:/papers/annotated.pdf' },
      localize: zh,
    }),
    '批注版 PDF',
  );
});

test('PDF compare pins its left source to the original while normal reading keeps the selected source', () => {
  const translatedSource: PdfSource = { kind: 'local-path', path: 'D:/papers/translated.pdf' };

  assert.deepEqual(
    resolvePdfCompareLeftSource(true, 'D:/papers/original.pdf', translatedSource),
    { kind: 'local-path', path: 'D:/papers/original.pdf' },
  );
  assert.equal(resolvePdfCompareLeftSource(false, 'D:/papers/original.pdf', translatedSource), translatedSource);
  assert.equal(resolvePdfCompareLeftSource(true, '', translatedSource), translatedSource);
});

test('annotation save directory prefers MinerU cache, then original PDF, then current PDF', () => {
  const document = item({ itemKey: 'paper:one', title: 'A/B Paper' });

  assert.equal(
    resolveAnnotationSaveDirectory({
      mineruCacheDir: 'D:/cache',
      document,
      originalPdfPath: 'D:/papers/original.pdf',
      currentLocalPdfPath: 'D:/papers/current.pdf',
    }),
    'D:/cache/document-1fe76490',
  );
  assert.equal(
    normalizePathForCompare(resolveAnnotationSaveDirectory({
      mineruCacheDir: '',
      document,
      originalPdfPath: 'D:/papers/original.pdf',
      currentLocalPdfPath: 'D:/other/current.pdf',
    })),
    normalizePathForCompare('D:/papers'),
  );
  assert.equal(
    normalizePathForCompare(resolveAnnotationSaveDirectory({
      mineruCacheDir: '',
      document,
      originalPdfPath: '',
      currentLocalPdfPath: 'D:/other/current.pdf',
    })),
    normalizePathForCompare('D:/other'),
  );
});

test('available PDF options are deduplicated in original, project, current order', () => {
  const options = buildAvailablePdfOptions({
    originalPdfPath: 'D:/papers/original.pdf',
    projectPdfFiles: [
      file('D:\\papers\\original.pdf', 'original.pdf'),
      file('D:/papers/project.pdf', 'project.pdf'),
    ],
    currentLocalPdfPath: 'D:/papers/project.pdf',
    currentPdfVariantLabel: '批注版 PDF',
    localize: zh,
  });

  assert.deepEqual(options, [
    { path: 'D:/papers/original.pdf', label: '原版 PDF', title: 'original.pdf' },
    { path: 'D:/papers/project.pdf', label: '其他 PDF', title: 'project.pdf' },
  ]);
  assert.equal(canSwitchToOriginalPdf('D:/papers/project.pdf', 'D:/papers/original.pdf'), true);
  assert.equal(canSwitchToOriginalPdf('D:/papers/original.pdf', 'D:\\papers\\original.pdf'), false);
});

test('registered native library variants retain their attachment roles in reader choices', () => {
  const options = buildAvailablePdfOptions({
    originalPdfPath: 'C:/library/original.pdf',
    projectPdfFiles: [
      { path: 'C:/library/original.pdf', name: 'original.pdf', role: 'Original', size: 0, modifiedAtMs: 0 },
      { path: 'C:/library/translated.pdf', name: 'translated.pdf', role: 'Translated · zh-CN', size: 0, modifiedAtMs: 0 },
      { path: 'C:/library/annotated.pdf', name: 'annotated.pdf', role: 'Annotated', size: 0, modifiedAtMs: 0 },
    ],
    currentLocalPdfPath: 'C:/library/original.pdf',
    currentPdfVariantLabel: 'Original PDF',
    localize: zh,
  });

  assert.deepEqual(options, [
    { path: 'C:/library/original.pdf', label: '原版 PDF', title: 'original.pdf' },
    { path: 'C:/library/translated.pdf', label: '译版 · zh-CN', title: 'translated.pdf' },
    { path: 'C:/library/annotated.pdf', label: '批注版 PDF', title: 'annotated.pdf' },
  ]);
});

test('translated variants without a confirmed language use a localized short label and keep the filename in the title', () => {
  const options = buildAvailablePdfOptions({
    originalPdfPath: 'C:/library/original.pdf',
    projectPdfFiles: [
      { path: 'C:/library/translated.pdf', name: 'long_physical_translation_name.pdf', role: 'Translated · und', size: 0, modifiedAtMs: 0 },
    ],
    currentLocalPdfPath: 'C:/library/original.pdf',
    currentPdfVariantLabel: '原始 PDF',
    localize: zh,
  });

  assert.deepEqual(options[1], {
    path: 'C:/library/translated.pdf',
    label: '译版 · 语言待确认',
    title: 'long_physical_translation_name.pdf',
  });
});

test('PDF option labels and missing-language message support English localization', () => {
  const options = buildAvailablePdfOptions({
    originalPdfPath: 'C:/library/original.pdf',
    projectPdfFiles: [
      { path: 'C:/library/translated.pdf', name: 'translated.pdf', role: 'Translated', size: 0, modifiedAtMs: 0 },
    ],
    currentLocalPdfPath: 'C:/library/original.pdf',
    currentPdfVariantLabel: 'Original PDF',
    localize: (_zh, en) => en,
  });

  assert.deepEqual(options.map((option) => option.label), [
    'Original PDF',
    'Translated · language unconfirmed',
  ]);
});

test('unknown language metadata never derives a language from even very long zh filenames', () => {
  const originalName = `${'original-'.repeat(30)}.pdf`;
  const translatedName = `${'zh-CN-translated-'.repeat(20)}.pdf`;
  for (const role of ['Translated', 'Translated · und', 'Translated · unknown', 'Translated · undefined']) {
    const options = buildAvailablePdfOptions({
      originalPdfPath: `C:/library/${originalName}`,
      projectPdfFiles: [{ ...file(`C:/library/${translatedName}`, translatedName), role }],
      currentLocalPdfPath: '', currentPdfVariantLabel: '', localize: zh,
    });
    assert.deepEqual(options.map(({ label }) => label), ['原版 PDF', '译版 · 语言待确认']);
    assert.equal(options[0].title, originalName);
    assert.equal(options[1].title, translatedName);
  }
});
