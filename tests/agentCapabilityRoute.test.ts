import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveAgentCapabilityRoute } from '../src/services/agentCapabilityRoute.ts';
import {
  CAPABILITY_CLASSIFIER_MIN_INSTRUCTION_CHARS,
  classifyAgentCapabilityRoute,
  parseCapabilityClassifierOutput,
} from '../src/services/agentCapabilityClassifier.ts';
import type { AgentToolMountContext } from '../src/services/agentLoop.ts';

const defaultMountContext: AgentToolMountContext = {
  papersCount: 3,
  hasOpenDocument: true,
  ragReady: true,
  localLibraryMode: true,
};

test('pinned capability takes highest priority even when keywords match another capability', () => {
  const route = resolveAgentCapabilityRoute({
    instruction: '请对比调研以下几篇论文的差异并给出综述报告',
    paperCount: 3,
    pinnedCapabilityId: 'citation-audit',
    mountContext: defaultMountContext,
  });

  assert.equal(route.capabilityId, 'citation-audit');
  assert.equal(route.source, 'user');
});

test('pinned comparative-survey is kept even if paperCount < 2 for runner explanation', () => {
  const route = resolveAgentCapabilityRoute({
    instruction: '请对这篇文献进行深度分析',
    paperCount: 1,
    pinnedCapabilityId: 'comparative-survey',
    mountContext: { ...defaultMountContext, papersCount: 1 },
  });

  assert.equal(route.capabilityId, 'comparative-survey');
  assert.equal(route.source, 'user');
});

test('pinned capability falls back when available check fails', () => {
  // citation-audit 要求 localLibraryMode: true
  const route = resolveAgentCapabilityRoute({
    instruction: '普通学术问答指令',
    paperCount: 2,
    pinnedCapabilityId: 'citation-audit',
    mountContext: { ...defaultMountContext, localLibraryMode: false },
  });

  assert.equal(route.capabilityId, null);
  assert.equal(route.source, 'none');
});

test('keyword fallback matches when unpinned or auto and paperCount >= 2', () => {
  const routeUnpinned = resolveAgentCapabilityRoute({
    instruction: '请对比调研这些文献中关于气动噪声的计算方法',
    paperCount: 2,
    mountContext: defaultMountContext,
  });

  assert.equal(routeUnpinned.capabilityId, 'comparative-survey');
  assert.equal(routeUnpinned.source, 'keyword');

  const routeAuto = resolveAgentCapabilityRoute({
    instruction: '请对比综述这两篇论文的核心创新点',
    paperCount: 2,
    pinnedCapabilityId: 'auto',
    mountContext: defaultMountContext,
  });

  assert.equal(routeAuto.capabilityId, 'comparative-survey');
  assert.equal(routeAuto.source, 'keyword');
});

test('keyword fallback does not match if paperCount < 2', () => {
  const route = resolveAgentCapabilityRoute({
    instruction: '请对比调研这篇论文',
    paperCount: 1,
    pinnedCapabilityId: 'auto',
    mountContext: { ...defaultMountContext, papersCount: 1 },
  });

  assert.equal(route.capabilityId, null);
  assert.equal(route.source, 'none');
});

test('classifier fallback matches only when confidence >= 0.75 and passes minPapers and availability', () => {
  // 置信度达到 0.8，命中
  const routeSuccess = resolveAgentCapabilityRoute({
    instruction: '请帮我核对刚才那段关于飞行力学方程引用的真实性与来源页码',
    paperCount: 2,
    pinnedCapabilityId: 'auto',
    mountContext: defaultMountContext,
    classifierResult: {
      capabilityId: 'citation-audit',
      confidence: 0.85,
    },
  });

  assert.equal(routeSuccess.capabilityId, 'citation-audit');
  assert.equal(routeSuccess.source, 'model');

  // 置信度低于 0.75，不命中
  const routeLowConfidence = resolveAgentCapabilityRoute({
    instruction: '请帮我核对刚才那段关于飞行力学方程引用的真实性与来源页码',
    paperCount: 2,
    pinnedCapabilityId: 'auto',
    mountContext: defaultMountContext,
    classifierResult: {
      capabilityId: 'citation-audit',
      confidence: 0.70,
    },
  });

  assert.equal(routeLowConfidence.capabilityId, null);
  assert.equal(routeLowConfidence.source, 'none');
});

