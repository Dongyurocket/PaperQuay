import assert from 'node:assert/strict';
import test from 'node:test';

import { htmlTableToMarkdown } from '../src/utils/markdown.ts';

test('htmlTableToMarkdown converts MinerU table HTML to a GFM table', () => {
  const markdown = htmlTableToMarkdown(`
    <table>
      <tr><th>Parameter</th><th>Value</th></tr>
      <tr><td>Span &amp; chord</td><td>12.5 | 13</td></tr>
      <tr><td>Thrust<br/>max</td><td><span>980</span></td></tr>
    </table>
  `);

  assert.equal(markdown, [
    '| Parameter | Value |',
    '| --- | --- |',
    '| Span & chord | 12.5 \\| 13 |',
    '| Thrust max | 980 |',
  ].join('\n'));
});

test('htmlTableToMarkdown pads ragged rows and falls back to plain text', () => {
  assert.equal(
    htmlTableToMarkdown('<table><tr><td>A</td><td>B</td></tr><tr><td>1</td></tr></table>'),
    ['| A | B |', '| --- | --- |', '| 1 |  |'].join('\n'),
  );
  assert.equal(htmlTableToMarkdown('No table here'), 'No table here');
});
