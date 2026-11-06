import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { remapRendererStorage } = require('../src/shared/rendererStorageRemap.cjs');

const HISTORY_KEY = 'paper-reader-paper-history-v1';
const SETTINGS_KEY = 'paper-reader-settings-v3';

function readJson(storage, key) {
  return JSON.parse(storage[key]);
}

test('remaps only the documented paper history path fields and preserves prose', () => {
  const sourcePath = 'C:\\backup\\library\\paper.pdf';
  const translatedPath = 'C:\\backup\\translated\\paper.pdf';
  const mineruPath = 'C:\\backup\\mineru\\paper.json';
  const storage = {
    [HISTORY_KEY]: JSON.stringify({
      'workspace-1': {
        document: {
          localPdfPath: sourcePath,
          translatedPdfPath: translatedPath,
          title: sourcePath,
          nested: { filePath: sourcePath },
        },
        lastPdfPath: sourcePath,
        lastMineruPath: mineruPath,
        qaSessions: [{
          messages: [{
            content: `Keep this body text: ${sourcePath}`,
            attachments: [{ filePath: sourcePath, name: 'attachment.pdf' }],
          }],
        }],
        qaMessages: [{
          content: `Keep legacy body text: ${sourcePath}`,
          attachments: [{ filePath: translatedPath }],
        }],
        workspaceNoteMarkdown: `Excerpt with ${sourcePath}`,
        annotations: [{ quote: `Quoted ${sourcePath}` }],
      },
    }),
    'paperquay-agent-history-v1': JSON.stringify([{ attachments: [{ filePath: sourcePath }] }]),
    'unrelated-storage-key': sourcePath,
  };

  const result = remapRendererStorage(storage, {
    pathMap: {
      [sourcePath]: 'D:\\restored\\library\\paper.pdf',
      [translatedPath]: 'E:\\restored\\translated\\paper.pdf',
      [mineruPath]: 'F:\\restored\\mineru\\paper.json',
    },
    platform: 'win32',
    hasMineruCache: true,
  });
  const record = readJson(result.state, HISTORY_KEY)['workspace-1'];

  assert.equal(record.document.localPdfPath, 'D:\\restored\\library\\paper.pdf');
  assert.equal(record.document.translatedPdfPath, 'E:\\restored\\translated\\paper.pdf');
  assert.equal(record.lastPdfPath, 'D:\\restored\\library\\paper.pdf');
  assert.equal(record.lastMineruPath, 'F:\\restored\\mineru\\paper.json');
  assert.equal(record.qaSessions[0].messages[0].attachments[0].filePath, 'D:\\restored\\library\\paper.pdf');
  assert.equal(record.qaMessages[0].attachments[0].filePath, 'E:\\restored\\translated\\paper.pdf');

  assert.equal(record.document.title, sourcePath);
  assert.equal(record.document.nested.filePath, sourcePath);
  assert.equal(record.qaSessions[0].messages[0].content, `Keep this body text: ${sourcePath}`);
  assert.equal(record.qaMessages[0].content, `Keep legacy body text: ${sourcePath}`);
  assert.equal(record.workspaceNoteMarkdown, `Excerpt with ${sourcePath}`);
  assert.equal(record.annotations[0].quote, `Quoted ${sourcePath}`);
  assert.equal(result.state['paperquay-agent-history-v1'], storage['paperquay-agent-history-v1']);
  assert.equal(result.state['unrelated-storage-key'], sourcePath);
  assert.deepEqual(result.warnings, []);
});

test('rewrites local source keys, scroll and heatmap keys and values', () => {
  const originalKey = 'local:C:\\archive\\paper.pdf';
  const mappedKey = 'local:D:\\restored\\paper.pdf';
  const originalSummaryKey = `paper-1::prompt-v1::Chinese::pdf-text::${originalKey}`;
  const mappedSummaryKey = `paper-1::prompt-v1::Chinese::pdf-text::${mappedKey}`;
  const storage = {
    [HISTORY_KEY]: JSON.stringify({
      'workspace-1': {
        paperSummarySourceKey: originalSummaryKey,
        pdfScrollPositions: {
          [originalKey]: { sourceKey: originalKey, top: 10, updatedAt: 4 },
          'remote:https://example.test/paper.pdf': {
            sourceKey: 'remote:https://example.test/paper.pdf',
            top: 20,
            updatedAt: 5,
          },
        },
        pdfReadingHeatmaps: {
          [originalKey]: { sourceKey: originalKey, bins: [1], updatedAt: 6 },
        },
      },
    }),
  };

  const result = remapRendererStorage(storage, {
    pathMap: { 'C:\\archive\\paper.pdf': 'D:\\restored\\paper.pdf' },
    platform: 'win32',
    hasMineruCache: true,
  });
  const record = readJson(result.state, HISTORY_KEY)['workspace-1'];

  assert.equal(record.paperSummarySourceKey, mappedSummaryKey);
  assert.equal(record.pdfScrollPositions[mappedKey].sourceKey, mappedKey);
  assert.equal(record.pdfScrollPositions[mappedKey].top, 10);
  assert.equal(record.pdfScrollPositions['remote:https://example.test/paper.pdf'].sourceKey, 'remote:https://example.test/paper.pdf');
  assert.equal(record.pdfReadingHeatmaps[mappedKey].sourceKey, mappedKey);
  assert.equal(record.pdfReadingHeatmaps[mappedKey].bins[0], 1);
  assert.deepEqual(result.warnings, []);
});