test('classifier confidence 0.74 (below threshold) does not execute the capability and falls back to ReAct', () => {
  const route = resolveAgentCapabilityRoute({
    instruction: '请把这几篇关于旋翼噪声的摘录笔记蒸馏成一张概念页',
    paperCount: 3,
    pinnedCapabilityId: 'auto',
    mountContext: defaultMountContext,
    classifierResult: {
      capabilityId: 'note-distill',
      confidence: 0.74,
    },
  });

  assert.equal(route.capabilityId, null);
  assert.equal(route.source, 'none');
});

test('classifier result that fails mount conditions falls back to none', () => {
  // citation-audit 要求 localLibraryMode: true
  const route = resolveAgentCapabilityRoute({
    instruction: '请帮我核对刚才那段关于飞行力学方程引用的真实性与来源页码',
    paperCount: 2,
    pinnedCapabilityId: 'auto',
    mountContext: { ...defaultMountContext, localLibraryMode: false },
    classifierResult: {
      capabilityId: 'citation-audit',
      confidence: 0.95,
    },
  });

  assert.equal(route.capabilityId, null);
  assert.equal(route.source, 'none');
});

test('classifier throwing falls back to ReAct (null) and emits capability_route_failed', async () => {
  const events: Array<{ kind: string; reason?: string }> = [];
  const result = await classifyAgentCapabilityRoute({
    instruction: '请帮我核对刚才那段关于飞行力学方程引用的真实性与来源页码',
    callModel: async () => {
      throw new Error('model endpoint unreachable');
    },
    onEvent: (event) => events.push(event),
  });

  assert.equal(result, null);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'capability_route_failed');
  assert.match(events[0].reason ?? '', /model endpoint unreachable/);

  // 分类结果为 null 时路由回退到 none（ReAct），与未启用分类器行为一致
  const route = resolveAgentCapabilityRoute({
    instruction: '请帮我核对刚才那段关于飞行力学方程引用的真实性与来源页码',
    paperCount: 2,
    pinnedCapabilityId: 'auto',
    mountContext: defaultMountContext,
    classifierResult: result,
  });
  assert.equal(route.capabilityId, null);
  assert.equal(route.source, 'none');
});

test('classifier unavailable (no callModel) falls back to null with capability_route_failed', async () => {
  const events: Array<{ kind: string; reason?: string }> = [];
  const result = await classifyAgentCapabilityRoute({
    instruction: '请帮我核对刚才那段关于飞行力学方程引用的真实性与来源页码',
    onEvent: (event) => events.push(event),
  });

  assert.equal(result, null);
  assert.deepEqual(events.map((event) => event.kind), ['capability_route_failed']);
});

test('classifier unparseable or unknown-id output falls back to null with capability_route_failed', async () => {
  const events: Array<{ kind: string; reason?: string }> = [];
  const unparseable = await classifyAgentCapabilityRoute({
    instruction: '请帮我核对刚才那段关于飞行力学方程引用的真实性与来源页码',
    callModel: async () => ({ content: '我觉得应该是引用核对吧。' }),
    onEvent: (event) => events.push(event),
  });
  assert.equal(unparseable, null);

  const unknownId = await classifyAgentCapabilityRoute({
    instruction: '请帮我核对刚才那段关于飞行力学方程引用的真实性与来源页码',
    callModel: async () => ({ content: '{"capabilityId": "rename-papers", "confidence": 0.99}' }),
    onEvent: (event) => events.push(event),
  });
  assert.equal(unknownId, null, '文库整理类或未注册的 id 必须按失败回退');
  assert.equal(events.length, 2);
  assert.ok(events.every((event) => event.kind === 'capability_route_failed'));
});

