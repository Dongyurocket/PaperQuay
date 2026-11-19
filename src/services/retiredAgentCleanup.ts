const RETIRED_AGENT_HISTORY_KEY = 'paperquay-agent-history-v1';

/**
 * 首次升级清理独立 Agent 的本地会话与运行历史。
 * 只删除已退役的存储键；不映射到新流程，重复执行无副作用。
 */
export function cleanupRetiredAgentLocalState(): { removed: boolean; byteLength: number } {
  try {
    const raw = window.localStorage.getItem(RETIRED_AGENT_HISTORY_KEY);
    if (raw === null) return { removed: false, byteLength: 0 };
    window.localStorage.removeItem(RETIRED_AGENT_HISTORY_KEY);
    return { removed: true, byteLength: raw.length };
  } catch {
    return { removed: false, byteLength: 0 };
  }
}