test('uses exact path mappings first and the longest matching root next', () => {
  const storage = {
    [HISTORY_KEY]: JSON.stringify({
      exact: { lastPdfPath: 'C:\\source\\paper.pdf' },
      nested: { lastPdfPath: 'C:\\source\\MinerU\\paper.json' },
      boundary: { lastPdfPath: 'C:\\source-old\\paper.pdf' },
    }),
  };

  const result = remapRendererStorage(storage, {
    pathMap: { 'c:/SOURCE/paper.pdf': 'Z:\\exact\\paper.pdf' },
    rootMap: {
      'C:\\source': 'D:\\general',
      'C:\\source\\mineru': 'E:\\cache',
    },
    platform: 'win32',
    hasMineruCache: true,
  });
  const records = readJson(result.state, HISTORY_KEY);

  assert.equal(records.exact.lastPdfPath, 'Z:\\exact\\paper.pdf');
  assert.equal(records.nested.lastPdfPath, 'E:\\cache\\paper.json');
  assert.equal(records.boundary.lastPdfPath, 'C:\\source-old\\paper.pdf');
});

test('matches Windows paths without case sensitivity or separator sensitivity', () => {
  const storage = {
    [HISTORY_KEY]: JSON.stringify({
      'workspace-1': { lastPdfPath: 'c:/ARCHIVE/Paper.PDF' },
    }),
  };

  const result = remapRendererStorage(storage, {
    pathMap: { 'C:\\Archive\\paper.pdf': 'D:\\restored\\paper.pdf' },
    platform: 'Windows',
    hasMineruCache: true,
  });

  assert.equal(readJson(result.state, HISTORY_KEY)['workspace-1'].lastPdfPath, 'D:\\restored\\paper.pdf');
});

test('matches POSIX paths case-sensitively and does not normalize backslashes', () => {
  const storage = {
    [HISTORY_KEY]: JSON.stringify({
      lower: { lastPdfPath: '/data/library/paper.pdf' },
      upper: { lastPdfPath: '/Data/library/paper.pdf' },
      backslash: { lastPdfPath: '\\data\\library\\paper.pdf' },
    }),
  };

  const result = remapRendererStorage(storage, {
    rootMap: { '/Data': '/Restored' },
    platform: 'linux',
    hasMineruCache: true,
  });
  const records = readJson(result.state, HISTORY_KEY);

  assert.equal(records.lower.lastPdfPath, '/data/library/paper.pdf');
  assert.equal(records.upper.lastPdfPath, '/Restored/library/paper.pdf');
  assert.equal(records.backslash.lastPdfPath, '\\data\\library\\paper.pdf');
});

test('remaps only the two documented path settings and clears the last MinerU path when absent', () => {
  const storage = {
    [HISTORY_KEY]: JSON.stringify({
      'workspace-1': { lastMineruPath: 'C:\\old-cache\\blocks.json' },
    }),
    [SETTINGS_KEY]: JSON.stringify({
      mineruCacheDir: 'C:\\old-cache',
      remotePdfDownloadDir: 'C:\\old-downloads',
      apiKey: 'C:\\old-cache\\do-not-touch',
    }),
  };

  const result = remapRendererStorage(storage, {
    rootMap: { 'C:\\old-cache': 'D:\\new-cache', 'C:\\old-downloads': 'E:\\new-downloads' },
    platform: 'win32',
    hasMineruCache: false,
  });

  assert.equal(readJson(result.state, HISTORY_KEY)['workspace-1'].lastMineruPath, '');
  assert.deepEqual(readJson(result.state, SETTINGS_KEY), {
    mineruCacheDir: 'D:\\new-cache',
    remotePdfDownloadDir: 'E:\\new-downloads',
    apiKey: 'C:\\old-cache\\do-not-touch',
  });
});

test('leaves malformed and unrelated storage values intact while reporting malformed JSON', () => {
  const storage = {
    [HISTORY_KEY]: '{not-json',
    [SETTINGS_KEY]: 'null',
    'unrelated-key': '{not-json',
  };

  const result = remapRendererStorage(storage, { platform: 'linux', hasMineruCache: false });

  assert.equal(result.state[HISTORY_KEY], '{not-json');
  assert.equal(result.state[SETTINGS_KEY], 'null');
  assert.equal(result.state['unrelated-key'], '{not-json');
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[0], new RegExp(HISTORY_KEY));
  assert.match(result.warnings[1], new RegExp(SETTINGS_KEY));
});

test('does not mutate its storage snapshot input', () => {
  const historyValue = JSON.stringify({
    'workspace-1': { lastPdfPath: 'C:\\old\\paper.pdf', lastMineruPath: 'C:\\old\\blocks.json' },
  });
  const storage = { [HISTORY_KEY]: historyValue };
  const before = { ...storage };

  remapRendererStorage(storage, {
    rootMap: { 'C:\\old': 'D:\\new' },
    platform: 'win32',
    hasMineruCache: false,
  });

  assert.deepEqual(storage, before);
});
