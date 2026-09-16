import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMarkdownMath, reconstructNomenclature } from '../src/utils/markdown.ts';
import { buildRenderableBlocks, flattenMineruPages, parseMineruPages } from '../src/services/mineru.ts';

const flightParagraph = String.raw`This results in a resultant velocity $V_{net}$ with an induced angle $\gamma$, known as the aircraft climb angle, calculated using (5.10). The airfoil is thus at an effective angle of attack, $\alpha_{eff}$, which is the difference between pitch angle $\theta$ and climb angle $\gamma$ calculated using (5.11). Here, $V_{\infty_x}$ and $V_{\infty_z}$ are the freestream velocities in the x and z axes. The effective angle of attack $\alpha_{eff}$ is used to determine the lift and drag forces.`;

test('flight paragraph remains prose with intact math through both reader transformations', () => {
  assert.equal(reconstructNomenclature(flightParagraph), flightParagraph);
  assert.equal(normalizeMarkdownMath(flightParagraph), flightParagraph);
  const blocks = flattenMineruPages(parseMineruPages([[{
    type: 'paragraph', content: { paragraph_content: [{ type: 'text', content: flightParagraph }] },
  }]]));
  const rendered = buildRenderableBlocks(blocks);
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].markdown, flightParagraph);
  assert.equal(normalizeMarkdownMath(rendered[0].markdown), flightParagraph);
});

test('ordinary words, notation headings and dense variables cannot force tables during rendering', () => {
  for (const text of [
    String.raw`These results use $V_{net}$ and $C_{drag}$ to describe the forces.`,
    String.raw`This defines \gamma and \theta as angles in the following discussion.`,
    'Variables describe the wing. This paragraph discusses mmass and cchord conventions.',
    'Nomenclature\n\nBnumber of blades Dtotal drag Tthrust force',
  ]) {
    const rendered = normalizeMarkdownMath(text);
    assert.ok(!rendered.includes('| 符号 (Symbol) |'), rendered);
    assert.ok(!rendered.includes('$T$ | his'), rendered);
  }
});

test('explicit legacy reconstruction leaves math, existing tables, code and ambiguous input intact', () => {
  for (const text of [
    'Nomenclature\n\n' + flightParagraph,
    String.raw`Notation
\gamma climb angle \theta pitch angle \alpha attack angle`,
    'Notation\n\n| Symbol | Description |\n| --- | --- |\n| T | Thrust |',
    'Nomenclature\n\n```text\nBnumber Dtotal Tthrust\n```',
    'Nomenclature\n\nBnumber of rotor blades',
  ]) {
    assert.equal(reconstructNomenclature(text), text);
  }
});
