import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { inspectAgentDeliveryQuality } from '../src/services/agentDeliveryQuality.ts';
import {
  createSurveyCoverageLedger,
  finishSurveyCoverage,
  updateSurveyCoveragePaper,
  updateSurveyCoverageSubquestion,
} from '../src/services/agentSurveyCoverage.ts';
import type { AgentCapabilityView } from '../src/features/agent/AgentWorkspace.types.ts';

const require = createRequire(import.meta.url);
const l = (zh: string) => zh;

const components = (async () => {
  const result = await build({ stdin: {
    contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
      import {AssistantMessageCard, SurveyCoverageCard} from './src/features/agent/AgentWorkspaceMessages.tsx';
      export {SurveyCoverageCard};
      export const renderCoverage = (props) => renderToStaticMarkup(React.createElement(SurveyCoverageCard, props));
      export const renderCard = (props) => renderToStaticMarkup(React.createElement(AssistantMessageCard, props));`,
    resolveDir: process.cwd(), loader: 'tsx',
  }, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', loader: { '.css': 'empty' }, write: false, logLevel: 'silent' });
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
})();

function partialCoverage() {
  let ledger = createSurveyCoverageLedger({
    papers: Array.from({ length: 176 }, (_, index) => ({ id: `p${index + 1}`, title: `Paper ${index + 1}` })),
    subquestions: [{ id: 'q1', question: '方法支持哪些适用条件？' }],
    budget: { maxTokens: 4000, maxMilliseconds: 8000 },
    timestamp: 1,
  });
  ledger = updateSurveyCoveragePaper(ledger, 'p1', { stage: 'focused-read', cited: true, citationIds: ['body-1'], retrievalOutcome: 'hit', attempts: 1 });
  ledger = updateSurveyCoveragePaper(ledger, 'p2', { stage: 'body-searched', unresolved: true, unresolvedReason: 'no-hit', retrievalOutcome: 'empty', attempts: 1 });
  ledger = updateSurveyCoveragePaper(ledger, 'p3', { unresolved: true, unresolvedReason: 'no-document', retrievalOutcome: 'unavailable', attempts: 1 });
  ledger = updateSurveyCoveragePaper(ledger, 'p4', { stage: 'body-searched', failed: true, retrievalOutcome: 'failed', error: 'Search request failed', attempts: 1 });
  ledger = updateSurveyCoverageSubquestion(ledger, 'q1', { state: 'partial', completedPaperIds: ['p1'], evidenceGaps: ['缺少高温条件的直接证据'] });
  ledger = finishSurveyCoverage(ledger, { state: 'partial', stopReason: 'budget-tokens', timestamp: 2 });
  ledger.budget = {
    ...ledger.budget, promptTokens: 32000, completionTokens: 11000, elapsedMilliseconds: 105000,
    execution: { processedPaperIds: ['p1'], completedSubquestionIds: [], promptTokenBaseline: 30000, completionTokenBaseline: 10000, elapsedBaseline: 100000 },
  };
  return ledger;
}

function findButton(element: any): any {
  if (!element || typeof element !== 'object') return undefined;
  if (element.type === 'button') return element;
  const children = Array.isArray(element.props?.children) ? element.props.children : [element.props?.children];
  return children.map(findButton).find(Boolean);
}

test('actual coverage card distinguishes 176 candidates from body work and shows retrieval outcomes and execution budgets', async () => {
  const { renderCoverage } = await components;
  const html = renderCoverage({ capability: { id: 'comparative-survey', status: 'partial', stages: [], artifacts: { coverage: partialCoverage() } }, disabled: false, l, onContinue() {} });
  const metrics = new Map([...html.matchAll(/<dt[^>]*>([^<]*)<\/dt><dd[^>]*>(\d+)<\/dd>/g)].map((match) => [match[1], Number(match[2])]));
  assert.equal(metrics.get('候选'), 176);
  assert.equal(metrics.get('正文已检索'), 3);
  assert.equal(metrics.get('重点正文已读'), 1);
  assert.equal(metrics.get('实际引用'), 1);
  assert.equal(metrics.get('检索空命中'), 1);
  assert.equal(metrics.get('无正文或未解析'), 1);
  assert.equal(metrics.get('正文检索失败'), 1);
  assert.equal(metrics.get('处理失败'), 1);
  assert.equal(metrics.get('证据未解决'), 2);
  assert.ok(html.includes('累计已记录用量 43000 tokens、105.0 秒'));
  assert.ok(html.includes('本次执行 3000/4000 tokens、5.0/8.0 秒'));
  assert.ok(html.includes('达到 token 预算'));
  assert.ok(html.includes('重点阅读与全文通读不同'));
  assert.ok(html.includes('缺少高温条件的直接证据'));
  assert.ok(html.includes('从本轮记录继续'));
});

test('legacy messages without a ledger display unknown coverage without inferred counts or continuation', async () => {
  const { renderCoverage } = await components;
  for (const artifacts of [undefined, { papers: Array.from({ length: 176 }, (_, index) => ({ id: `p${index}` })) }, { coverage: { version: 99 } }]) {
    const html = renderCoverage({ capability: { id: 'comparative-survey', status: 'done', stages: [], artifacts }, disabled: false, l, onContinue() {} });
    assert.ok(html.includes('未记录，无法推定已读数量'));
    assert.ok(!html.includes('<dl') && !html.includes('176') && !html.includes('<button'));
  }
});

test('coverage continuation uses the actual callback, disables while another run is active, and hides for completed records', async () => {
  const { SurveyCoverageCard, renderCoverage } = await components;
  const capability: AgentCapabilityView = { id: 'comparative-survey', status: 'partial', stages: [], artifacts: { coverage: partialCoverage() } };
  let continued = 0;
  const button = findButton(SurveyCoverageCard({ capability, disabled: false, l, onContinue: () => { continued += 1; } }));
  assert.ok(button);
  button.props.onClick();
  assert.equal(continued, 1);
  assert.equal(button.props.disabled, false);
  assert.equal(findButton(SurveyCoverageCard({ capability, disabled: true, l, onContinue() {} })).props.disabled, true);
  assert.ok(!renderCoverage({ capability: { ...capability, status: 'running' }, disabled: false, l, onContinue() {} }).includes('从本轮记录继续'));
  const complete = finishSurveyCoverage(updateSurveyCoveragePaper(createSurveyCoverageLedger({ papers: [{ id: 'only' }] }), 'only', { stage: 'cited' }));
  assert.ok(!renderCoverage({ capability: { ...capability, status: 'done', artifacts: { coverage: complete } }, disabled: false, l, onContinue() {} }).includes('从本轮记录继续'));
});

test('actual message shows delivery findings without claiming semantic verification or exposing citation tokens', async () => {
  const { renderCard } = await components;
  const content = '# 1.1 方法\n\n这是有边界的背景说明。 [[cite:body-1]]';
  const deliveryQuality = inspectAgentDeliveryQuality({ markdown: content, requirement: { kind: 'survey', completeness: 'full', requiredSections: ['1.1 方法', '1.2 比较', '1.3 局限'], candidateCount: 176, pendingCount: 172 }, runState: 'budget' });
  const props = { message: { id: 'partial', role: 'assistant', content, createdAt: 1, deliveryQuality,
    ragCitations: [{ id: 'body-1', label: '42', paperId: 'p1', paperTitle: 'Paper 1', sourceType: 'pdf-text', pageIndex: 2, previewText: '背景证据。' }],
    capability: { id: 'comparative-survey', status: 'partial', stages: [], artifacts: { coverage: partialCoverage() } } },
    papers: [], l, onOpenRagCitation() {}, onContinueSurvey() {} };
  const html = renderCard(props);
  assert.ok(html.includes('交付检查：部分完成'));
  assert.ok(html.includes('缺少用户要求的章节「1.2 比较」'));
  assert.ok(html.includes('缺少用户要求的章节「1.3 局限」'));
  assert.ok(html.includes('查看其余'));
  assert.ok(html.includes('部分完成') && html.includes('从本轮记录继续'));
  assert.ok(html.includes('参考文献') && html.includes('[1]'));
  assert.ok(!html.includes('[[cite:') && !html.includes('#agent-binding-') && !html.includes('保留引用标记'));
  const completeQuality = inspectAgentDeliveryQuality({ markdown: '这是一段普通回答。' });
  const complete = renderCard({ ...props, message: { id: 'complete', role: 'assistant', content: '这是一段普通回答。', createdAt: 2, deliveryQuality: completeQuality } });
  assert.ok(complete.includes('交付检查：未发现结构缺项'));
  assert.ok(!complete.includes('事实已核验') && !complete.includes('学术正确'));
});
