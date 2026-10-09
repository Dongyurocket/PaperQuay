import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAgentDeliveryQualityPrompt, deriveAgentDeliveryRequirement, inspectAgentDeliveryQuality } from '../src/services/agentDeliveryQuality.ts';

test('delivery inspection reports missing sections, unfinished content, and preserves citations', () => {
  const result = inspectAgentDeliveryQuality({
    markdown: '# 结论\n\n结论引用 [[cite:paper-a]]。\n\n后续可以再扩写。',
    requirement: {
      kind: 'survey',
      requiredSections: ['方法比较', '局限性'],
      completeness: 'full',
      candidateCount: 176,
      pendingCount: 14,
    },
  });

  assert.equal(result.state, 'partial');
  assert.deepEqual(result.missingSections, ['方法比较', '局限性']);
  assert.equal(result.preservedCitationCount, 1);
  assert.ok(result.issues.some((item) => item.code === 'unfinished-content'));
  assert.ok(result.issues.some((item) => item.code === 'coverage-gap'));
});

test('delivery inspection flags internal protocol leaks and unbounded research gaps', () => {
  const result = inspectAgentDeliveryQuality({
    markdown: '# 结论\n\n#agent-binding-paper-a 支持该领域不存在任何研究。',
    requirement: { kind: 'survey', completeness: 'full' },
  });

  assert.equal(result.hasInternalProtocolLeak, true);
  assert.ok(result.issues.some((item) => item.code === 'internal-protocol-leak'));
  assert.ok(result.issues.some((item) => item.code === 'unbounded-research-gap'));
  assert.equal(result.preservedCitationCount, 0);
});

test('engineering delivery requires task-adapted structure and conditional recommendations', () => {
  const result = inspectAgentDeliveryQuality({
    markdown: '# 方案\n\n建议入口速度设置为 300 m/s。',
    requirement: { kind: 'engineering' },
  });

  assert.equal(result.state, 'partial');
  assert.ok(result.issues.some((item) => item.code === 'engineering-structure-gap'));
  assert.ok(result.issues.some((item) => item.code === 'missing-conditionality'));
});

test('budget and invalid output remain visibly incomplete without changing citations', () => {
  const budget = inspectAgentDeliveryQuality({
    markdown: '在条件化方案中使用 [1]。',
    requirement: { kind: 'general' },
    runState: 'budget',
  });
  assert.equal(budget.state, 'partial');
  assert.equal(budget.preservedCitationCount, 1);
  assert.ok(budget.issues.some((item) => item.code === 'incomplete-run'));

  const invalid = inspectAgentDeliveryQuality({ markdown: '非法输出', runState: 'invalid-output' });
  assert.equal(invalid.state, 'failed');
});

test('delivery requirements retain explicit chapters through a full-version follow-up', () => {
  const requirement = deriveAgentDeliveryRequirement({
    instruction: '继续完成完整版',
    historyMessages: [
      { role: 'user', content: '请写完整综述。\n# 1.1 研究背景\n# 1.2 方法比较' },
      { role: 'assistant', content: '先给出提纲。' },
    ],
  });
  assert.equal(requirement.kind, 'survey');
  assert.equal(requirement.completeness, 'full');
  assert.deepEqual(requirement.requiredSections, ['1.1 研究背景', '1.2 方法比较']);
  assert.match(buildAgentDeliveryQualityPrompt(requirement), /1\.1 研究背景; 1\.2 方法比较/);
});

test('a narrowed section follow-up takes precedence over the previous full report', () => {
  const requirement = deriveAgentDeliveryRequirement({
    instruction: '只补充 1.2，写完整段落',
    historyMessages: [{ role: 'user', content: '请写完整版综述，章节：研究背景、方法比较、局限性。' }],
  });
  assert.equal(requirement.kind, 'survey');
  assert.equal(requirement.completeness, 'full');
  assert.deepEqual(requirement.requiredSections, ['1.2']);
  assert.equal(deriveAgentDeliveryRequirement({ instruction: '解释马赫数 1.2 的含义' }).requiredSections?.length, 0);
});

