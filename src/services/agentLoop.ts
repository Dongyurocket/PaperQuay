import type { DocumentChatAttachment } from '../types/reader';
import type { AgentMemoryWritePlan } from './agentMemory';
import {
  compactMessagesAtUserBoundary,
  emptyAgentSessionArtifacts,
  fallbackCompactionSummary,
  planAgentContextCompaction,
  type AgentSessionArtifacts,
} from './agentContextBudget.ts';
import type {
  LibraryAgentPlan,
  LibraryAgentRagCitation,
  LibraryAgentRunResult,
} from './libraryAgent';

export const DEFAULT_AGENT_LOOP_MAX_TURNS = 8;
export const MAX_TOOL_RESULT_CHARS = 4000;

export interface AgentLoopMessage {
  role: 'system' | 'assistant' | 'user' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: AgentToolCall[];
  attachments?: DocumentChatAttachment[];
}

export interface AgentToolCard {
  kind: 'papers' | 'citations' | 'figure' | 'memory' | 'text';
  title: string;
  detail?: string;
  data?: Record<string, unknown>;
}

export interface AgentToolResult {
  content: string;
  cards?: AgentToolCard[];
  attachments?: DocumentChatAttachment[];
  /** Write tools return a reviewable plan and are never applied by the loop. */
  plan?: LibraryAgentPlan;
  /** Memory writes use an independent approval card instead of paper mutations. */
  memoryPlan?: AgentMemoryWritePlan;
}

export interface AgentToolMountContext {
  papersCount: number;
  hasOpenDocument: boolean;
  ragReady: boolean;
  localLibraryMode: boolean;
}

export interface AgentToolRuntimeContext {
  [key: string]: unknown;
}

export interface AgentToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  kind: 'read' | 'write';
  available?: (ctx: AgentToolMountContext) => boolean;
  execute: (
    args: Record<string, unknown>,
    ctx: AgentToolRuntimeContext,
  ) => Promise<AgentToolResult>;
}

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentTokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface AgentChatTurnResponse {
  content: string;
  thinking?: string | null;
  toolCalls?: AgentToolCall[];
  finishReason?: string;
  usage?: Partial<AgentTokenUsage>;
  didStream?: boolean;
}

export interface AgentChatTurnRequest {
  messages: AgentLoopMessage[];
  tools?: Array<Record<string, unknown>>;
  toolChoice: 'auto' | 'none';
  stream: boolean;
  onAnswerDelta?: (text: string) => void;
  onThinkingDelta?: (text: string) => void;
}

export type AgentLoopEvent =
  | { kind: 'turn_start'; turn: number }
  | { kind: 'tool_call'; turn: number; callId: string; name: string; args: Record<string, unknown> }
  | { kind: 'tool_result'; turn: number; callId: string; name: string; ok: boolean; preview: string }
  | { kind: 'answer_delta'; text: string }
  | { kind: 'thinking_delta'; text: string }
  | { kind: 'context_compacted'; tokenEstimate: number; droppedMessages: number; fallback: boolean }
  | {
    kind: 'turn_end';
    turn: number;
    finishReason: string;
    promptTokens: number;
    completionTokens: number;
  }
  | { kind: 'error'; turn?: number; message: string };

export interface AgentContextCompactionOptions {
  contextWindow?: number;
  reserve?: number;
  artifacts?: AgentSessionArtifacts;
  compact: (input: {
    messages: AgentLoopMessage[];
    artifacts: AgentSessionArtifacts;
  }) => Promise<string>;
}

export interface AgentLoopCheckpoint {
  turn: number;
  messages: AgentLoopMessage[];
}

export interface AgentLoopOptions {
  maxTurns?: number;
  tools: AgentToolDefinition[];
  mountContext: AgentToolMountContext;
  runtimeContext: AgentToolRuntimeContext;
  messages: AgentLoopMessage[];
  contextLabel: string;
  citations?: LibraryAgentRagCitation[];
  ragNotice?: string | null;
  chatTurn: (request: AgentChatTurnRequest) => Promise<AgentChatTurnResponse>;
  onEvent?: (event: AgentLoopEvent) => void;
  onCheckpoint?: (checkpoint: AgentLoopCheckpoint) => void;
  signal?: AbortSignal;
  contextCompaction?: AgentContextCompactionOptions;
}

function abortError(): Error {
  const error = new Error('Agent run aborted');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw abortError();
  }
}

function truncateToolContent(value: string): string {
  const text = String(value ?? '');

  if (text.length <= MAX_TOOL_RESULT_CHARS) {
    return text;
  }

  return `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n\n[Tool result truncated by PaperQuay]`;
}

