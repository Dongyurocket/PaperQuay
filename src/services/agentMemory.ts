import { invoke } from '../platform/electron/core';

export type AgentMemoryFile = 'trace' | 'topics' | 'synthesis';

export interface AgentMemoryFileRecord {
  file: AgentMemoryFile;
  date: string | null;
  content: string;
  exists: boolean;
  size: number;
  modifiedAt: number | null;
}

export interface AgentMemoryFileInfo extends Omit<AgentMemoryFileRecord, 'content'> {}

export interface AgentMemoryWritePlan {
  id: string;
  file: Exclude<AgentMemoryFile, 'trace'>;
  content: string;
  summary: string;
  createdAt: number;
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

export async function listAgentMemory(date?: string): Promise<AgentMemoryFileInfo[]> {
  try {
    return await invoke<AgentMemoryFileInfo[]>('agent_memory_list', {
      request: date ? { date } : {},
    });
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取 Agent 记忆目录失败'));
  }
}

export async function readAgentMemory(
  file: AgentMemoryFile,
  date?: string,
): Promise<AgentMemoryFileRecord> {
  try {
    return await invoke<AgentMemoryFileRecord>('agent_memory_read', {
      request: { file, ...(date ? { date } : {}) },
    });
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取 Agent 记忆失败'));
  }
}

export async function writeAgentMemory(
  file: AgentMemoryFile,
  content: string,
  date?: string,
): Promise<AgentMemoryFileRecord> {
  try {
    return await invoke<AgentMemoryFileRecord>('agent_memory_write', {
      request: { file, content, ...(date ? { date } : {}) },
    });
  } catch (error) {
    throw new Error(toErrorMessage(error, '写入 Agent 记忆失败'));
  }
}

export async function clearAgentMemory(
  file: AgentMemoryFile,
  date?: string,
): Promise<AgentMemoryFileRecord> {
  try {
    return await invoke<AgentMemoryFileRecord>('agent_memory_clear', {
      request: { file, ...(date ? { date } : {}) },
    });
  } catch (error) {
    throw new Error(toErrorMessage(error, '清空 Agent 记忆失败'));
  }
}

export function createAgentMemoryWritePlan(input: {
  file: Exclude<AgentMemoryFile, 'trace'>;
  content: string;
  summary?: string;
}): AgentMemoryWritePlan {
  return {
    id: `agent-memory:${input.file}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    file: input.file,
    content: input.content.slice(0, 200_000),
    summary: input.summary?.trim() || `Update ${input.file} memory.`,
    createdAt: Date.now(),
  };
}
