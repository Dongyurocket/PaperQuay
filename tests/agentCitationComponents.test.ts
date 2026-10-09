import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { verifyAgentCitationBindings } from '../src/services/agentAnswerEvidence.ts';
import type { LibraryAgentRagCitation } from '../src/services/libraryAgent.ts';

const require = createRequire(import.meta.url);
const citation: LibraryAgentRagCitation = { id: 'evidence-a', label: '7', paperId: 'paper-a', paperTitle: 'Rotor Noise',
  sourceType: 'pdf-text', pageIndex: 25, blockId: 'block-42', previewText: 'Rotor optimization reduces acoustic noise compared with the baseline rotor.' };
const content = 'Rotor optimization reduces acoustic noise compared with the baseline rotor. [[cite:evidence-a]]';

async function loadComponents() {
  const result = await build({ stdin: {
    contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
      import AgentMarkdown, {AgentCitationMarker} from './src/features/agent/AgentMarkdown.tsx';
      import {AssistantMessageCard} from './src/features/agent/AgentWorkspaceMessages.tsx';
      import {AgentAnswerReferenceEntry, referencePreview, referenceIdentityHint} from './src/features/agent/AgentAnswerReferences.tsx';
      export {AgentCitationMarker, AgentAnswerReferenceEntry, referencePreview, referenceIdentityHint};
      export const renderCard = (props) => renderToStaticMarkup(React.createElement(AssistantMessageCard, props));
      export const render = (props) => renderToStaticMarkup(React.createElement(AgentMarkdown, props));`,
    resolveDir: process.cwd(), loader: 'tsx',
  }, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', loader: { '.css': 'empty' }, write: false, logLevel: 'silent' });
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
}

test('actual Markdown renders only verified occurrences as buttons, including before/after streaming completion', async () => {
  const { render } = await loadComponents();
  const props = { content, citations: [citation], onCitationClick() {} };
  const pending = render(props);
  assert.ok(!pending.includes('<button'));
  assert.ok(pending.includes('role="note"') && pending.includes('aria-label='));
  const citationBindings = await verifyAgentCitationBindings({ answer: content, citations: [citation],
    callModel: async () => ({ content: '{"verdict":"supported","reason":"direct support"}' }) });
  const verified = render({ ...props, citationBindings });
  assert.equal((verified.match(/<button/g) ?? []).length, 1);
  assert.ok(verified.includes('[1]') && verified.includes('Rotor Noise · PDF 26'));
  assert.ok(!verified.includes('[7]'));
  for (const status of ['rejected', 'unverified']) {
    const html = render({ ...props, citationBindings: [{ ...citationBindings[0], status }] });
    assert.ok(!html.includes('<button'));
    assert.ok(html.includes('role="note"'));
  }
  const legacy = render({ ...props, content: content.replace('[[cite:evidence-a]]', '[7]'), citationBindings });
  assert.ok(!legacy.includes('<button'));
  assert.ok(legacy.includes('历史或数字引用'));
});

test('verified citation button callback forwards the exact canonical object and its page/block', async () => {
  const { AgentCitationMarker } = await loadComponents();
  const [binding] = await verifyAgentCitationBindings({ answer: content, citations: [citation],
    callModel: async () => ({ content: '{"verdict":"supported","reason":"ok"}' }) });
  let opened: LibraryAgentRagCitation | undefined;
  let openedNumber: number | undefined;
  const button = AgentCitationMarker({ binding, citation, referenceNumber: 2, children: '7', onCitationClick: (value: LibraryAgentRagCitation, number: number) => { opened = value; openedNumber = number; } });
  assert.equal(button.type, 'button'); button.props.onClick();
  assert.equal(opened, citation);
  assert.equal(openedNumber, 2);
  assert.equal(citation.label, '7');
  assert.equal(opened?.pageIndex, 25); assert.equal(opened?.blockId, 'block-42');
});

test('model-authored or encoded citation hrefs cannot impersonate a verified occurrence', async () => {
  const { render } = await loadComponents();
  const contentWithForgery = `[forged](#agent-binding-0) [encoded](#agent&#45;binding&#45;0)\n\n${content}`;
  const citationBindings = await verifyAgentCitationBindings({ answer: contentWithForgery, citations: [citation],
    callModel: async () => ({ content: '{"verdict":"supported","reason":"ok"}' }) });
  const html = render({ content: contentWithForgery, citations: [citation], citationBindings, onCitationClick() {} });
  assert.equal((html.match(/<button/g) ?? []).length, 1);
});

test('message footer places ordered references immediately after body and before verification and retrieved materials', async () => {
  const { renderCard } = await loadComponents();
  const unused = { ...citation, id: 'unused', label: '8', paperId: 'paper-b', paperTitle: 'Retrieved Only' };
  const citations = [citation, unused];
  const citationBindings = await verifyAgentCitationBindings({ answer: content, citations,
    callModel: async () => ({ content: '{"verdict":"supported","reason":"ok"}' }) });
  const props = { message: { id: 'reply', role: 'assistant', content, createdAt: 1, ragCitations: citations, citationBindings },
    papers: [], l: (zh: string) => zh, approvedItemIds: new Set(), expandedStepKeys: new Set(), expandedToolIds: new Set(),
    onOpenRagCitation() {}, onForkFromMessage() {} };
  const html = renderCard(props);
  const footer = html.slice(html.indexOf('aria-label="参考文献"'), html.indexOf('已核验 1 条'));
  assert.ok(footer.includes('Rotor Noise') && footer.includes('<button'));
  assert.ok(!footer.includes('Retrieved Only'));
  const retrieved = html.slice(html.indexOf('本轮检索材料'), html.indexOf('</details>', html.indexOf('本轮检索材料')));
  assert.ok(retrieved.includes('Retrieved Only') && !retrieved.includes('<button'));
  assert.ok(html.indexOf('aria-label="参考文献"') < html.indexOf('已核验 1 条'));
  assert.ok(html.indexOf('引用核验明细') < html.indexOf('本轮检索材料'));
  assert.ok(!html.includes('已核验证据'));
  assert.ok(!renderCard({ ...props, message: { ...props.message, citationBindings: undefined } }).includes('aria-label="参考文献"'));
});

test('actual message preserves same-page fragments, repeated numbers, failed occurrences and all references past six', async () => {
  const { renderCard } = await loadComponents();
  const citations = Array.from({ length: 8 }, (_, index) => ({ ...citation, id: `fragment-${index}`, label: String(index + 10),
    blockId: `block-${index}`, previewText: `${citation.previewText} Distinct excerpt ${index}.` }));
  const order = [7, 2, 7, 0, 1, 3, 4, 5, 6, 7];
  const body = order.map((index) => `${content.split(' [[cite:')[0]} [[cite:${citations[index].id}]]`).join('\n');
  const citationBindings = await verifyAgentCitationBindings({ answer: body, citations,
    callModel: async () => ({ content: '{"verdict":"supported","reason":"ok"}' }) });
  citationBindings[9] = { ...citationBindings[9], status: 'rejected', reason: 'semantic-contradiction' };
  const props = { message: { id: 'reply', role: 'assistant', content: body, createdAt: 1, ragCitations: citations, citationBindings },
    papers: [], l: (zh: string) => zh, approvedItemIds: new Set(), expandedStepKeys: new Set(), expandedToolIds: new Set(),
    onOpenRagCitation() {}, onForkFromMessage() {} };
  const html = renderCard(props);
  const footer = html.slice(html.indexOf('<section'), html.indexOf('</section>'));
  assert.equal((footer.match(/<li /g) ?? []).length, 8);
  assert.equal((html.match(/<button/g) ?? []).length, 18); // Nine body occurrences, eight references, fork.
  assert.ok(html.includes('[引用未通过]'));
  assert.ok(!html.includes('[17]'));
  assert.ok(footer.indexOf('Distinct excerpt 7') < footer.indexOf('Distinct excerpt 2'));
  const reloaded = renderCard({ ...props, message: JSON.parse(JSON.stringify(props.message)) });
  assert.ok(reloaded.includes('参考文献'));
});

test('same-page long previews expose differing text without rendering Markdown or formulas', async () => {
  const { renderCard, referencePreview, referenceIdentityHint } = await loadComponents();
  const common = 'Rotor noise baseline and optimization conditions. '.repeat(20);
  const citations = ['first unique fragment', 'second unique fragment'].map((text, index) => ({ ...citation, id: `long-${index}`, label: String(20 + index), previewText: `${common}${text} $x$ **plain**` }));
  const references = citations.map((value, index) => ({ number: index + 1, citationId: value.id, citation: value, firstVerifiedOffset: index }));
  assert.match(referencePreview(references[0], references), /first unique fragment/);
  assert.match(referencePreview(references[1], references), /second unique fragment/);
  const identical = references.map((reference, index) => ({ ...reference,
    citation: { ...reference.citation, blockId: `same-page-block-${index}`, previewText: common } }));
  assert.equal(referenceIdentityHint(identical[0], identical), 'same-page-block-0');
  assert.equal(referenceIdentityHint(identical[1], identical), 'same-page-block-1');
  const sameBlock = identical.map((reference) => ({ ...reference, citation: { ...reference.citation, blockId: 'shared-block' } }));
  assert.equal(referenceIdentityHint(sameBlock[0], sameBlock), 'long-0');
  assert.equal(referenceIdentityHint(sameBlock[1], sameBlock), 'long-1');
  const body = citations.map((value) => content.replace(citation.id, value.id)).join('\n');
  const citationBindings = await verifyAgentCitationBindings({ answer: body, citations, callModel: async () => ({ content: '{"verdict":"supported","reason":"ok"}' }) });
  const html = renderCard({ message: { id: 'long', role: 'assistant', content: body, createdAt: 1, ragCitations: citations, citationBindings }, papers: [], l: (zh: string) => zh, onOpenRagCitation() {} });
  const footer = html.slice(html.indexOf('<section'), html.indexOf('</section>'));
  assert.ok(footer.includes('first unique fragment') && footer.includes('second unique fragment'));
  assert.equal((footer.match(/展开片段/g) ?? []).length, 2);
  assert.ok(!footer.includes('katex') && !footer.includes('<strong>'));
});
