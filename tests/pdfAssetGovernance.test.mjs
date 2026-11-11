import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { buildPdfAssetFileName, inspectPdfAssets, planPdfAssetNames } = require('../electron/backend/pdfAssetGovernance.cjs');

test('PDF names are stable, bounded, Unicode-normalized, and Windows-safe', () => {
  const options = {
    author: '王五',
    year: '2026 online',
    title: `${'超长标题'.repeat(80)}. `,
    role: 'translated',
    language: 'zh-CN',
    stableId: 'attachment-1',
  };
  const first = buildPdfAssetFileName(options);
  assert.equal(first, buildPdfAssetFileName(options));
  assert.ok(Array.from(first).length <= 100);
  assert.match(first, /__translated-zh-CN__[a-f0-9]{8}\.pdf$/);
  assert.ok(!/[<>:"/\\|?*\x00-\x1f]$/.test(first));
  assert.ok(buildPdfAssetFileName({ title: 'file', stableId: '1', author: 'CON' }).startsWith('_CON_'));
  const configured = buildPdfAssetFileName({
    author: 'Ada Lovelace', year: 2026, title: 'Finite Elements', role: 'original', stableId: 'rule-test',
    fileNamingRule: '{year}_{author}_{title}',
  });
  assert.match(configured, /^2026_Ada_Lovelace_Finite_Elements__original__/);
  assert.throws(() => buildPdfAssetFileName({ title: 'Title', stableId: '1', fileNamingRule: '{unknown}_{title}' }), /Unsupported PDF naming placeholder/);
});

test('inventory hashes only registered attachments and reports exact duplicates', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'paperquay-pdf-assets-'));
  try {
    const one = path.join(root, 'one.pdf');
    const two = path.join(root, 'two.pdf');
    writeFileSync(one, '%PDF-1.7\nidentical\n');
    writeFileSync(two, '%PDF-1.7\nidentical\n');
    const library = {
      settings: { storageDir: root },
      papers: [{
        id: 'p1', title: 'Paper', year: '2026', authors: [{ name: 'Author', sortOrder: 0 }],
        attachments: [
          { id: 'a1', kind: 'pdf', storedPath: one, contentHash: null },
          { id: 'a2', kind: 'pdf', storedPath: two, contentHash: null },
          { id: 'a3', kind: 'pdf', storedPath: path.join(root, 'missing.pdf'), contentHash: null },
        ],
      }],
    };
    const report = await inspectPdfAssets(library);
    assert.equal(report.attachmentCount, 3);
    assert.equal(report.verifiedCount, 2);
    assert.equal(report.missingCount, 1);
    assert.equal(report.duplicateGroups.length, 1);
    assert.equal(report.duplicateGroups[0].length, 2);
    assert.equal(report.duplicateGroups[0][0].ownership, true);

    const plan = planPdfAssetNames(library);
    assert.equal(plan.length, 3);
    assert.ok(plan.every((item) => item.proposedPath.endsWith('.pdf')));
    assert.equal(plan[0].action, 'rename-preview');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