test('Chinese chapter lists without a colon or numbering spaces require all four delivered sections', () => {
  const instruction = '请写完整综述，章节包括1.1医疗转运任务与距离需求、1.2构型性能与能源约束、1.3运行设施与适航安全、1.4证据缺口与研究方向。';
  const expected = ['1.1 医疗转运任务与距离需求', '1.2 构型性能与能源约束', '1.3 运行设施与适航安全', '1.4 证据缺口与研究方向'];
  const requirement = deriveAgentDeliveryRequirement({ instruction });
  assert.deepEqual(requirement.requiredSections, expected);
  assert.equal(requirement.completeness, 'full');
  assert.match(buildAgentDeliveryQualityPrompt(requirement), /1\.4 证据缺口与研究方向/);
  for (const prefix of ['章节包括：', '章节：']) {
    assert.deepEqual(deriveAgentDeliveryRequirement({ instruction: instruction.replace('章节包括', prefix) }).requiredSections, expected);
  }

  const markdown = '# 1.1医疗转运任务与距离需求\n\n直接证据受任务与距离条件约束。\n\n# 1.2构型性能与能源约束\n\n背景原理需要按构型区分。\n\n# 1.3运行设施与适航安全\n\n方法迁移仍需适航验证。\n\n# 1.4证据缺口与研究方向\n\n我的推断仅针对本轮证据缺项。';
  const complete = inspectAgentDeliveryQuality({ markdown, requirement });
  assert.deepEqual(complete.missingSections, []);
  assert.equal(complete.state, 'complete');
  const omittedFourth = inspectAgentDeliveryQuality({ markdown: markdown.slice(0, markdown.indexOf('# 1.4')), requirement });
  assert.deepEqual(omittedFourth.missingSections, ['1.4 证据缺口与研究方向']);
  assert.equal(omittedFourth.state, 'partial');

  const continued = deriveAgentDeliveryRequirement({ instruction: '继续完成完整版', historyMessages: [{ role: 'user', content: instruction }] });
  assert.deepEqual(continued.requiredSections, expected);
});

test('direct Chinese writing requests recognize an unspaced numbered title', () => {
  const requirement = deriveAgentDeliveryRequirement({ instruction: '只补充1.2构型性能与能源约束，写完整段落' });
  assert.deepEqual(requirement.requiredSections, ['1.2 构型性能与能源约束']);
  const result = inspectAgentDeliveryQuality({ markdown: '# 1.2构型性能与能源约束\n\n背景条件限制了能源方案的适用性。', requirement });
  assert.deepEqual(result.missingSections, []);
  assert.equal(result.state, 'complete');
});

test('unspaced Chinese titles still require the exact chapter number', () => {
  const requirement = { kind: 'survey' as const, requiredSections: ['1.2构型性能与能源约束'] };
  for (const heading of ['2.2构型性能与能源约束', '1.2.1构型性能与能源约束', '1.20构型性能与能源约束']) {
    const result = inspectAgentDeliveryQuality({ markdown: `# ${heading}\n\n背景条件需要明确。`, requirement });
    assert.deepEqual(result.missingSections, ['1.2构型性能与能源约束'], heading);
    assert.equal(result.state, 'partial', heading);
  }
});

test('ordinary unspaced decimal values do not become Chinese chapter requirements', () => {
  for (const instruction of [
    '解释马赫1.2工况、温度比1.4和压力1.1Pa的含义',
    '补充马赫1.2工况的背景说明',
    '1.2倍压力下的运行条件是什么？',
    '章节中提到马赫1.2，它代表什么？',
    '请写马赫1.2工况的说明',
    '解释马赫1.2~1.4的工况差异',
    '请写1.2~1.4马赫的仿真方案',
    '写 1.2~1.4 马赫工况的说明',
  ]) {
    assert.deepEqual(deriveAgentDeliveryRequirement({ instruction }).requiredSections, [], instruction);
  }
});

test('explicit chapter ranges require the exact numbered sections', () => {
  const requirement = deriveAgentDeliveryRequirement({ instruction: '写 1.1~1.3 的完整综述' });
  assert.deepEqual(requirement.requiredSections, ['1.1', '1.2', '1.3']);
  assert.deepEqual(deriveAgentDeliveryRequirement({ instruction: '章节包括1.1~1.3' }).requiredSections, ['1.1', '1.2', '1.3']);
  assert.deepEqual(deriveAgentDeliveryRequirement({ instruction: '章节：1.1~1.3、2.1～2.2' }).requiredSections, ['1.1', '1.2', '1.3', '2.1', '2.2']);
  const result = inspectAgentDeliveryQuality({ markdown: '# 1.1 背景\n\n背景段落。\n\n# 1.2.1 方法\n\n方法迁移说明。\n\n# 1.3 局限\n\n我的推断受适用条件约束。', requirement });
  assert.deepEqual(result.missingSections, ['1.2']);
  const wrongNumber = inspectAgentDeliveryQuality({ markdown: '# 2.1 方法比较\n\n背景内容。', requirement: { kind: 'survey', requiredSections: ['1.1 方法比较'] } });
  assert.deepEqual(wrongNumber.missingSections, ['1.1 方法比较']);
});

