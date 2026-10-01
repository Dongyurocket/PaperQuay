import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWorkingMemoryInjection,
  formatWorkingMemory,
  mergeRejectedClaims,
  parseRejectedClaims,
  WORKING_MEMORY_INJECT_CHARS,
  WORKING_MEMORY_MAX_CHARS,
  WORKING_MEMORY_OVER_LIMIT_HINT,
  type RejectedClaimLine,
} from '../src/services/agentMemoryContract.ts';

const sampleClaims: RejectedClaimLine[] = [
  {
    text: '倾转旋翼的过渡走廊只与总距相关',
    status: 'not-in-library',
    reason: '库内检索无对应片段',
    source: 'citation-audit',
  },
  {
    text: 'S-76 使用了主动降噪襟翼',
    status: 'contradicted',
    reason: '与《旋翼气动噪声》第 4 页相反',
    source: 'user',
  },
];

test('formatWorkingMemory 输出标准结构，parseRejectedClaims 编解码一致', () => {
  const content = formatWorkingMemory({
    file: 'topics',
    updatedOn: '2026-09-30',
    currentTask: '梳理旋翼噪声文献',
    openQuestions: ['S-76 是否有襟翼？'],
    rejectedClaims: sampleClaims,
  });

  assert.ok(content.startsWith('# Working memory\nUpdated: 2026-09-30'));
  assert.ok(content.includes('## Current task'));
  assert.ok(content.includes('梳理旋翼噪声文献'));
  assert.ok(content.includes('## Open questions'));
  assert.ok(content.includes('- S-76 是否有襟翼？'));
  assert.ok(content.includes('## Rejected claims'));

  const parsed = parseRejectedClaims(content);
  assert.deepEqual(parsed, sampleClaims);

  // 再格式化保持幂等（编解码一致性）
  const reformatted = formatWorkingMemory({
    file: 'topics',
    updatedOn: '2026-09-30',
    currentTask: '梳理旋翼噪声文献',
    openQuestions: ['S-76 是否有襟翼？'],
    rejectedClaims: parsed,
  });
  assert.deepEqual(parseRejectedClaims(reformatted), sampleClaims);
});

test('formatWorkingMemory 的 synthesis 模板只保留 Progress 与 Next step', () => {
  const content = formatWorkingMemory({
    file: 'synthesis',
    updatedOn: '2026-09-30',
    currentTask: '不应出现',
    openQuestions: ['不应出现'],
    rejectedClaims: sampleClaims,
    progress: '已完成邻域扫描',
    nextStep: '补读两篇文献',
  });

  assert.ok(content.includes('## Progress'));
  assert.ok(content.includes('已完成邻域扫描'));
  assert.ok(content.includes('## Next step'));
  assert.ok(content.includes('补读两篇文献'));
  assert.ok(!content.includes('## Current task'));
  assert.ok(!content.includes('## Rejected claims'));
  assert.ok(!content.includes('文献结论'));
});

test('parseRejectedClaims 对手工编辑的残缺行兜底保留', () => {
  const content = [
    '# Working memory',
    '## Rejected claims',
    '',
    '- [user-rejected] 只写了主张文本',
    '- [unknown-status] 这行状态不合法应被忽略',
    '普通文本行应被忽略',
  ].join('\n');

  const parsed = parseRejectedClaims(content);
  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0], {
    text: '只写了主张文本',
    status: 'user-rejected',
    reason: '',
    source: '',
  });
});

test('mergeRejectedClaims 去重合并、追加新项且保护 Current task 段', () => {
  const existing = formatWorkingMemory({
    file: 'topics',
    updatedOn: '2026-09-30',
    currentTask: '原始任务不能被动',
    openQuestions: [],
    rejectedClaims: [sampleClaims[0]],
  });

  const incoming: RejectedClaimLine[] = [
    sampleClaims[0], // 与既有重复，应被去重
    sampleClaims[1], // 新项，追加到段尾
  ];
  const merged = mergeRejectedClaims(existing, incoming);

  assert.equal(merged.added, 1);
  assert.equal(merged.droppedBecauseFull, 0);
  assert.ok(merged.content.includes('## Current task\n\n原始任务不能被动'));

  const parsed = parseRejectedClaims(merged.content);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0]?.text, sampleClaims[0].text);
  assert.equal(parsed[1]?.text, sampleClaims[1].text);
});

