import type { DocumentChatAttachment } from '../types/reader';
import type { AgentMemoryWritePlan } from './agentMemory';
import type { AgentNoteWritePlan } from './agentNotePlan';
import {
  AGENT_VISUAL_CONTEXT_MESSAGE,
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
import { bindAnswerEvidence } from './agentAnswerEvidence.ts';
import { sliceAgentToolText } from './agentToolContent.ts';

export const DEFAULT_AGENT_LOOP_MAX_TURNS = 8;
export const MAX_TOOL_RESULT_CHARS = 4000;
const MAX_TOOL_IMAGES_PER_TURN = 4;
const MAX_TOOL_IMAGE_BYTES_PER_TURN = 8 * 1024 * 1024;

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
  /** Note writes use an independent approval card; never applied by the loop. */
  notePlan?: AgentNoteWritePlan;
}

export interface AgentToolMountContext {
  papersCount: number;
  hasOpenDocument: boolean;
  ragReady: boolean;
  localLibraryMode: boolean;
}

export interface AgentToolRuntimeContext {
  signal?: AbortSignal;
  citations?: LibraryAgentRagCitation[];
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
  signal?: AbortSignal;
  onAnswerDelta?: (text: string) => void;
  onThinkingDelta?: (text: string) => void;
}

export type AgentLoopEvent =
  | { kind: 'turn_start'; turn: number }
  | { kind: 'tool_call'; turn: number; callId: string; name: string; args: Record<string, unknown> }
  | { kind: 'tool_result'; turn: number; callId: string; name: string; ok: boolean; preview: string }
  | { kind: 'answer_delta'; turn: number; text: string }
  | { kind: 'thinking_delta'; turn: number; text: string }
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

const MEMORY_WRITE_TOOL_NAME = 'write_memory';
const NOTE_WRITE_TOOL_NAME = 'write_notes';

function isLikelyContextSizeErrorMessage(message: string): boolean {
  const normalized = message.toLocaleLowerCase();

  return [
    'context length',
    'maximum context',
    'too many tokens',
    'token limit',
    'request too large',
    'payload too large',
    '413',
  ].some((signal) => normalized.includes(signal));
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

function toolAttachmentBytes(attachment: DocumentChatAttachment): number {
  if (Number.isFinite(attachment.size) && attachment.size > 0) {
    return attachment.size;
  }

  const payload = attachment.dataUrl?.split(',')[1] ?? '';
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(payload.length * 3 / 4) - padding);
}

const TOOL_TEXT_FIELDS = new Set(['text', 'snippet', 'previewText', 'abstract', 'overview', 'excerpt', 'summary', 'detail']);

function truncateTextAtParagraphs(value: string, budget: number): { text: string; truncated: boolean; offset: number } {
  return sliceAgentToolText(String(value ?? ''), budget);
}

function clipStructuredStrings(value: unknown, textBudget: number): { value: unknown; clipped: boolean } {
  if (Array.isArray(value)) {
    let clipped = false;
    const items = value.map((item) => {
      const result = clipStructuredStrings(item, textBudget);
      clipped ||= result.clipped;
      return result.value;
    });
    return { value: items, clipped };
  }
  if (!value || typeof value !== 'object') return { value, clipped: false };
  const output: Record<string, unknown> = {};
  let clipped = false;
  let clippedTextOffset: number | undefined;
  const proseOffsets: Record<string, number> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string' && TOOL_TEXT_FIELDS.has(key)) {
      const result = truncateTextAtParagraphs(item, textBudget);
      output[key] = result.text;
      if (result.truncated) {
        proseOffsets[key] = result.offset;
        clipped = true;
        if (key === 'text') clippedTextOffset = result.offset;
      }
      continue;
    }
    const result = clipStructuredStrings(item, textBudget);
    output[key] = result.value;
    clipped ||= result.clipped;
  }
  // Existing false flags in the source record must not overwrite a new clip.
  for (const [key, offset] of Object.entries(proseOffsets)) {
    output[`${key}Truncated`] = true;
    output[`${key}Offset`] = offset;
  }
  if (clippedTextOffset != null && typeof output.textStart === 'number' && output.continuation && typeof output.continuation === 'object') {
    const offset = output.textStart + clippedTextOffset;
    output.textEnd = offset;
    output.continuation = {
      ...output.continuation,
      offset,
      canContinue: offset > output.textStart,
    };
  }
  return { value: output, clipped };
}

