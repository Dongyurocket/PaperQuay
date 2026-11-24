import test from 'node:test';
import assert from 'node:assert/strict';
import { buildManualMetadataUpdateRequest } from '../src/features/literature/manualMetadataPatch.ts';

function paper(overrides: Record<string, unknown> = {}) {
  return {
    id: 'paper-1',
    title: 'Original title',
    year: '2024',
    publication: 'Journal',
    doi: '10.1000/original',
    url: null,
    abstractText: null,
    publisher: null,
    volume: null,
    issue: null,
    pages: null,
    issn: null,
    authors: [],
    keywords: [],
    attachments: [],
    ...overrides,
  } as any;
}

function metadata(overrides: Record<string, unknown> = {}) {
  return {
    source: 'crossref',
    doi: '10.1000/original',
    title: 'Original title',
    authors: [],
    year: '2024',
    publication: 'Journal',
    url: null,
    abstractText: null,
    publisher: null,
    volume: null,
    issue: null,
    pages: null,
    issn: null,
    ...overrides,
  } as any;
}

test('manual metadata patch treats publisher/volume/issue/pages/issn as changed fields', () => {
  const request = buildManualMetadataUpdateRequest(
    paper(),
    metadata({
      publisher: 'Springer',
      volume: '12',
      issue: '3',
      pages: '45-67',
      issn: '1234-5678',
    }),
    { title: 'Original title', doi: '10.1000/original' },
  );

  assert.ok(request, 'bibliographic fields must produce an update request');
  assert.equal(request?.publisher, 'Springer');
  assert.equal(request?.volume, '12');
  assert.equal(request?.issue, '3');
  assert.equal(request?.pages, '45-67');
  assert.equal(request?.issn, '1234-5678');
});

test('manual metadata patch ignores unchanged bibliographic fields', () => {
  const request = buildManualMetadataUpdateRequest(
    paper({
      publisher: 'Springer',
      volume: '12',
      issue: '3',
      pages: '45-67',
      issn: '1234-5678',
    }),
    metadata({
      publisher: ' Springer ',
      volume: '12',
      issue: '3',
      pages: '45-67',
      issn: '1234-5678',
    }),
    { title: 'Original title', doi: '10.1000/original' },
  );

  assert.equal(request, null, 'trim-equal values must not overwrite the paper');
});

test('a single changed bibliographic field still produces a patch', () => {
  const request = buildManualMetadataUpdateRequest(
    paper({ publisher: 'Springer', volume: '12' }),
    metadata({ publisher: 'Springer', volume: '13' }),
    { title: 'Original title', doi: '10.1000/original' },
  );

  assert.ok(request);
  assert.equal(request?.volume, '13');
  assert.equal(Object.prototype.hasOwnProperty.call(request, 'publisher'), false);
});
