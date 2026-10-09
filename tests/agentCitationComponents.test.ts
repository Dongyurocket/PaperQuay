import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { verifyAgentCitationBindings } from '../src/services/agentAnswerEvidence.ts';
import type { LibraryAgentRagCitation } from '../src/services/libraryAgent.ts';
import type { LiteraturePaper } from '../src/types/library.ts';

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

test('actual Markdown renders locally resolved sources before any optional content check', async () => {
  const { render } = await loadComponents();
  const props = { content, citations: [citation], onCitationClick() {} };
  const pending = render(props);
  assert.equal((pending.match(/<button/g) ?? []).length, 1);
  assert.ok(pending.includes('[1]') && pending.includes('aria-label='));
  const citationBindings = await verifyAgentCitationBindings({ answer: content, citations: [citation],
    callModel: async () => ({ content: '{"verdict":"supported","reason":"direct support"}' }) });
  const verified = render({ ...props, citationBindings });
  assert.equal((verified.match(/<button/g) ?? []).length, 1);
  assert.ok(verified.includes('[1]') && verified.includes('Rotor Noise · PDF 26'));
  assert.ok(!verified.includes('[7]'));
  for (const status of ['rejected', 'unverified']) {
    const html = render({ ...props, citationBindings: [{ ...citationBindings[0], status }] });
    assert.equal((html.match(/<button/g) ?? []).length, 1);
    assert.ok(html.includes('[1]'));
  }
  const legacy = render({ ...props, content: content.replace('[[cite:evidence-a]]', '[7]'), citationBindings });
  assert.ok(!legacy.includes('<button'));
  assert.ok(legacy.includes('历史或数字引用'));
});

test('numeric ranges keep a literal single tilde while explicit double tilde remains deletion', async () => {
  const { render } = await loadComponents();
  const html = render({ content: '飞行距离 15~30 km，半径 -0.5~2.25 km，~~删除~~。', citations: [] });
  assert.ok(html.includes('15~30 km'));
  assert.ok(html.includes('-0.5~2.25 km'));
  assert.match(html, /<del>删除<\/del>/);
  assert.equal((html.match(/<del>/g) ?? []).length, 1);
});

test('citation tokens inside inline and block math render outside math with the canonical occurrence', async () => {
  const { render } = await loadComponents();
  const inline = `该量满足 $U_j [[cite:${citation.id}]]$。`;
  const block = `\n$$\nU_j = 1 + [[cite:${citation.id}]]\n$$\n`;
  const escapedInline = `该量满足 \\(U_j [[cite:${citation.id}]]\\)。`;
  const escapedBlock = `\n\\[\nU_j = 1 + [[cite:${citation.id}]]\n\\]\n`;
  for (const body of [inline, block, escapedInline, escapedBlock]) {
    const html = render({ content: body, citations: [citation], onCitationClick() {} });
    assert.equal((html.match(/<button/g) ?? []).length, 1);
    assert.ok(html.includes('[1]'));
    assert.ok(!html.includes('#agent-binding-'));
    assert.ok(html.includes('katex'));
    assert.ok(!/[\uE010\uE011]/.test(html));
  }
});

test('math supports several canonical sources while code and unfinished tokens stay noninteractive', async () => {
  const { render } = await loadComponents();
  const second = { ...citation, id: 'evidence-b', label: '8', blockId: 'block-43', previewText: 'Second source.' };
  const body = `满足 $U_j [[cite:${citation.id}]] + T_0 [[cite:${second.id}]]$。\n\n` +
    '`[[cite:evidence-a]]`\n\n```text\n[[cite:evidence-b]]\n```\n\n未完成 [[cite:evidence-a';
  const html = render({ content: body, citations: [citation, second], onCitationClick() {} });
  assert.equal((html.match(/<button/g) ?? []).length, 2);
  assert.ok(html.includes('[1]') && html.includes('[2]'));
  assert.ok(html.includes('katex') && html.includes('<pre>'));
  assert.ok(html.includes('[[cite:evidence-a]]') && html.includes('[[cite:evidence-b]]'));
  assert.ok(html.includes('引用未完成'));
  assert.ok(!/[\uE010\uE011]/.test(html));
  assert.ok(!html.includes('#agent-binding-'));
});

