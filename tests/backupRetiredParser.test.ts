import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { stripRetiredParserSettings } = require('../electron/backend/backupImport.cjs');

test('old backups normalize the retired PaddleOCR-VL parser fields', () => {
  const config = {
    version: 1,
    settings: {
      parseProvider: 'paddleocr-vl',
      paddleOcrApiBaseUrl: 'https://paddleocr.aistudio-app.com',
      mineruApiBaseUrl: '',
      mineruCacheDir: 'D:/cache',
    },
    secrets: { paddleOcrApiToken: 'secret', mineruApiToken: 'keep' },
    zoteroLocalDataDir: '',
  };
  const rendererState = {
    'paper-reader-settings-v3': JSON.stringify({
      parseProvider: 'paddleocr-vl',
      paddleOcrApiBaseUrl: 'https://paddleocr.aistudio-app.com',
      mineruApiBaseUrl: '',
    }),
    'paper-reader-secrets-v1': { paddleOcrApiToken: 'secret', mineruApiToken: 'keep' },
    'paper-reader-paper-history-v1': '{"workspace-1":{}}',
  };

  stripRetiredParserSettings(config, rendererState);
  stripRetiredParserSettings(config, rendererState);

  assert.equal('parseProvider' in config.settings, false);
  assert.equal('paddleOcrApiBaseUrl' in config.settings, false);
  assert.equal('paddleOcrApiToken' in config.secrets, false);
  assert.equal(config.settings.mineruCacheDir, 'D:/cache');
  assert.equal(config.secrets.mineruApiToken, 'keep');

  const settings = JSON.parse(rendererState['paper-reader-settings-v3']);
  assert.equal('parseProvider' in settings, false);
  assert.equal('paddleOcrApiBaseUrl' in settings, false);
  assert.equal('paddleOcrApiToken' in rendererState['paper-reader-secrets-v1'], false);
  assert.equal(rendererState['paper-reader-secrets-v1'].mineruApiToken, 'keep');
  // Unrelated renderer state stays untouched.
  assert.equal(rendererState['paper-reader-paper-history-v1'], '{"workspace-1":{}}');
});

test('unparsable legacy renderer settings are preserved for the renderer fallback', () => {
  const rendererState = { 'paper-reader-settings-v3': '{not json' };

  stripRetiredParserSettings(null, rendererState);

  assert.equal(rendererState['paper-reader-settings-v3'], '{not json');
});
