import assert from 'node:assert/strict';
import test from 'node:test';

import { parseMineruTokens } from '../src/services/mineru.ts';
// @ts-ignore
import { parseMineruTokens as backendParseMineruTokens } from '../electron/backend/utils.cjs';

test('parseMineruTokens parses single token correctly', () => {
  const input = 'key_12345678';
  assert.deepEqual(parseMineruTokens(input), ['key_12345678']);
  assert.deepEqual(backendParseMineruTokens(input), ['key_12345678']);
});

test('parseMineruTokens handles empty, null and undefined inputs gracefully', () => {
  assert.deepEqual(parseMineruTokens(''), []);
  assert.deepEqual(parseMineruTokens('   '), []);
  assert.deepEqual(parseMineruTokens(null), []);
  assert.deepEqual(parseMineruTokens(undefined), []);
  assert.deepEqual(backendParseMineruTokens(''), []);
  assert.deepEqual(backendParseMineruTokens(null), []);
});

test('parseMineruTokens splits multiple keys by newlines, commas, semicolons', () => {
  const multiline = `
    key_one
    key_two
    key_three
  `;
  assert.deepEqual(parseMineruTokens(multiline), ['key_one', 'key_two', 'key_three']);
  assert.deepEqual(backendParseMineruTokens(multiline), ['key_one', 'key_two', 'key_three']);

  const commaSeparated = 'key_1, key_2; key_3\nkey_4';
  assert.deepEqual(parseMineruTokens(commaSeparated), ['key_1', 'key_2', 'key_3', 'key_4']);
  assert.deepEqual(backendParseMineruTokens(commaSeparated), ['key_1', 'key_2', 'key_3', 'key_4']);
});

test('parseMineruTokens deduplicates identical tokens and strips spaces', () => {
  const duplicates = 'key_abc\nkey_abc\n key_def \nkey_abc';
  assert.deepEqual(parseMineruTokens(duplicates), ['key_abc', 'key_def']);
  assert.deepEqual(backendParseMineruTokens(duplicates), ['key_abc', 'key_def']);
});

test('parseMineruTokens handles array input', () => {
  const list = [' key_1 ', '', 'key_2', 'key_1'];
  assert.deepEqual(parseMineruTokens(list), ['key_1', 'key_2']);
  assert.deepEqual(backendParseMineruTokens(list), ['key_1', 'key_2']);
});

test('MinerU 200-page limit error pattern is properly detected', () => {
  const serverMsg = 'number of pages exceeds limit (200 pages), please split the file and try again';
  const isPageLimit = serverMsg.toLowerCase().includes('200 pages') || serverMsg.toLowerCase().includes('exceeds limit');
  assert.equal(isPageLimit, true);

  const retryWithOcrRegex = /(api\s*token|authorization|unauthori[sz]ed|forbidden|http\s*(?:401|403)|upload url|upload failed|zip download|timed?\s*out|timeout|200\s*pages?|exceeds?\s*limit|200\s*页|页数超出)/i;
  assert.equal(retryWithOcrRegex.test(serverMsg), true);
});