test('mergeRejectedClaims 在既有文件没有 Rejected claims 段时补段且不破坏其他内容', () => {
  const existing = '# Working memory\nUpdated: 2026-09-29\n\n## Current task\n\n手工维护的任务\n';
  const merged = mergeRejectedClaims(existing, [sampleClaims[0]]);

  assert.equal(merged.added, 1);
  assert.ok(merged.content.includes('## Current task\n\n手工维护的任务'));
  assert.ok(merged.content.includes('## Rejected claims'));
  assert.equal(parseRejectedClaims(merged.content).length, 1);
});

test('mergeRejectedClaims 超出 4_000 字符时丢弃新项并保留全部旧否定项', () => {
  // 构造接近上限的既有文件：Current task 占掉大部分空间
  const existingClaims: RejectedClaimLine[] = Array.from({ length: 3 }, (_, index) => ({
    text: `历史否定项 ${index}`,
    status: 'user-rejected',
    reason: '历史原因',
    source: 'user',
  }));
  const existing = formatWorkingMemory({
    file: 'topics',
    updatedOn: '2026-09-30',
    currentTask: '占'.repeat(WORKING_MEMORY_MAX_CHARS - 800),
    openQuestions: [],
    rejectedClaims: existingClaims,
  });
  assert.ok(existing.length <= WORKING_MEMORY_MAX_CHARS);

  const incoming: RejectedClaimLine[] = Array.from({ length: 20 }, (_, index) => ({
    text: `新否定项 ${index}：${'长'.repeat(80)}`,
    status: 'not-in-library',
    reason: '库内未找到',
    source: 'citation-audit',
  }));
  const merged = mergeRejectedClaims(existing, incoming);

  assert.ok(merged.content.length <= WORKING_MEMORY_MAX_CHARS);
  assert.ok(merged.droppedBecauseFull > 0);
  assert.ok(merged.added < incoming.length);
  // 历史否定项一项不丢
  for (const claim of existingClaims) {
    assert.ok(merged.content.includes(claim.text));
  }
  assert.ok(merged.content.includes('## Current task'));
});

test('buildWorkingMemoryInjection 注入政策句并按 1_200 字符截断超长文件', () => {
  const longTopics = `# Working memory\n## Current task\n\n${'任'.repeat(WORKING_MEMORY_INJECT_CHARS + 200)}`;
  const injection = buildWorkingMemoryInjection({ topics: longTopics, synthesis: '' });

  // 政策句始终在
  assert.ok(injection.includes('工作记忆政策'));
  assert.ok(injection.includes('[Local Agent memory]'));
  // 超长注入被截断并追加提示行
  assert.ok(injection.includes(WORKING_MEMORY_OVER_LIMIT_HINT));
  const topicsSection = injection.split('L2 topics:\n')[1] ?? '';
  assert.ok(topicsSection.startsWith(longTopics.slice(0, 200)));
  assert.ok(!topicsSection.includes('任'.repeat(WORKING_MEMORY_INJECT_CHARS + 1)));
  // 空文件不附加正文段
  assert.ok(!injection.includes('L3 synthesis:'));
});

test('buildWorkingMemoryInjection 短内容完整注入且无超限提示', () => {
  const injection = buildWorkingMemoryInjection({
    topics: '# Working memory\n## Current task\n\n短任务',
    synthesis: '# Working memory\n## Progress\n\n短进展',
  });

  assert.ok(injection.includes('短任务'));
  assert.ok(injection.includes('短进展'));
  assert.ok(!injection.includes(WORKING_MEMORY_OVER_LIMIT_HINT));
});

test('buildWorkingMemoryInjection 空记忆时仍返回政策块', () => {
  const injection = buildWorkingMemoryInjection({ topics: '', synthesis: '' });

  assert.ok(injection.includes('[Local Agent memory]'));
  assert.ok(injection.includes('工作记忆政策'));
  assert.ok(!injection.includes('L2 topics:'));
});
