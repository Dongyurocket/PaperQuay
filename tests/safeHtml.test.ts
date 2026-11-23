import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { sanitizeMineruTableHtml } from '../src/utils/safeHtml.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
Object.defineProperty(globalThis, 'DOMParser', { configurable: true, value: dom.window.DOMParser });
Object.defineProperty(globalThis, 'Node', { configurable: true, value: dom.window.Node });

test('a disallowed wrapper inside a table cannot smuggle an event handler image', () => {
  const html =
    '<table><div><img src=x onerror="alert(1)"></div><tbody><tr><td onclick="alert(2)">cell</td></tr></tbody></table>';
  const sanitized = sanitizeMineruTableHtml(html);

  assert.equal(sanitized.includes('onerror'), false);
  assert.equal(sanitized.includes('onclick'), false);
  assert.equal(sanitized.includes('<img'), false);
  assert.equal(sanitized.includes('cell'), true, 'legitimate table content is preserved');
});

test('nested script/style/iframe nodes are dropped with their subtree', () => {
  const html =
    '<table><script>alert(1)</script><style>body{}</style><tr><td>ok</td><td><iframe srcdoc="<script>alert(2)</script>"></iframe></td></tr></table>';
  const sanitized = sanitizeMineruTableHtml(html);

  assert.equal(sanitized.includes('<script'), false);
  assert.equal(sanitized.includes('alert('), false);
  assert.equal(sanitized.includes('<style'), false);
  assert.equal(sanitized.includes('<iframe'), false);
  assert.equal(sanitized.includes('ok'), true);
});

test('allowed table structure and attributes survive sanitization', () => {
  const html =
    '<table><caption>Cap</caption><tbody><tr><th scope="col" rowspan="2">Head</th><td colspan="3"><strong>Bold</strong></td></tr></tbody></table>';
  const sanitized = sanitizeMineruTableHtml(html);

  assert.match(sanitized, /<caption>Cap<\/caption>/);
  assert.match(sanitized, /scope="col"/);
  assert.match(sanitized, /rowspan="2"/);
  assert.match(sanitized, /colspan="3"/);
  assert.match(sanitized, /<strong>Bold<\/strong>/);
});

test('empty input yields an empty string', () => {
  assert.equal(sanitizeMineruTableHtml('   '), '');
});
