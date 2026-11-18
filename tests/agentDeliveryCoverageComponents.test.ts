import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { inspectAgentDeliveryQuality } from '../src/services/agentDeliveryQuality.ts';

const require = createRequire(import.meta.url);
const l = (zh: string) => zh;

const components = (async () => {
  const result = await build({ stdin: {
    contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
      import {AssistantMessageCard} from './src/features/agent/AgentWorkspaceMessages.tsx';
      export const renderCard = (props) => renderToStaticMarkup(React.createElement(AssistantMessageCard, props));`,
    resolveDir: process.cwd(), loader: 'tsx',
  }, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', loader: { '.css': 'empty' }, write: false, logLevel: 'silent' });
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
})();

test('actual message shows delivery findings without claiming semantic verification or exposing citation tokens', async () => {
  const { renderCard } = await components;
  const content = '# 1.1 方法\n\n这是有边界的背景说明。 [[cite:body-1]]';
  const deliveryQuality = inspectAgentDeliveryQuality({ markdown: content, requirement: { kind: 'survey', completeness: 'full', requiredSections: ['1.1 方法', '1.2 比较', '1.3 局限'], candidateCount: 176, pendingCount: 172 }, runState: 'budget' });
  const props = { message: { id: 'partial', role: 'assistant', content, createdAt: 1, deliveryQuality,
    ragCitations: [{ id: 'body-1', label: '42', paperId: 'p1', paperTitle: 'Paper 1', sourceType: 'pdf-text', pageIndex: 2, previewText: '背景证据。' }],
    capability: { id: 'comparative-survey', status: 'partial', stages: [] } },
    papers: [], l, onOpenRagCitation() {} };
  const html = renderCard(props);
  assert.ok(html.includes('交付检查：部分完成'));
  assert.ok(html.includes('缺少用户要求的章节「1.2 比较」'));
  assert.ok(html.includes('缺少用户要求的章节「1.3 局限」'));
  assert.ok(html.includes('查看其余'));
  assert.ok(html.includes('这是有边界的背景说明'));
  assert.ok(!html.includes('从本轮记录继续'));
  assert.ok(html.includes('参考文献') && html.includes('[1]'));
  assert.ok(!html.includes('[[cite:') && !html.includes('#agent-binding-') && !html.includes('保留引用标记'));
  const completeQuality = inspectAgentDeliveryQuality({ markdown: '这是一段普通回答。' });
  const complete = renderCard({ ...props, message: { id: 'complete', role: 'assistant', content: '这是一段普通回答。', createdAt: 2, deliveryQuality: completeQuality } });
  assert.ok(complete.includes('交付检查：未发现结构缺项'));
  assert.ok(!complete.includes('事实已核验') && !complete.includes('学术正确'));
});

test('unknown historical capability is not labeled as comparative survey', async () => {
  const { renderCard } = await components;
  const html = renderCard({
    message: { id: 'legacy', role: 'assistant', content: 'Historical answer', createdAt: 1,
      capability: { id: 'removed-capability', status: 'done', stages: [] } },
    papers: [], l,
  });
  assert.ok(html.includes('Historical answer'));
  assert.ok(html.includes('removed-capability'));
  assert.ok(!html.includes('对比调研'));
});

test('note approval shows metadata changes and explicit clearing before applying', async () => {
  const { renderCard } = await components;
  const html = renderCard({
    message: { id: 'note-plan', role: 'assistant', content: '', createdAt: 1,
      notePlan: { id: 'plan', summary: 'Update note', createdAt: 1, operations: [
        { kind: 'update', noteId: 'note-1', title: 'New title', pageKind: 'synthesis', tags: [], content: '' },
        { kind: 'update', noteId: 'note-2', pageKind: 'concept', tags: ['method', 'review'] },
        { kind: 'delete', noteId: 'note-3' },
      ] } },
    papers: [], l,
  });
  assert.ok(html.includes('note-1') && html.includes('note-2') && html.includes('note-3'));
  assert.ok(html.includes('新标题') && html.includes('New title'));
  assert.ok(html.includes('页类型') && html.includes('synthesis') && html.includes('concept'));
  assert.ok(html.includes('标签') && html.includes('method, review') && html.includes('无'));
  assert.ok(html.includes('清空正文'));
  assert.ok(html.includes('确认写入') && html.includes('拒绝'));
});