const TOOL_RECORD_ARRAY_KEYS = new Set(['chunks', 'papers', 'matches', 'citations', 'results', 'items', 'contexts', 'records']);

function numericCount(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : undefined;
}

function recordIdentity(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ['paperId', 'documentKey', 'id']) {
    if (typeof record[key] === 'string' && record[key].trim()) return record[key].trim();
  }
  return undefined;
}

function isRecordArray(key: string, value: unknown[]): boolean {
  return TOOL_RECORD_ARRAY_KEYS.has(key) || value.some((item) => item && typeof item === 'object' && !Array.isArray(item));
}

function trimMetadataArray(key: string, value: unknown[], budget: number): unknown[] {
  if (value.length === 0) return [];
  // IDs are indivisible metadata. A budget error is preferable to changing
  // identifiers or silently dropping the IDs needed to resume a paper batch.
  if (/Ids$/.test(key)) return value;
  if (value.every((item) => typeof item === 'string')) {
    const output: string[] = [];
    for (const item of value) {
      if (output.length >= 20) break;
      const clipped = truncateTextAtParagraphs(item as string, Math.min(320, budget));
      output.push(clipped.text);
    }
    return output;
  }
  return value.slice(0, 20);
}

/**
 * Keep tool messages valid JSON while selecting complete records under the
 * context budget. Identity/location fields are kept together; only known
 * prose fields may be paragraph-clipped and are annotated with their offset.
 */
