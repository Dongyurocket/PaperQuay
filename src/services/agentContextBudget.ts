import type { AgentLoopMessage } from './agentLoop';

export const DEFAULT_AGENT_CONTEXT_WINDOW = 128_000;
export const DEFAULT_AGENT_CONTEXT_RESERVE = 16_384;

export interface AgentSessionArtifacts {
  readPaperIds: string[];
  citedPages: string[];
  appliedPlanIds: string[];
}

export interface AgentContextCompactionPlan {
  required: boolean;
  tokenEstimate: number;
  budget: number;
  reserve: number;
  boundaryIndex: number;
  messagesToCompact: AgentLoopMessage[];
}

export function emptyAgentSessionArtifacts(): AgentSessionArtifacts {
  return {
    readPaperIds: [],
    citedPages: [],
    appliedPlanIds: [],
  };
}

export function estimateTokens(text: string): number {
  const characters = String(text ?? '').length;

  if (characters === 0) {
    return 0;
  }

  const hasCjk = /[\u3400-\u9fff\uf900-\ufaff]/u.test(text);
  const latinEstimate = Math.ceil(characters / 4);
  const cjkEstimate = hasCjk ? Math.ceil(characters / 1.5) : 0;

  return Math.max(latinEstimate, cjkEstimate);
}

export function estimateMessagesTokens(messages: Array<Pick<AgentLoopMessage, 'content'>>): number {
  return messages.reduce((total, message) => total + estimateTokens(message.content), 0);
}

/**
 * The newest user message starts the active turn. Only messages before it may
 * be compacted, so tool results from the active turn are never split apart.
 */
export function findLatestUserTurnBoundary(messages: AgentLoopMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      return index;
    }
  }

  return -1;
}

export function planAgentContextCompaction(input: {
  messages: AgentLoopMessage[];
  contextWindow?: number;
  reserve?: number;
}): AgentContextCompactionPlan {
  const budget = Math.max(1, Math.trunc(input.contextWindow ?? DEFAULT_AGENT_CONTEXT_WINDOW));
  const reserve = Math.max(0, Math.min(budget - 1, Math.trunc(input.reserve ?? DEFAULT_AGENT_CONTEXT_RESERVE)));
  const tokenEstimate = estimateMessagesTokens(input.messages);
  const boundaryIndex = findLatestUserTurnBoundary(input.messages);
  const messagesToCompact = boundaryIndex > 1 ? input.messages.slice(1, boundaryIndex) : [];

  return {
    required: tokenEstimate > budget - reserve && messagesToCompact.length > 0,
    tokenEstimate,
    budget,
    reserve,
    boundaryIndex,
    messagesToCompact,
  };
}

function joined(values: string[]): string {
  return values.length > 0 ? values.join(', ') : 'none';
}

export function artifactTrail(artifacts: AgentSessionArtifacts): string {
  return [
    '## Persistent Artifacts',
    `- Read papers: ${joined(artifacts.readPaperIds)}`,
    `- Cited pages: ${joined(artifacts.citedPages)}`,
    `- Applied plans: ${joined(artifacts.appliedPlanIds)}`,
  ].join('\n');
}

export function normalizeCompactionSummary(
  summary: string,
  artifacts: AgentSessionArtifacts,
): string {
  const content = String(summary ?? '').trim();
  const structured = content.startsWith('## 会话进度摘要') || content.startsWith('## Conversation Progress Summary')
    ? content
    : [
      '## 会话进度摘要',
      '- 目标: 已压缩早期对话；请基于保留的上下文继续。',
      '- 已完成: 已保存可用的历史信息。',
      '- 关键决定: 见下方摘要内容。',
      '- 引用的论文与页码: 见 Persistent Artifacts。',
      '- 下一步: 继续当前用户请求。',
      '',
      content || 'No model summary was available.',
    ].join('\n');

  return `${structured}\n\n${artifactTrail(artifacts)}`;
}

export function compactMessagesAtUserBoundary(input: {
  messages: AgentLoopMessage[];
  boundaryIndex: number;
  summary: string;
  artifacts: AgentSessionArtifacts;
}): AgentLoopMessage[] {
  if (input.boundaryIndex <= 1 || input.boundaryIndex >= input.messages.length) {
    return input.messages;
  }

  const rootSystem = input.messages[0];

  if (!rootSystem || rootSystem.role !== 'system') {
    return input.messages;
  }

  return [
    rootSystem,
    {
      role: 'system',
      content: normalizeCompactionSummary(input.summary, input.artifacts),
    },
    ...input.messages.slice(input.boundaryIndex),
  ];
}

export function fallbackCompactionSummary(
  messages: AgentLoopMessage[],
  artifacts: AgentSessionArtifacts,
): string {
  const excerpts = messages
    .filter((message) => message.content.trim())
    .slice(-8)
    .map((message) => `${message.role}: ${message.content.slice(0, 600)}`)
    .join('\n\n');

  return normalizeCompactionSummary([
    '## 会话进度摘要',
    '- 目标: 在摘要调用失败后保留最近完整轮次。',
    '- 已完成: 已保留最近消息和产物轨迹。',
    '- 关键决定: 请以下方摘录为准。',
    '- 引用的论文与页码: 见 Persistent Artifacts。',
    '- 下一步: 继续当前用户请求。',
    '',
    excerpts,
  ].join('\n'), artifacts);
}
