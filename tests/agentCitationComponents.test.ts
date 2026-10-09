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
      export {AgentCitationMarker};
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
  assert.ok(verified.includes('[7]') && verified.includes('Rotor Noise · Page 26'));
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
  const button = AgentCitationMarker({ binding, citation, children: '7', onCitationClick: (value: LibraryAgentRagCitation) => { opened = value; } });
  assert.equal(button.type, 'button'); button.props.onClick();
  assert.equal(opened, citation);
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

test('message footer separates verified used evidence from retrieved materials', async () => {
  const { renderCard } = await loadComponents();
  const unused = { ...citation, id: 'unused', label: '8', paperId: 'paper-b', paperTitle: 'Retrieved Only' };
  const citations = [citation, unused];
  const citationBindings = await verifyAgentCitationBindings({ answer: content, citations,
    callModel: async () => ({ content: '{"verdict":"supported","reason":"ok"}' }) });
  const props = { message: { id: 'reply', role: 'assistant', content, createdAt: 1, ragCitations: citations, citationBindings },
    papers: [], l: (zh: string) => zh, approvedItemIds: new Set(), expandedStepKeys: new Set(), expandedToolIds: new Set(),
    onOpenRagCitation() {}, onForkFromMessage() {} };
  const html = renderCard(props);
  const footer = html.slice(html.indexOf('已核验证据'), html.indexOf('本轮检索材料'));
  assert.ok(footer.includes('Rotor Noise') && footer.includes('<button'));
  assert.ok(!footer.includes('Retrieved Only'));
  const retrieved = html.slice(html.indexOf('本轮检索材料'), html.indexOf('</details>', html.indexOf('本轮检索材料')));
  assert.ok(retrieved.includes('Retrieved Only') && !retrieved.includes('<button'));
  assert.ok(!renderCard({ ...props, message: { ...props.message, citationBindings: undefined } }).includes('已核验证据'));
});