export function truncateToolContent(value: string, budget = MAX_TOOL_RESULT_CHARS): string {
  const text = String(value ?? '');
  const limit = Math.max(128, Math.trunc(budget));
  if (text.length <= limit) return text;

  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object payload');
    const original = parsed as Record<string, unknown>;
    const arrays = Object.entries(original).filter(([, item]) => Array.isArray(item)) as Array<[string, unknown[]]>;
    const recordArrays = arrays.filter(([key, items]) => isRecordArray(key, items));
    const primaryEntry = recordArrays.find(([key]) => TOOL_RECORD_ARRAY_KEYS.has(key)) ?? recordArrays[0];
    const primaryKey = primaryEntry?.[0];
    const primary = primaryEntry?.[1] ?? [];
    const matchedCount = numericCount(original.matchedCount)
      ?? numericCount(original.totalCount)
      ?? numericCount(original.requestedCount)
      ?? primary.length;
    const originalOmittedIds = Array.isArray(original.omittedPaperIds)
      ? original.omittedPaperIds.filter((item): item is string => typeof item === 'string')
      : [];
    const originalContinuation = original.continuation && typeof original.continuation === 'object' && !Array.isArray(original.continuation)
      ? original.continuation as Record<string, unknown> : {};

    const baseOriginal: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(original)) {
      if (Array.isArray(item)) continue;
      if (key === 'matchedCount' || key === 'returnedCount' || key === 'truncated' || key === 'continuation') continue;
      baseOriginal[key] = item;
    }
    const metadataArrays = arrays.filter(([key]) => !recordArrays.some(([recordKey]) => recordKey === key));

    const textBudgets = [Number.POSITIVE_INFINITY, 1600, 900, 500, 300, 180, 100, 60];
    const recordTextBudgets = [Number.POSITIVE_INFINITY, 1400, 900, 600, 360, 220, 120, 60];
    let best = '';
    for (const baseTextBudget of textBudgets) {
      const baseResult = Number.isFinite(baseTextBudget)
        ? clipStructuredStrings(baseOriginal, baseTextBudget)
        : { value: baseOriginal, clipped: false };
      const base = baseResult.value as Record<string, unknown>;
      const metadata: Record<string, unknown> = {};
      for (const [key, items] of metadataArrays) metadata[key] = trimMetadataArray(key, items, Number.isFinite(baseTextBudget) ? baseTextBudget : 320);
      const selected: Record<string, unknown[]> = Object.fromEntries(recordArrays.map(([key]) => [key, []]));
      let clippedAnyText = baseResult.clipped;
      const omittedIds = [...originalOmittedIds];
      let stopped = false;

      const buildCandidate = (forceTruncated: boolean) => {
        const output: Record<string, unknown> = { ...base, ...metadata };
        for (const [key] of recordArrays) output[key] = selected[key] ?? [];
        const omittedPaperIds = [...new Set(omittedIds)];
        if (Array.isArray(original.omittedPaperIds) || originalContinuation.tool === 'request_paper_context') {
          output.omittedPaperIds = omittedPaperIds;
        }
        const returnedCount = primaryKey ? (selected[primaryKey]?.length ?? 0) : numericCount(original.returnedCount) ?? 0;
        const omittedRecords = Math.max(0, matchedCount - returnedCount);
        const truncated = forceTruncated || clippedAnyText || omittedRecords > 0 || original.truncated === true;
        output.matchedCount = matchedCount;
        output.returnedCount = returnedCount;
        output.truncated = truncated;
        if (truncated) {
          const canContinue = originalContinuation.canContinue === true ||
            Object.values(selected).flat().some((record) => {
              if (!record || typeof record !== 'object') return false;
              const continuation = (record as Record<string, unknown>).continuation;
              return Boolean(continuation && typeof continuation === 'object' && (continuation as Record<string, unknown>).canContinue === true);
            }) ||
            (originalContinuation.tool === 'request_paper_context' && omittedIds.length > 0);
          output.continuation = {
            ...originalContinuation,
            canContinue,
            omittedRecords,
            omittedPaperIds,
            hint: canContinue
              ? 'Use the returned per-record continuation or request omittedPaperIds next.'
              : 'Narrow the query or request fewer records; this response has no stable page cursor.',
          };
        }
        return output;
      };

      // Add records in source order. Once a record cannot fit even after prose
      // clipping, stop that array so the returned prefix remains deterministic.
      for (const [key, items] of recordArrays) {
        for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
          const item = items[itemIndex];
          let accepted: unknown;
          let acceptedClipped = false;
          for (const itemBudget of recordTextBudgets) {
            const candidateItem = Number.isFinite(itemBudget)
              ? clipStructuredStrings(item, itemBudget)
              : { value: item, clipped: false };
            selected[key].push(candidateItem.value);
            const serialized = JSON.stringify(buildCandidate(true));
            selected[key].pop();
            if (serialized.length <= limit) {
              accepted = candidateItem.value;
              acceptedClipped = candidateItem.clipped;
              break;
            }
          }
          if (accepted === undefined) {
            stopped = true;
            if (primaryKey === key) {
              for (const omitted of items.slice(itemIndex)) {
                const id = recordIdentity(omitted);
                if (id && !originalOmittedIds.includes(id)) omittedIds.push(id);
              }
            }
            break;
          }
          selected[key].push(accepted);
          clippedAnyText ||= acceptedClipped;
        }
        if (stopped) break;
      }

      const serialized = JSON.stringify(buildCandidate(true));
      if (serialized.length <= limit) {
        best = serialized;
        break;
      }
      // Retry with a smaller base budget. The final fallback below always
      // remains valid JSON, even when metadata alone is unusually large.
    }
    if (best) return best;
    // Identity metadata alone may exceed the budget. Do not wrap a sliced JSON
    // fragment as prose: return an explicit empty batch the model can narrow.
    const overBudget = {
      status: 'budget_exceeded',
      matchedCount,
      returnedCount: 0,
      ...(original.countUnit ? { countUnit: original.countUnit } : {}),
      truncated: true,
      ...(primaryKey ? { [primaryKey]: [] } : {}),
      continuation: { canContinue: false, hint: 'Request fewer records or a narrower query; identity metadata cannot fit the tool-result budget.' },
    };
    const serialized = JSON.stringify(overBudget);
    return serialized.length <= limit ? serialized : JSON.stringify({ status: 'budget_exceeded', returnedCount: 0, truncated: true });
  } catch {
    // Plain text or malformed historical tool output follows the compatibility path.
  }

  const clipped = truncateTextAtParagraphs(text, Math.max(32, limit - 180));
  const fallback = {
    status: 'truncated',
    text: clipped.text,
    textTruncated: clipped.truncated,
    offset: clipped.offset,
    truncated: true,
    continuation: { canContinue: false, offset: clipped.offset, hint: 'Narrow the query or request a smaller result.' },
  };
  const serializedFallback = JSON.stringify(fallback);
  return serializedFallback.length <= limit
    ? serializedFallback
    : JSON.stringify({ status: 'truncated', truncated: true });
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
  const liveCitations: LibraryAgentRagCitation[] = options.citations ??
    (Array.isArray(options.runtimeContext.citations) ? (options.runtimeContext.citations as LibraryAgentRagCitation[]) : []);
  const emit = (event: AgentLoopEvent) => options.onEvent?.(event);
  const checkpoint = (turn: number) => options.onCheckpoint?.({
    turn,
    messages: messages.map((message) => ({ ...message })),
  });
  const compaction = options.contextCompaction;
  const artifacts = compaction?.artifacts ?? emptyAgentSessionArtifacts();
  const compactContextAtTurnBoundary = async (force = false) => {
    if (!compaction) {
      return;
    }

    const plan = planAgentContextCompaction({
      messages,
      contextWindow: compaction.contextWindow,
      reserve: compaction.reserve,
    });

    if (!plan.required && !(force && plan.messagesToCompact.length > 0)) {
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

  let emptyAnswerRecoveryAttempted = false;
  let forceNextFinalAnswer = false;

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    throwIfAborted(options.signal);
    await compactContextAtTurnBoundary();
    throwIfAborted(options.signal);
    const forceFinalAnswer = turn === maxTurns || forceNextFinalAnswer;
    const turnTools = forceFinalAnswer ? [] : tools;

    if (forceFinalAnswer && !forceNextFinalAnswer && turn === maxTurns) {
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
      let contextRetryUsed = false;

      // 估算漏算（附件/工具参数）或压缩后仍超限时，强制压缩后重试一次。
      // eslint-disable-next-line no-constant-condition
      while (true) {
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
            signal: options.signal,
            onAnswerDelta: (text) => {
              if (!text) return;
              emittedAnswerDelta = true;
              emit({ kind: 'answer_delta', turn, text });
            },
            onThinkingDelta: (text) => {
              if (!text) return;
              emittedThinkingDelta = true;
              emit({ kind: 'thinking_delta', turn, text });
            },
          });
          break;
        } catch (turnError) {
          const turnMessage = resultErrorMessage(turnError);

          if (
            !contextRetryUsed &&
            !options.signal?.aborted &&
            isLikelyContextSizeErrorMessage(turnMessage)
          ) {
            contextRetryUsed = true;
            await compactContextAtTurnBoundary(true);
            // A provider can emit text before reporting a context error. The
            // retry is a fresh draft even though it uses the same turn index.
            emittedAnswerDelta = false;
            emittedThinkingDelta = false;
            emit({ kind: 'turn_start', turn });
            continue;
          }

          throw turnError;
        }
      }
    } catch (error) {
      const message = resultErrorMessage(error);
      emit({ kind: 'error', turn, message });
      throw error;
    }

    throwIfAborted(options.signal);
    const usage = normalizeUsage(response.usage);
    const toolCalls = Array.isArray(response.toolCalls) ? response.toolCalls : [];

    if (!emittedThinkingDelta && response.thinking?.trim()) {
      emit({ kind: 'thinking_delta', turn, text: response.thinking.trim() });
    }

    if (!forceFinalAnswer && toolCalls.length > 0) {
      const writeCalls = toolCalls.filter((call) => toolByName.get(call.name)?.kind === 'write');
      const readCalls = toolCalls.filter((call) => toolByName.get(call.name)?.kind !== 'write');

      if (writeCalls.length > 0 && readCalls.length > 0) {
        messages.push({
          role: 'assistant',
          content: response.content || '',
          toolCalls: toolCalls.map((call) => ({
            id: call.id,
            name: call.name,
            arguments: normalizeToolArguments(call.arguments),
          })),
        });
        for (const call of toolCalls) {
          const message = 'PaperQuay does not allow read and write tool calls in the same model turn. Call read tools first, then propose a write plan in a later turn.';
          emit({ kind: 'tool_call', turn, callId: call.id, name: call.name, args: normalizeToolArguments(call.arguments) });
          emit({ kind: 'tool_result', turn, callId: call.id, name: call.name, ok: false, preview: message });
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            content: JSON.stringify({ name: call.name, isError: true, result: message }),
          });
        }
        emit({
          kind: 'turn_end',
          turn,
          finishReason: 'mixed_tool_calls_rejected',
          ...usage,
        });
        checkpoint(turn);
        continue;
      }

      if (writeCalls.length > 0) {
        const memoryWriteCalls = writeCalls.filter((call) => call.name === MEMORY_WRITE_TOOL_NAME);
        const noteWriteCalls = writeCalls.filter((call) => call.name === NOTE_WRITE_TOOL_NAME);
        const paperWriteCalls = writeCalls.filter(
          (call) => call.name !== MEMORY_WRITE_TOOL_NAME && call.name !== NOTE_WRITE_TOOL_NAME,
        );
        const writeKindsPresent =
          (memoryWriteCalls.length > 0 ? 1 : 0)
          + (noteWriteCalls.length > 0 ? 1 : 0)
          + (paperWriteCalls.length > 0 ? 1 : 0);

        // 先落 assistant 消息，保证后续 tool 结果消息有合法前置。
        messages.push({
          role: 'assistant',
          content: response.content || '',
          toolCalls: toolCalls.map((call) => ({
            id: call.id,
            name: call.name,
            arguments: normalizeToolArguments(call.arguments),
          })),
        });

        // 执行前预检：不同写入类型必须分拆；记忆卡一次只能审批一个文件写入。
        if (writeKindsPresent > 1 || memoryWriteCalls.length > 1) {
          const message = writeKindsPresent > 1
            ? 'PaperQuay requires paper, note, and memory writes in separate turns. Propose only one kind of write plan this turn.'
            : 'PaperQuay can review only one memory write per turn. Propose one memory write now and the other in a later turn.';

          for (const call of writeCalls) {
            emit({ kind: 'tool_call', turn, callId: call.id, name: call.name, args: normalizeToolArguments(call.arguments) });
            emit({ kind: 'tool_result', turn, callId: call.id, name: call.name, ok: false, preview: message });
            messages.push({
              role: 'tool',
              toolCallId: call.id,
              content: JSON.stringify({ name: call.name, isError: true, result: message }),
            });
          }

          emit({
            kind: 'turn_end',
            turn,
            finishReason: 'mixed_write_calls_rejected',
            ...usage,
          });
          checkpoint(turn);
          continue;
        }

        const plans: LibraryAgentPlan[] = [];
        const memoryPlans: AgentMemoryWritePlan[] = [];
        const notePlans: AgentNoteWritePlan[] = [];
        const writeToolErrors: string[] = [];

        for (const call of writeCalls) {
          throwIfAborted(options.signal);
          const tool = toolByName.get(call.name);
          if (!tool) continue;
          const args = normalizeToolArguments(call.arguments);
          emit({ kind: 'tool_call', turn, callId: call.id, name: call.name, args });

          try {
            const toolContext: AgentToolRuntimeContext = {
              ...options.runtimeContext,
              citations: liveCitations,
              signal: options.signal,
            };
            const result = await tool.execute(args, toolContext);
            const content = truncateToolContent(result.content);
            emit({ kind: 'tool_result', turn, callId: call.id, name: call.name, ok: true, preview: content.slice(0, 500) });
            messages.push({
              role: 'tool',
              toolCallId: call.id,
              content: JSON.stringify({ name: call.name, isError: false, result: content }),
            });
            if (result.plan) plans.push(result.plan);
            if (result.memoryPlan) memoryPlans.push(result.memoryPlan);
            if (result.notePlan) notePlans.push(result.notePlan);
          } catch (error) {
            throwIfAborted(options.signal);
            // 与读工具对齐：写工具失败作为 tool 结果喂回模型，由下一轮修正或解释，而不是硬终止 run。
            const message = resultErrorMessage(error);
            emit({ kind: 'tool_result', turn, callId: call.id, name: call.name, ok: false, preview: message.slice(0, 500) });
            messages.push({
              role: 'tool',
              toolCallId: call.id,
              content: JSON.stringify({ name: call.name, isError: true, result: message }),
            });
            writeToolErrors.push(`${call.name}: ${message.slice(0, 500)}`);
          }
        }

        // A failed sibling must not discard a successful approval draft. Return
        // the surviving actions for review and make the omitted actions explicit.
        // A completely failed batch still lets the model correct its arguments.
        if (writeToolErrors.length > 0 && plans.length + memoryPlans.length + notePlans.length === 0) {
          emit({
            kind: 'turn_end',
            turn,
            finishReason: 'write_tool_error',
            ...usage,
          });
          checkpoint(turn);
          continue;
        }

        emit({
          kind: 'turn_end',
          turn,
          finishReason: writeToolErrors.length > 0 ? 'partial_write_plan' : 'write_plan',
          ...usage,
        });
        const plan = mergePlans(plans);
        const failureNotice = writeToolErrors.length > 0
          ? `部分写入计划生成失败；当前审批只包含成功生成的操作。 Some write plans failed; this approval contains only the successful actions.\n${writeToolErrors.join('\n')}`
          : '';

        if (memoryPlans.length > 0) {
          checkpoint(turn);
          return {
            kind: 'memory-plan',
            memoryPlan: failureNotice
              ? { ...memoryPlans[0], summary: `${memoryPlans[0].summary}\n${failureNotice}` }
              : memoryPlans[0],
            citations: options.citations,
            ragNotice: options.ragNotice,
          };
        }

        if (notePlans.length > 0) {
          checkpoint(turn);
          return {
            kind: 'note-plan',
            notePlan: {
              ...notePlans[0],
              summary: [notePlans.map((item) => item.summary).filter(Boolean).join('\n'), failureNotice].filter(Boolean).join('\n'),
              operations: notePlans.flatMap((item) => item.operations),
            },
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
          plan: failureNotice ? { ...plan, description: `${plan.description}\n${failureNotice}` } : plan,
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

      // A cancelled sibling must not let the run return while other tools can
      // still register evidence or emit progress. Settle the current batch,
      // then save one response for every declared call before propagating abort.
      const settledResults = await Promise.allSettled(toolCalls.map(async (call) => {
        const tool = toolByName.get(call.name);
        const args = normalizeToolArguments(call.arguments);
        emit({ kind: 'tool_call', turn, callId: call.id, name: call.name, args });
        throwIfAborted(options.signal);

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
          const toolContext: AgentToolRuntimeContext = {
            ...options.runtimeContext,
            citations: liveCitations,
            signal: options.signal,
          };
          const result = await tool.execute(args, toolContext);
          const content = truncateToolContent(result.content);
          emit({ kind: 'tool_result', turn, callId: call.id, name: call.name, ok: true, preview: content.slice(0, 500) });
          return {
            call,
            content,
            attachments: result.attachments,
            isError: false,
          };
        } catch (error) {
          throwIfAborted(options.signal);
          const content = resultErrorMessage(error);
          emit({ kind: 'tool_result', turn, callId: call.id, name: call.name, ok: false, preview: content.slice(0, 500) });
          return { call, content, attachments: undefined, isError: true };
        }
      }));
      const results = settledResults.map((settled, index) => {
        if (settled.status === 'fulfilled') return settled.value;
        const call = toolCalls[index]!;
        const content = resultErrorMessage(settled.reason);
        emit({ kind: 'tool_result', turn, callId: call.id, name: call.name, ok: false, preview: content.slice(0, 500) });
        return { call, content, attachments: undefined, isError: true };
      });

      let toolImageCount = 0;
      let toolImageBytes = 0;
      const acceptedVisualAttachments: DocumentChatAttachment[] = [];

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

        for (const attachment of result.attachments ?? []) {
          const isImage = attachment.kind === 'image' || attachment.kind === 'screenshot' || attachment.mimeType.startsWith('image/');
          if (!isImage) {
            acceptedVisualAttachments.push(attachment);
            continue;
          }
          const bytes = toolAttachmentBytes(attachment);
          if (
            toolImageCount >= MAX_TOOL_IMAGES_PER_TURN ||
            bytes <= 0 ||
            toolImageBytes + bytes > MAX_TOOL_IMAGE_BYTES_PER_TURN
          ) {
            continue;
          }
          toolImageCount += 1;
          toolImageBytes += bytes;
          acceptedVisualAttachments.push(attachment);
        }
      }

      if (acceptedVisualAttachments.length) {
        messages.push({
          role: 'user',
          content: AGENT_VISUAL_CONTEXT_MESSAGE,
          attachments: acceptedVisualAttachments,
        });
      }

      if (options.signal?.aborted) {
        emit({ kind: 'turn_end', turn, finishReason: 'cancelled', ...usage });
        checkpoint(turn);
        throw abortError();
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

    const answer = response.content.trim();

    if (!answer) {
      const isLengthFinish = response.finishReason === 'length';
      const finishReason = isLengthFinish ? 'length' : 'empty_response';

      emit({
        kind: 'turn_end',
        turn,
        finishReason,
        ...usage,
      });
      checkpoint(turn);

      if (!emptyAnswerRecoveryAttempted && turn < maxTurns) {
        emptyAnswerRecoveryAttempted = true;
        forceNextFinalAnswer = true;

        messages.push({
          role: 'assistant',
          content: response.content || '',
        });
        messages.push({
          role: 'system',
          content: isLengthFinish
            ? '上一次输出被长度限制截断，没有产生最终回答。请直接给出简洁最终回答，不要继续推理，不要输出 think 标签。 The previous output was truncated by the length limit and produced no final answer. Provide a concise final answer directly without additional reasoning or <think> tags.'
            : '上一次模型未返回回答正文。请直接给出最终回答。 The previous response contained no answer. Provide a final answer directly.',
        });

        continue;
      }

      const truncatedErrorMessage = emptyAnswerRecoveryAttempted
        ? '模型输出被长度上限截断（finish_reason=length），没有产生最终回答（已尝试自动恢复）。请重试，或在设置里调低思考强度 / 调大最大输出。 Model output was truncated by the length limit (finish_reason=length) and did not produce a final answer (auto-recovery attempted). Please retry, or lower the reasoning effort / increase the maximum output tokens in Settings.'
        : '模型输出被长度上限截断（finish_reason=length），没有产生最终回答。请重试，或在设置里调低思考强度 / 调大最大输出。 Model output was truncated by the length limit (finish_reason=length) and did not produce a final answer. Please retry, or lower the reasoning effort / increase the maximum output tokens in Settings.';

      const errorMessage = isLengthFinish ? truncatedErrorMessage
        : `模型未返回回答正文${emptyAnswerRecoveryAttempted ? '（已尝试自动恢复）' : ''}。请重试。 The model returned no answer content.`;
      emit({ kind: 'error', turn, message: errorMessage });
      throw new Error(errorMessage);
    }

    if (!emittedAnswerDelta) {
      emit({ kind: 'answer_delta', turn, text: answer });
    }

    messages.push({ role: 'assistant', content: answer });
    emit({
      kind: 'turn_end',
      turn,
      // 恢复轮（forceNextFinalAnswer）报告真实 finishReason；只有真正顶到 maxTurns 的强制回答才标 max_turns。
      finishReason: response.finishReason === 'length' ? 'length'
        : forceFinalAnswer && !forceNextFinalAnswer ? 'max_turns' : response.finishReason || 'answer',
      ...usage,
    });
    checkpoint(turn);

    const evidence = bindAnswerEvidence({
      answer,
      citations: liveCitations,
    });

    return {
      kind: 'answer',
      answer,
      contextLabel: options.contextLabel,
      thinking: response.thinking?.trim() || null,
      citations: liveCitations,
      ragNotice: options.ragNotice,
      evidenceStats: evidence.counts,
    };
  }

  throw new Error('Agent loop ended without a final response.');
}