test('classifier timeout falls back to null with capability_route_failed', async () => {
  const events: Array<{ kind: string; reason?: string }> = [];
  const result = await classifyAgentCapabilityRoute({
    instruction: '请帮我核对刚才那段关于飞行力学方程引用的真实性与来源页码',
    timeoutMs: 50,
    callModel: () => new Promise(() => {}), // 永不 resolve，模拟超时
    onEvent: (event) => events.push(event),
  });

  assert.equal(result, null);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'capability_route_failed');
  assert.match(events[0].reason ?? '', /timed out/);
});

test('short instructions skip the classifier silently (no failure event)', async () => {
  const events: Array<{ kind: string }> = [];
  let called = 0;
  const result = await classifyAgentCapabilityRoute({
    instruction: '看看笔记',
    callModel: async () => {
      called += 1;
      return { content: '{"capabilityId": "note-distill", "confidence": 0.9}' };
    },
    onEvent: (event) => events.push(event),
  });

  assert.equal(result, null);
  assert.equal(called, 0, `短于 ${CAPABILITY_CLASSIFIER_MIN_INSTRUCTION_CHARS} 字的指令不应调用分类器`);
  assert.equal(events.length, 0, '短指令是路由规则而非分类失败，不记 capability_route_failed');
});

test('valid classifier output is parsed and routed with source model', async () => {
  const result = await classifyAgentCapabilityRoute({
    instruction: '请把这几篇关于旋翼噪声的摘录笔记蒸馏成一张概念页',
    callModel: async () => ({ content: '```json\n{"capabilityId": "note-distill", "confidence": 0.88}\n```' }),
  });

  assert.deepEqual(result, { capabilityId: 'note-distill', confidence: 0.88 });

  const route = resolveAgentCapabilityRoute({
    instruction: '请把这几篇关于旋翼噪声的摘录笔记蒸馏成一张概念页',
    paperCount: 3,
    pinnedCapabilityId: 'auto',
    mountContext: defaultMountContext,
    classifierResult: result,
  });
  assert.equal(route.capabilityId, 'note-distill');
  assert.equal(route.source, 'model');
});

test('parseCapabilityClassifierOutput validates shape strictly', () => {
  assert.deepEqual(parseCapabilityClassifierOutput('{"capabilityId": null, "confidence": 0.9}'), {
    capabilityId: null,
    confidence: 0.9,
  });
  assert.equal(parseCapabilityClassifierOutput('{"capabilityId": "graph-explore", "confidence": 1.4}')?.confidence, 1);
  assert.equal(parseCapabilityClassifierOutput('not json'), null);
  assert.equal(parseCapabilityClassifierOutput('{"capabilityId": "graph-explore"}'), null, '缺 confidence 判为解析失败');
  assert.equal(parseCapabilityClassifierOutput('[{"capabilityId": null, "confidence": 0.9}]'), null, '数组不是合法输出');
});

test('returns none when no rule matches', () => {
  const route = resolveAgentCapabilityRoute({
    instruction: '用 Python 计算一个正弦函数',
    paperCount: 0,
    mountContext: defaultMountContext,
  });

  assert.equal(route.capabilityId, null);
  assert.equal(route.source, 'none');
});

test('a full survey follow-up routes with its derived requirements while pins keep priority', () => {
  const base = {
    instruction: '请继续给出完整版',
    paperCount: 176,
    mountContext: { ...defaultMountContext, papersCount: 176 },
    deliveryRequirement: { kind: 'survey' as const, completeness: 'full' as const, requiredSections: ['背景', '方法比较'] },
  };
  const route = resolveAgentCapabilityRoute(base);
  assert.equal(route.capabilityId, 'comparative-survey');
  assert.equal(route.source, 'keyword');
  assert.equal(resolveAgentCapabilityRoute({ ...base, pinnedCapabilityId: 'citation-audit' }).capabilityId, 'citation-audit');
  assert.equal(resolveAgentCapabilityRoute({ ...base, paperCount: 1 }).capabilityId, null);
  assert.equal(resolveAgentCapabilityRoute({ ...base, deliveryRequirement: { kind: 'general', completeness: 'full' } }).capabilityId, null);
});
