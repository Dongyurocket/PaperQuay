import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8');

const VIEW_PATH = 'src/features/literature/LiteratureLibraryView.tsx';

const HOOKS = [
  ['src/features/literature/hooks/useLibraryCatalog.ts', 'useLibraryCatalog'],
  ['src/features/literature/hooks/usePaperSelection.ts', 'usePaperSelection'],
  ['src/features/literature/hooks/useImportFlow.ts', 'useImportFlow'],
  ['src/features/literature/hooks/useMetadataJobs.ts', 'useMetadataJobs'],
  ['src/features/literature/hooks/usePdfAssetAudit.ts', 'usePdfAssetAudit'],
  ['src/features/literature/hooks/useBatchOperations.ts', 'useBatchOperations'],
  ['src/features/literature/hooks/useCategoryActions.ts', 'useCategoryActions'],
] as const;

const DIALOGS = [
  ['src/features/literature/dialogs/MetadataParseDialog.tsx', 'MetadataParseDialog'],
  ['src/features/literature/dialogs/PdfAssetAuditDialog.tsx', 'PdfAssetAuditDialog'],
] as const;

test('the literature workspace is split into the seven planned hooks', () => {
  for (const [relativePath, hookName] of HOOKS) {
    assert.equal(existsSync(path.join(root, relativePath)), true, `${relativePath} must exist`);
    const source = read(relativePath);
    assert.match(source, new RegExp(`export function ${hookName}\\b`), `${relativePath} must export ${hookName}`);
    assert.ok(
      source.split(/\r?\n/).length >= 20,
      `${relativePath} must carry real logic, not an empty re-export`,
    );
  }
});

test('the inline metadata and PDF asset dialogs live in their own components', () => {
  for (const [relativePath, componentName] of DIALOGS) {
    assert.equal(existsSync(path.join(root, relativePath)), true, `${relativePath} must exist`);
    const source = read(relativePath);
    assert.match(source, new RegExp(`export default function ${componentName}\\b`), `${relativePath} must export ${componentName}`);
    assert.match(source, /<Dialog\b/, `${relativePath} must own its Dialog shell`);
  }
});

test('LiteratureLibraryView only orchestrates hooks and mounts the dialogs', () => {
  const view = read(VIEW_PATH);
  const lines = view.split(/\r?\n/).length;

  assert.ok(lines <= 1800, `${VIEW_PATH} must be <= 1800 lines, got ${lines}`);

  for (const [relativePath, hookName] of HOOKS) {
    const moduleName = path.basename(relativePath, '.ts');
    assert.match(
      view,
      new RegExp(`from '\\./hooks/${moduleName}'`),
      `${VIEW_PATH} must import ${moduleName}`,
    );
    assert.match(
      view,
      new RegExp(`\\b${hookName}\\(`),
      `${VIEW_PATH} must call ${hookName}`,
    );
  }

  assert.match(view, /from '\.\/dialogs\/MetadataParseDialog'/);
  assert.match(view, /from '\.\/dialogs\/PdfAssetAuditDialog'/);
  assert.match(view, /<MetadataParseDialog\b/);
  assert.match(view, /<PdfAssetAuditDialog\b/);

  // 两个对话框的标记、文案与表单壳必须只在组件文件里，view 不再内联。
  assert.equal(view.includes('pq-metadata-dialog-title'), false, 'metadata dialog markup must move out of the view');
  assert.equal(view.includes('pdf-asset-audit-title'), false, 'pdf audit dialog markup must move out of the view');
  assert.equal(/from '\.\.\/\.\.\/ui\/dialog'/.test(view), false, 'view must not mount a raw Dialog shell');
  assert.equal(/const \[metadataDialog,/.test(view), false, 'metadata dialog state belongs to the metadata hook');
  assert.equal(/const \[pdfAssetAuditOpen,/.test(view), false, 'pdf audit state belongs to the pdf audit hook');
  assert.equal(/const \[importDrafts,/.test(view), false, 'import drafts state belongs to the import hook');
});

test('the extracted dialogs keep the original accessibility hooks', () => {
  const metadata = read('src/features/literature/dialogs/MetadataParseDialog.tsx');
  assert.match(metadata, /labelledBy="pq-metadata-dialog-title"/);
  assert.match(metadata, /id="pq-metadata-dialog-title"/);
  assert.match(metadata, /dismissOnBackdrop=\{!busy\}/);

  const audit = read('src/features/literature/dialogs/PdfAssetAuditDialog.tsx');
  assert.match(audit, /labelledBy="pdf-asset-audit-title"/);
  assert.match(audit, /id="pdf-asset-audit-title"/);
  assert.match(audit, /aria-label=\{l\('关闭', 'Close'\)\}/);
});