test('verified citation button callback forwards the exact canonical object and its page/block', async () => {
  const { AgentCitationMarker } = await loadComponents();
  const [binding] = await verifyAgentCitationBindings({ answer: content, citations: [citation],
    callModel: async () => ({ content: '{"verdict":"supported","reason":"ok"}' }) });
  let opened: LibraryAgentRagCitation | undefined;
  let openedNumber: number | undefined;
  const button = AgentCitationMarker({ binding, citation, sourceResolved: true, referenceNumber: 2, children: '7', onCitationClick: (value: LibraryAgentRagCitation, number: number) => { opened = value; openedNumber = number; } });
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
  const footer = html.slice(html.indexOf('aria-label="参考文献"'), html.indexOf('来源可用 1 处'));
  assert.ok(footer.includes('Rotor Noise') && footer.includes('<button'));
  assert.ok(!footer.includes('Retrieved Only'));
  const retrieved = html.slice(html.indexOf('本轮检索材料'), html.indexOf('</details>', html.indexOf('本轮检索材料')));
  assert.ok(retrieved.includes('Retrieved Only') && !retrieved.includes('<button'));
  assert.ok(html.indexOf('aria-label="参考文献"') < html.indexOf('来源可用 1 处'));
  assert.ok(html.indexOf('来源与内容检查明细') < html.indexOf('本轮检索材料'));
  assert.ok(!html.includes('已核验证据'));
  const unchecked = renderCard({ ...props, message: { ...props.message, citationBindings: undefined } });
  assert.ok(unchecked.includes('aria-label="参考文献"'));
  assert.ok(!unchecked.includes('内容检查：') && !unchecked.includes('已核验'));
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
  assert.equal((html.match(/<button/g) ?? []).length, 19); // Ten body occurrences, eight references, fork.
  assert.ok(html.includes('内容检查提示该片段与此句冲突'));
  assert.ok(!html.includes('[17]'));
  assert.ok(footer.indexOf('Distinct excerpt 7') < footer.indexOf('Distinct excerpt 2'));
  const reloaded = renderCard({ ...props, message: JSON.parse(JSON.stringify(props.message)) });
  assert.ok(reloaded.includes('参考文献'));
});

test('same-page long previews expose differing text without rendering Markdown or formulas', async () => {
  const { renderCard, referencePreview, referenceIdentityHint } = await loadComponents();
  const common = 'Rotor noise baseline and optimization conditions. '.repeat(20);
  const citations = ['first unique fragment', 'second unique fragment'].map((text, index) => ({ ...citation, id: `long-${index}`, label: String(20 + index), previewText: `${common}${text} $x$ **plain**` }));
  const references = citations.map((value, index) => ({ number: index + 1, citationId: value.id, citation: value, firstReferenceOffset: index }));
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

test('message uses local bibliographic metadata and keeps content checks and trace collapsed', async () => {
  const { renderCard } = await loadComponents();
  const paper = { id: citation.paperId, title: 'Canonical Library Title', year: '2024', publication: 'Real Journal',
    authors: [{ name: 'Actual Author' }] } as LiteraturePaper;
  const html = renderCard({ message: { id: 'metadata', role: 'assistant', content, createdAt: 1, ragCitations: [citation],
    trace: [{ id: 'done', title: 'Tools complete', summary: 'Done', status: 'success' }] },
    papers: [paper], l: (zh: string) => zh, onOpenRagCitation() {}, onVerifyCitations() {},
    expandedStepKeys: new Set(['metadata:done']), onToggleStep() {} });
  const footer = html.slice(html.indexOf('<section'), html.indexOf('</section>'));
  assert.ok(footer.includes('Canonical Library Title'));
  assert.ok(footer.includes('Actual Author · 2024 · Real Journal'));
  assert.ok(!footer.includes('Rotor Noise'));
  assert.ok(html.includes('检查内容') && html.includes('执行轨迹'));
  assert.ok(!html.includes('<details open') && !html.includes('内容检查：'));
  assert.ok(html.includes('来源已定位，内容尚未检查'));
});
