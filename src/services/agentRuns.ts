import { invoke } from '../platform/electron/core';

export type AgentRunStatus = 'running' | 'done' | 'error' | 'aborted';

export interface AgentRunRecord {
  runId: string;
  sessionId: string;
  startedAt: number;
  finishedAt: number | null;
  status: AgentRunStatus;
  model: string;
  presetId: string;
  instruction: string;
  promptTokens: number;
  completionTokens: number;
  turns: number;
}

export interface AgentRunEventRecord {
  id: number;
  runId: string;
  ts: number;
  kind: string;
  payload: Record<string, unknown>;
}

export interface AgentSessionUsage {
  sessionId: string;
  promptTokens: number;
  completionTokens: number;
  runCount: number;
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  return fallback;
}

export async function startAgentRun(input: {
  runId: string;
  sessionId: string;
  model?: string;
  presetId?: string;
  instruction?: string;
  startedAt?: number;
}): Promise<AgentRunRecord> {
  try {
    return await invoke<AgentRunRecord>('agent_run_start', { request: input });
  } catch (error) {
    throw new Error(toErrorMessage(error, '创建 Agent 运行记录失败'));
  }
}

export async function appendAgentRunEvent(input: {
  runId: string;
  kind: string;
  payload?: Record<string, unknown>;
  ts?: number;
  turn?: number;
  promptTokens?: number;
  completionTokens?: number;
}): Promise<AgentRunEventRecord> {
  try {
    return await invoke<AgentRunEventRecord>('agent_run_event_append', { request: input });
  } catch (error) {
    throw new Error(toErrorMessage(error, '追加 Agent 运行事件失败'));
  }
}

export async function finishAgentRun(input: {
  runId: string;
  status: Exclude<AgentRunStatus, 'running'>;
  finishedAt?: number;
  turns?: number;
  promptTokens?: number;
  completionTokens?: number;
}): Promise<AgentRunRecord> {
  try {
    return await invoke<AgentRunRecord>('agent_run_finish', { request: input });
  } catch (error) {
    throw new Error(toErrorMessage(error, '结束 Agent 运行记录失败'));
  }
}

export async function getAgentRunEvents(runId: string, afterId = 0): Promise<AgentRunEventRecord[]> {
  try {
    return await invoke<AgentRunEventRecord[]>('agent_run_events_get', {
      request: { runId, afterId },
    });
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取 Agent 运行事件失败'));
  }
}

export async function listInterruptedAgentRuns(sessionId?: string): Promise<AgentRunRecord[]> {
  try {
    return await invoke<AgentRunRecord[]>('agent_run_list_interrupted', {
      request: sessionId ? { sessionId } : {},
    });
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取可恢复的 Agent 运行失败'));
  }
}

export async function listAgentRunUsageBySession(sessionIds: string[]): Promise<AgentSessionUsage[]> {
  try {
    return await invoke<AgentSessionUsage[]>('agent_run_usage_by_session', {
      request: { sessionIds },
    });
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取 Agent token 用量失败'));
  }
}
