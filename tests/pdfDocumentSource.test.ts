import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPdfJsDocumentInit } from '../src/features/pdf/pdfDocumentSource.ts';

test('PDF.js document init disables eager page fetch for URL and in-memory sources', () => {
  const local = buildPdfJsDocumentInit({ kind: 'local-path', path: 'C:/papers/thesis.pdf' }, null);
  const remote = buildPdfJsDocumentInit({ kind: 'remote-url', url: 'https://example.com/a.pdf' }, null);
  const memory = buildPdfJsDocumentInit(null, new Uint8Array([1, 2, 3]));

  assert.equal(local?.disableAutoFetch, true);
  assert.equal(remote?.disableAutoFetch, true);
  assert.equal(memory?.disableAutoFetch, true);
  assert.equal(local?.disableStream, false);
  assert.equal(remote?.disableStream, false);
});