test('legal citation tokens are consumed by rendering instead of treated as protocol leaks', () => {
  const markdown = '# 背景\n\n直接证据见 [[cite:canonical-paper-a]]，方法迁移仍需验证。';
  const result = inspectAgentDeliveryQuality({ markdown, requirement: { kind: 'survey', completeness: 'full', requiredSections: ['背景'] } });
  assert.equal(result.state, 'complete');
  assert.equal(result.hasInternalProtocolLeak, false);
  assert.equal(result.preservedCitationCount, 1);
  assert.equal(markdown, '# 背景\n\n直接证据见 [[cite:canonical-paper-a]]，方法迁移仍需验证。');
});

test('user-requested 1.x headings are retained while unrequested placeholders remain partial', () => {
  const markdown = '# 1.x 方法迁移\n\n背景原理可作为方法迁移的依据。';
  const explicit = deriveAgentDeliveryRequirement({ instruction: '写 1.x 方法迁移，完整正文' });
  assert.equal(explicit.allowPlaceholderNumbering, true);
  assert.equal(inspectAgentDeliveryQuality({ markdown, requirement: explicit }).state, 'complete');
  assert.ok(inspectAgentDeliveryQuality({ markdown, requirement: { kind: 'survey' } }).issues.some((item) => item.code === 'unfinished-content'));
});

test('full writing cannot be satisfied with an outline or an empty requested section', () => {
  const outline = inspectAgentDeliveryQuality({ markdown: '# 背景\n- 背景原则\n\n# 方法\n- 方法迁移', requirement: { kind: 'survey', completeness: 'full', requiredSections: ['背景', '方法'] } });
  assert.equal(outline.state, 'partial');
  assert.ok(outline.issues.some((item) => item.code === 'unfinished-content'));
  const emptySection = inspectAgentDeliveryQuality({ markdown: '# 背景\n\n背景正式段落。\n\n# 方法\n- 方法迁移', requirement: { kind: 'survey', completeness: 'full', requiredSections: ['背景', '方法'] } });
  assert.ok(emptySection.issues.some((item) => item.code === 'unfinished-content' && item.section === '方法'));
});

test('headings and placeholder examples inside code cannot satisfy or invalidate delivered chapters', () => {
  const missing = inspectAgentDeliveryQuality({
    markdown: '# 引言\r\n\r\n背景正式段落。\r\n\r\n```markdown\r\n# 1.1 方法\r\n方法迁移样例。\r\n```',
    requirement: { kind: 'survey', completeness: 'full', requiredSections: ['1.1 方法'] },
  });
  assert.deepEqual(missing.headings, ['引言']);
  assert.deepEqual(missing.missingSections, ['1.1 方法']);
  assert.equal(missing.state, 'partial');
  const codeOnlyBody = inspectAgentDeliveryQuality({
    markdown: '# 引言\n\n背景正式段落。\n\n# 1.1 方法\n~~~markdown\n# 示范\n代码中的段落。\n~~~\n\n# 1.2 局限\n\n方法迁移仍需验证。',
    requirement: { kind: 'survey', completeness: 'full', requiredSections: ['1.1 方法', '1.2 局限'] },
  });
  assert.deepEqual(codeOnlyBody.missingSections, []);
  assert.ok(codeOnlyBody.issues.some((item) => item.code === 'unfinished-content' && item.section === '1.1 方法'));
  const literalPlaceholder = inspectAgentDeliveryQuality({ markdown: '背景正式段落。\n\n```markdown\n# 1.x 示例\n```', requirement: { kind: 'survey' } });
  assert.equal(literalPlaceholder.state, 'complete');
});

test('unclosed final content remains partial and an empty final answer fails', () => {
  for (const suffix of ['```ts\nconst x = 1;', '$$\nU_j = 1', '[[cite:canonical']) {
    const result = inspectAgentDeliveryQuality({ markdown: `背景段落。\n\n${suffix}`, requirement: { kind: 'survey' } });
    assert.equal(result.state, 'partial');
    assert.ok(result.issues.some((item) => item.code === 'unfinished-content'));
  }
  assert.equal(inspectAgentDeliveryQuality({ markdown: '' }).state, 'failed');
  const code = inspectAgentDeliveryQuality({ markdown: 'Background evidence.\n\n```text\n[[cite:example\n$$\n```', requirement: { kind: 'survey' } });
  assert.equal(code.state, 'complete', 'literal syntax inside a closed code block is not an unfinished response');
});

