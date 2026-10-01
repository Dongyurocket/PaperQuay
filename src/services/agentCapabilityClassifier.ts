/**
 * 轻量能力路由分类器（方案第 4.1 节）。
 *
 * 仅当未钉选（或钉选为 auto）、未命中「对比调研」关键词、且指令 trim 后 >= 12 字符时，
 * 由 runConversationalLibraryAgent 调用。提示词只列 4 个 capability ID 与各一句 summary，
 * 并明确声明：文库整理（标签、重命名、分类、元数据）必须返回 null。
 *
 * 任何失败（未配置、超时、报错、解析失败）都返回 null 并 emit capability_route_failed，
 * 由主循环回退普通 ReAct，绝不中断问答；不把分类器原始输出写进 trace。
 */

import {
  getAgentCapability,
  listAgentCapabilities,
  type AgentCapabilityId,
} from './agentCapabilityRegistry.ts';

export const CAPABILITY_CLASSIFIER_TIMEOUT_MS = 20_000;
export const CAPABILITY_CLASSIFIER_MIN_INSTRUCTION_CHARS = 12;

export interface CapabilityClassifierResult {
  capabilityId: AgentCapabilityId | null;
  confidence: number;
}

export interface CapabilityClassifierCallModel {
  (input: { system: string; user: string; signal?: AbortSignal }): Promise<{ content: string }>;
}

export type AgentCapabilityClassifierEvent =
  | { kind: 'capability_route_failed'; reason: string };

/** 分类器提示词：只列 4 个能力 id 与各一句 summary，文库整理必须返回 null。 */
export function buildCapabilityClassifierSystemPrompt(): string {
  const lines = listAgentCapabilities().map((definition) => `- ${definition.id}：${definition.summary}`);

  return [
    '你是 PaperQuay 文库 Agent 的能力路由器。判断用户指令是否需要进入以下任一能力流水线：',
    ...lines,
    '',
    '规则：',
    '- 文库整理任务（重命名、标签、分类、元数据补全等批量整理）必须返回 null；',
    '- 普通问答、单篇阅读、可以用工具直接完成的请求必须返回 null；',
    '- 拿不准时返回 null；',
    '- 只输出一个 JSON 对象，不要输出任何其他内容：{"capabilityId": string | null, "confidence": 0 到 1 的数字}。',
  ].join('\n');
}

/**
 * 解析分类器输出：提取第一个 JSON 对象，校验形状。
 * capabilityId 必须是已注册的能力 id 或 null；confidence 必须是有限数字（截断到 [0,1]）。
 * 解析失败返回 null。
 */
export function parseCapabilityClassifierOutput(raw: string): CapabilityClassifierResult | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const candidate = fenced ? fenced[1] : raw.trim();

  if (!candidate.trim()) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const rawId = record.capabilityId;
  const rawConfidence = record.confidence;

  let capabilityId: AgentCapabilityId | null = null;
  if (rawId !== null && rawId !== undefined && rawId !== '') {
    if (typeof rawId !== 'string' || !getAgentCapability(rawId)) {
      return null;
    }
    capabilityId = rawId as AgentCapabilityId;
  }

  if (typeof rawConfidence !== 'number' || !Number.isFinite(rawConfidence)) {
    return null;
  }

  return {
    capabilityId,
    confidence: Math.min(1, Math.max(0, rawConfidence)),
  };
}

function abortError(): Error {
  const error = new Error('Agent capability classifier aborted');
  error.name = 'AbortError';
  return error;
}

/**
 * 调用轻量分类器。
 * 返回 null 的语义：调用方按「无分类结果」处理（回退 ReAct）。
 * 未配置 callModel、超时、报错、解析失败都会先 emit capability_route_failed 再返回 null；
 * 父信号取消则抛 AbortError（走正常的运行取消路径）。
 */
export async function classifyAgentCapabilityRoute(input: {
  instruction: string;
  callModel?: CapabilityClassifierCallModel;
  signal?: AbortSignal;
  timeoutMs?: number;
  onEvent?: (event: AgentCapabilityClassifierEvent) => void;
}): Promise<CapabilityClassifierResult | null> {
  const fail = (reason: string): null => {
    input.onEvent?.({ kind: 'capability_route_failed', reason });
    return null;
  };

  const instruction = input.instruction.trim();
  if (instruction.length < CAPABILITY_CLASSIFIER_MIN_INSTRUCTION_CHARS) {
    // 短指令不满足分类条件，是路由规则而非分类失败，不记失败事件。
    return null;
  }

  if (!input.callModel) {
    return fail('capability classifier is not configured');
  }

  const timeoutMs = Math.max(1000, Math.trunc(input.timeoutMs ?? CAPABILITY_CLASSIFIER_TIMEOUT_MS));
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  input.signal?.addEventListener('abort', onParentAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    // Promise.race 双保险：即便 callModel 不响应 abort 信号，超时也必须返回。
    const response = await Promise.race([
      input.callModel({
        system: buildCapabilityClassifierSystemPrompt(),
        user: instruction,
        signal: controller.signal,
      }),
      new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener(
          'abort',
          () => reject(new Error(timedOut ? 'capability classifier timed out' : 'capability classifier aborted')),
          { once: true },
        );
      }),
    ]);

    const parsed = parseCapabilityClassifierOutput(response?.content ?? '');
    if (!parsed) {
      return fail('capability classifier output parse failed');
    }

    return parsed;
  } catch (error) {
    if (input.signal?.aborted) {
      throw abortError();
    }
    return fail(
      timedOut
        ? `capability classifier timed out after ${timeoutMs}ms`
        : `capability classifier failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', onParentAbort);
  }
}
