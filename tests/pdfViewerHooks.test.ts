import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8');

const HOOKS = [
  {
    file: 'src/features/pdf/hooks/usePdfDocumentLifecycle.ts',
    name: 'usePdfDocumentLifecycle',
    domain: /GlobalWorkerOptions|getDocument/,
  },
  {
    file: 'src/features/pdf/hooks/usePdfScrollRestore.ts',
    name: 'usePdfScrollRestore',
    domain: /createScrollRestoreScheduler|scrollInstantly/,
  },
  {
    file: 'src/features/pdf/hooks/usePdfSelection.ts',
    name: 'usePdfSelection',
    domain: /getScopedSelectionPayload|scheduleSelectionCommit/,
  },
  {
    file: 'src/features/pdf/hooks/usePdfAnnotations.ts',
    name: 'usePdfAnnotations',
    domain: /annotationEditorMode|saveDocument/,
  },
  {
    file: 'src/features/pdf/hooks/usePdfThumbnails.ts',
    name: 'usePdfThumbnails',
    domain: /buildThumbnailPageIndexes|pageThumbnails/,
  },
  {
    file: 'src/features/pdf/hooks/usePdfOutline.ts',
    name: 'usePdfOutline',
    domain: /normalizePdfOutline|buildMineruOutline/,
  },
  {
    file: 'src/features/pdf/hooks/usePdfBlockOverlay.tsx',
    name: 'usePdfBlockOverlay',
    domain: /resolvePdfBlockHitByPoint|pageHosts/,
  },
] as const;

test('PDF viewer control logic lives in seven domain hook modules', () => {
  for (const hook of HOOKS) {
    assert.equal(existsSync(path.join(root, hook.file)), true, `${hook.file} must exist`);

    const source = read(hook.file);
    assert.match(
      source,
      new RegExp(`export function ${hook.name}\\b`),
      `${hook.file} must export ${hook.name}`,
    );
    assert.match(source, hook.domain, `${hook.file} must own its PDF domain logic`);
  }
});

test('PdfViewer only composes the seven hooks and renders JSX', () => {
  const source = read('src/features/pdf/PdfViewer.tsx');

  for (const hook of HOOKS) {
    const moduleName = path.basename(hook.file).replace(/\.tsx?$/, '');
    assert.match(
      source,
      new RegExp(`from './hooks/${moduleName}'`),
      `PdfViewer must import ${hook.name}`,
    );
  }

  const lineCount = source.split('\n').length;
  assert.ok(lineCount <= 1_800, `PdfViewer.tsx must stay at or below 1,800 lines, found ${lineCount}`);

  assert.equal(source.includes('getDocument('), false, 'PdfViewer must not call PDF.js getDocument');
  assert.equal(
    source.includes('GlobalWorkerOptions'),
    false,
    'PdfViewer must not configure the PDF.js worker',
  );
  assert.match(source, /export default memo\(PdfViewer\)/);
});
