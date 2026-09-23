import type { AgentLoopMessage } from './agentLoop';

export const DEFAULT_AGENT_CONTEXT_WINDOW = 128_000;
export const DEFAULT_AGENT_CONTEXT_RESERVE = 16_384;

/** 工具视觉附件注入会话时使用的合成 user 消息文本；压缩边界识别时必须跳过它。 */
export const AGENT_VISUAL_CONTEXT_MESSAGE = 'Visual content returned by the preceding PaperQuay tool calls.';

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

export function estimateMessagesTokens(
  messages: Array<Pick<AgentLoopMessage, 'content'> & Partial<Pick<AgentLoopMessage, 'toolCalls' | 'attachments'>>>,
): number {
  return messages.reduce((total, message) => {
    let messageTokens = estimateTokens(message.content);

    // 工具调用参数与附件 base64 同样占用上下文，必须计入估算，否则压缩触发会偏晚。
    for (const call of message.toolCalls ?? []) {
      messageTokens += estimateTokens(`${call.name} ${JSON.stringify(call.arguments ?? {})}`);
    }

    for (const attachment of message.attachments ?? []) {
      const dataUrlLength = attachment.dataUrl?.length ?? 0;
      messageTokens += Math.ceil(dataUrlLength / 4) + estimateTokens(attachment.name ?? '');
    }

    return total + messageTokens;
  }, 0);
}

/**
 * The newest user message starts the active turn. Only messages before it may
 * be compacted, so tool results from the active turn are never split apart.
 * 合成视觉上下文消息不是真实用户指令，不能作为轮次边界。
 */
export function findLatestUserTurnBoundary(messages: AgentLoopMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message?.role === 'user' && message.content !== AGENT_VISUAL_CONTEXT_MESSAGE) {
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