function normalizeToolArguments(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeUsage(value: Partial<AgentTokenUsage> | undefined): AgentTokenUsage {
  const positiveInteger = (input: unknown) => {
    const number = Number(input);
    return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
  };

  return {
    promptTokens: positiveInteger(value?.promptTokens),
    completionTokens: positiveInteger(value?.completionTokens),
  };
}

function modelTools(tools: AgentToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function mergePlans(plans: LibraryAgentPlan[]): LibraryAgentPlan | null {
  const first = plans[0];

  if (!first) {
    return null;
  }

  if (plans.length === 1) {
    return first;
  }

  return {
    ...first,
    title: 'Agent review plan',
    description: plans.map((plan) => plan.description).filter(Boolean).join('\n'),
    items: plans.flatMap((plan) => plan.items),
  };
}

function resultErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error ?? 'Tool execution failed');
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<LibraryAgentRunResult> {
  const maxTurns = Math.max(1, Math.min(32, Math.trunc(options.maxTurns ?? DEFAULT_AGENT_LOOP_MAX_TURNS)));
  const tools = options.tools.filter((tool) => tool.available?.(options.mountContext) !== false);
  const toolByName = new Map(tools.map((tool) => [tool.name, tool]));
  const messages = [...options.messages];
  const emit = (event: AgentLoopEvent) => options.onEvent?.(event);
  const checkpoint = (turn: number) => options.onCheckpoint?.({
    turn,
    messages: messages.map((message) => ({ ...message })),
  });
  const compaction = options.contextCompaction;
  const artifacts = compaction?.artifacts ?? emptyAgentSessionArtifacts();
  const compactContextAtTurnBoundary = async () => {
    if (!compaction) {
      return;
    }

    const plan = planAgentContextCompaction({
      messages,
      contextWindow: compaction.contextWindow,
      reserve: compaction.reserve,
    });

    if (!plan.required) {
      return;
    }

    let summary = '';
    let fallback = false;

    try {
      summary = await compaction.compact({
        messages: plan.messagesToCompact,
        artifacts,
      });
    } catch {
      fallback = true;
      summary = fallbackCompactionSummary(plan.messagesToCompact, artifacts);
    }

    const compacted = compactMessagesAtUserBoundary({
      messages,
      boundaryIndex: plan.boundaryIndex,
      summary,
      artifacts,
    });
    messages.splice(0, messages.length, ...compacted);
    emit({
      kind: 'context_compacted',
      tokenEstimate: plan.tokenEstimate,
      droppedMessages: plan.messagesToCompact.length,
      fallback,
    });
  };

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    throwIfAborted(options.signal);
    await compactContextAtTurnBoundary();
    throwIfAborted(options.signal);
    const forceFinalAnswer = turn === maxTurns;
    const turnTools = forceFinalAnswer ? [] : tools;

    if (forceFinalAnswer) {
      messages.push({
        role: 'system',
        content: 'This is the final allowed turn. Do not call tools. Use the information already gathered and answer the user directly.',
      });
    }

    emit({ kind: 'turn_start', turn });
    let emittedAnswerDelta = false;
    let emittedThinkingDelta = false;
    let response: AgentChatTurnResponse;

    try {
      response = await options.chatTurn({
        messages: messages.map((message) => ({
          ...message,
          toolCalls: message.toolCalls?.map((call) => ({ ...call, arguments: { ...call.arguments } })),
          attachments: message.attachments?.map((attachment) => ({ ...attachment })),
        })),
        tools: turnTools.length > 0 ? modelTools(turnTools) : undefined,
        toolChoice: turnTools.length > 0 ? 'auto' : 'none',
        stream: true,
        onAnswerDelta: (text) => {
          if (!text) return;
          emittedAnswerDelta = true;
          emit({ kind: 'answer_delta', text });
        },
        onThinkingDelta: (text) => {
          if (!text) return;
          emittedThinkingDelta = true;
          emit({ kind: 'thinking_delta', text });
        },
      });
    } catch (error) {
      const message = resultErrorMessage(error);
      emit({ kind: 'error', turn, message });
      throw error;
    }

    throwIfAborted(options.signal);
    const usage = normalizeUsage(response.usage);
    const toolCalls = Array.isArray(response.toolCalls) ? response.toolCalls : [];

    if (!emittedThinkingDelta && response.thinking?.trim()) {
      emit({ kind: 'thinking_delta', text: response.thinking.trim() });
    }

    if (!forceFinalAnswer && toolCalls.length > 0) {
      const writeCalls = toolCalls.filter((call) => toolByName.get(call.name)?.kind === 'write');

      if (writeCalls.length > 0) {
        const plans: LibraryAgentPlan[] = [];
        const memoryPlans: AgentMemoryWritePlan[] = [];

        for (const call of writeCalls) {
          const tool = toolByName.get(call.name);
          if (!tool) continue;
          const args = normalizeToolArguments(call.arguments);
          emit({ kind: 'tool_call', turn, callId: call.id, name: call.name, args });

          try {
            const result = await tool.execute(args, options.runtimeContext);
            const content = truncateToolContent(result.content);
            emit({ kind: 'tool_result', turn, callId: call.id, name: call.name, ok: true, preview: content.slice(0, 500) });
            if (result.plan) plans.push(result.plan);
            if (result.memoryPlan) memoryPlans.push(result.memoryPlan);
          } catch (error) {
            const message = resultErrorMessage(error);
            emit({ kind: 'tool_result', turn, callId: call.id, name: call.name, ok: false, preview: message.slice(0, 500) });
            emit({ kind: 'error', turn, message });
            throw error;
          }
        }

        emit({
          kind: 'turn_end',
          turn,
          finishReason: 'write_plan',
          ...usage,
        });
        const plan = mergePlans(plans);

        if (plan && memoryPlans.length > 0) {
          throw new Error('The Agent requested mixed paper and memory writes in one turn. Split them into separate reviewable actions.');
        }

        if (memoryPlans.length > 0) {
          checkpoint(turn);
          return {
            kind: 'memory-plan',
            memoryPlan: memoryPlans[0],
            citations: options.citations,
            ragNotice: options.ragNotice,
          };
        }

        if (!plan) {
          throw new Error('The Agent requested a write tool but did not produce a reviewable plan.');
        }

        checkpoint(turn);
        return {
          kind: 'plan',
          plan,
          citations: options.citations,
          ragNotice: options.ragNotice,
        };
      }

      messages.push({
        role: 'assistant',
        content: response.content || '',
        toolCalls: toolCalls.map((call) => ({
          id: call.id,
          name: call.name,
          arguments: normalizeToolArguments(call.arguments),
        })),
      });

      const results = await Promise.all(toolCalls.map(async (call) => {
        const tool = toolByName.get(call.name);
        const args = normalizeToolArguments(call.arguments);
        emit({ kind: 'tool_call', turn, callId: call.id, name: call.name, args });

        if (!tool) {
          const content = `Unknown PaperQuay tool: ${call.name}`;
          emit({ kind: 'tool_result', turn, callId: call.id, name: call.name, ok: false, preview: content });
          return {
            call,
            content,
            attachments: undefined,
            isError: true,
          };
        }

        try {
          const result = await tool.execute(args, options.runtimeContext);
          const content = truncateToolContent(result.content);
          emit({ kind: 'tool_result', turn, callId: call.id, name: call.name, ok: true, preview: content.slice(0, 500) });
          return {
            call,
            content,
            attachments: result.attachments,
            isError: false,
          };
        } catch (error) {
          const content = resultErrorMessage(error);
          emit({ kind: 'tool_result', turn, callId: call.id, name: call.name, ok: false, preview: content.slice(0, 500) });
          return { call, content, attachments: undefined, isError: true };
        }
      }));

      for (const result of results) {
        messages.push({
          role: 'tool',
          toolCallId: result.call.id,
          content: JSON.stringify({
            name: result.call.name,
            isError: result.isError,
            result: result.content,
          }),
        });

        if (result.attachments?.length) {
          messages.push({
            role: 'user',
            content: `Visual content returned by ${result.call.name}.`,
            attachments: result.attachments,
          });
        }
      }

      emit({
        kind: 'turn_end',
        turn,
        finishReason: 'tool_calls',
        ...usage,
      });
      checkpoint(turn);
      continue;
    }

    const answer = response.content.trim() || 'The model did not return a final answer.';

    if (!emittedAnswerDelta) {
      emit({ kind: 'answer_delta', text: answer });
    }

    messages.push({ role: 'assistant', content: answer });
    emit({
      kind: 'turn_end',
      turn,
      finishReason: forceFinalAnswer ? 'max_turns' : response.finishReason || 'answer',
      ...usage,
    });
    checkpoint(turn);

    return {
      kind: 'answer',
      answer,
      contextLabel: options.contextLabel,
      thinking: response.thinking?.trim() || null,
      citations: options.citations,
      ragNotice: options.ragNotice,
    };
  }

  throw new Error('Agent loop ended without a final response.');
}
