import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8');
const lineCount = (relativePath: string) => read(relativePath).split(/\r?\n/).length;

const HOOKS = [
  'readerTabContext.ts',
  'useReaderDocument.ts',
  'useReaderSummary.ts',
  'useReaderNotes.ts',
  'useReaderAnnotations.ts',
  'useReaderQa.ts',
];

test('DocumentReaderTab is a thin composition shell over the reader hooks', () => {
  for (const hook of HOOKS) {
    const relativePath = `src/features/reader/hooks/${hook}`;
    assert.equal(existsSync(path.join(root, relativePath)), true, `${relativePath} must exist`);
  }

  const tabPath = 'src/features/reader/DocumentReaderTab.tsx';
  const tab = read(tabPath);

  assert.ok(lineCount(tabPath) <= 1_500, `${tabPath} must stay at or below 1,500 lines`);
  assert.match(tab, /useReaderTabState\(props\)/);

  for (const hook of [
    'useReaderDocument',
    'useReaderSummary',
    'useReaderNotes',
    'useReaderAnnotations',
    'useReaderQa',
  ]) {
    assert.match(tab, new RegExp(`import \\{ ${hook} \\}`), `${hook} must be imported`);
    assert.match(tab, new RegExp(`${hook}\\(state`), `${hook} must be composed from the shared state`);
  }

  // The component no longer owns domain state or the large callbacks.
  assert.equal(/useState</.test(tab), false, 'reader state belongs to useReaderTabState');
  assert.equal(/useRef</.test(tab), false, 'reader refs belong to useReaderTabState');
  assert.equal(/handleSubmitQa\s*=\s*useCallback/.test(tab), false);
  assert.equal(/openWorkspaceDocument\s*=\s*useCallback/.test(tab), false);

  for (const hook of ['useReaderDocument', 'useReaderSummary', 'useReaderNotes', 'useReaderAnnotations', 'useReaderQa']) {
    const source = read(`src/features/reader/hooks/${hook}.ts`);
    assert.match(source, new RegExp(`export function ${hook}\\(`), `${hook} must export a hook`);
    assert.match(source, new RegExp(`export type .* = ReturnType<typeof ${hook}>`), `${hook} must export its API type`);
    assert.match(source, /useCallback\(/, `${hook} must own callbacks`);
    if (hook !== 'useReaderQa') {
      assert.equal(/useState</.test(source), false, `${hook} consumes shared state instead of owning it`);
    }
  }
});

test('explicit effect wrappers keep the original execution order', () => {
  const tab = read('src/features/reader/DocumentReaderTab.tsx');
  const order = [
    81, 116, 117, 152, 162, 188, 196, 197, 236, 244, 245, 246, 247, 248, 249, 250,
    251, 252, 253, 254, 255, 265, 266, 267, 268, 269, 270, 277,
  ];

  let lastIndex = -1;
  for (const effectId of order) {
    const index = tab.indexOf(`effect_${effectId}`);
    assert.ok(index > lastIndex, `effect_${effectId} must stay in its original order`);
    lastIndex = index;
  }

  // 28 extracted effects plus the locale ref-sync effect that never moved.
  assert.equal((tab.match(/useEffect\(/g) ?? []).length, 29);
});

test('reader hooks are acyclic: later domains may consume earlier APIs only', () => {
  const document = read('src/features/reader/hooks/useReaderDocument.ts');
  const summary = read('src/features/reader/hooks/useReaderSummary.ts');
  const notes = read('src/features/reader/hooks/useReaderNotes.ts');
  const annotations = read('src/features/reader/hooks/useReaderAnnotations.ts');
  const qa = read('src/features/reader/hooks/useReaderQa.ts');

  assert.match(document, /from '\.\/readerTabContext'/);
  assert.match(summary, /documentApi: ReaderDocumentApi/);
  assert.match(notes, /documentApi: ReaderDocumentApi/);
  assert.match(annotations, /notesApi: ReaderNotesApi/);
  assert.match(qa, /notesApi: ReaderNotesApi/);
  assert.match(qa, /annotationsApi: ReaderAnnotationsApi/);

  assert.equal(/ReaderNotesApi/.test(document), false);
  assert.equal(/ReaderAnnotationsApi/.test(document), false);
  assert.equal(/ReaderQaApi/.test(document), false);
  assert.equal(/ReaderAnnotationsApi/.test(summary), false);
  assert.equal(/ReaderQaApi/.test(notes), false);
  assert.equal(/ReaderQaApi/.test(annotations), false);
});