test('hot-jet delivery requires regime, energy, inlet, outlet, walls, and acoustics', () => {
  const requirement = deriveAgentDeliveryRequirement({ instruction: '给出热喷流仿真边界条件' });
  assert.equal(requirement.engineeringTopic, 'hot-jet');
  const missing = inspectAgentDeliveryQuality({ markdown: '背景证据：若入口已知速度，可采用速度入口，单位 m/s；未知压力需要补充，验证网格敏感性。', requirement });
  assert.equal(missing.state, 'partial');
  assert.ok(missing.issues.some((item) => item.code === 'engineering-structure-gap' && /能量|壁面|声学/.test(item.message)));
  const conditional = inspectAgentDeliveryQuality({
    markdown: '直接证据与我的推断应区分。若热喷流为可压缩亚音速，应求解能量方程。已知入口速度（m/s）和温度（K）时采用速度入口；未知总压或总温须先提供，不能编造。远场和出口采用适用于该工况的压力出口（Pa）；壁面采用无滑移并根据已知热条件选择绝热或等温。声学设置需要验证 FW-H 面位置、网格和时间步敏感性。',
    requirement,
  });
  assert.equal(conditional.state, 'complete');
  assert.equal(conditional.issues.length, 0);
});

test('conditional hot-jet delivery checks also recognize English engineering structure', () => {
  const requirement = deriveAgentDeliveryRequirement({ instruction: 'Provide hot jet boundary conditions for the simulation setup' });
  const result = inspectAgentDeliveryQuality({
    markdown: 'Direct evidence and inference must be distinguished. If the hot jet is compressible and subsonic, solve the energy equation. Known inlet velocity (m/s) and temperature (K) permit a velocity inlet; unknown total conditions must be supplied before using stagnation pressure. Use a far-field pressure outlet (Pa) when the regime permits it. Select no-slip walls and adiabatic or isothermal thermal conditions according to the known wall temperature. Acoustic settings require validation of the FW-H surface, mesh convergence, and time-step sensitivity.',
    requirement,
  });
  assert.equal(result.state, 'complete');
  assert.equal(result.issues.length, 0);
});

test('local evidence gaps remain bounded while unsupported field-wide absence is warned', () => {
  const result = inspectAgentDeliveryQuality({ markdown: '背景说明：本轮所检索文献尚未覆盖该热喷流工况，缺少的参数需进一步检索。', requirement: { kind: 'survey' } });
  assert.equal(result.state, 'complete');
  assert.equal(result.issues.some((item) => item.code === 'unbounded-research-gap'), false);
});

test('raw paper and category IDs leak protocol while canonical citation IDs remain consumable', () => {
  const canonical = '[[cite:agent-rag:paper_mufwwou2_5a014354:pdf-text:page-1]]';
  for (const rawId of ['paper_mufwwou2_5a014354', 'category_mufwwou2_5a014354']) {
    const markdown = `范围：单一论文 ${rawId}，全文切片。直接证据见 ${canonical}。`;
    const result = inspectAgentDeliveryQuality({ markdown, requirement: { kind: 'survey' } });
    assert.equal(result.hasInternalProtocolLeak, true);
    assert.ok(result.issues.some((item) => item.code === 'internal-protocol-leak'));
    assert.equal(result.preservedCitationCount, 1);
  }
  const clean = inspectAgentDeliveryQuality({ markdown: `直接证据见 ${canonical}。本篇结论需按适用条件使用。`, requirement: { kind: 'survey' } });
  assert.equal(clean.hasInternalProtocolLeak, false);
  assert.equal(clean.state, 'complete');
  assert.equal(clean.preservedCitationCount, 1);
});

test('paper-local and search-local gaps and denials of field-wide absence do not warn', () => {
  const boundedStatements = [
    '背景说明：本篇文献中尚无热喷流声学研究证据；本轮检索尚无直接证据，不等于该领域不存在研究。',
    '背景说明：在本轮检索范围内，尚无研究证据支持该工况。',
    '背景说明：不能据此断言该领域不存在任何研究，本文没有覆盖该问题。',
    '背景说明：目前的缺项不足以证明相关研究完全没有声学方法。',
    '背景说明：这并不意味着文献中不存在可行的方法。',
    '背景说明：没有充分证据支持“这一领域尚无相关研究”的结论。',
  ];
  for (const markdown of boundedStatements) {
    const result = inspectAgentDeliveryQuality({ markdown, requirement: { kind: 'survey' } });
    assert.equal(result.issues.some((item) => item.code === 'unbounded-research-gap'), false, markdown);
    assert.equal(result.state, 'complete', markdown);
  }
});

test('local limitations cannot excuse a later unbounded positive absence claim', () => {
  for (const markdown of [
    '背景说明：该领域不存在任何研究。',
    '背景说明：本轮没有找到直接证据，但该领域完全没有相关研究。',
    '背景说明：不能据此断言不存在研究；相关研究中尚无方法。',
    '背景说明：本轮没有找到直接证据，因此说明该领域不存在研究。',
  ]) {
    const result = inspectAgentDeliveryQuality({ markdown, requirement: { kind: 'survey' } });
    assert.ok(result.issues.some((item) => item.code === 'unbounded-research-gap'), markdown);
    assert.equal(result.state, 'partial');
  }
});
