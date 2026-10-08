export function normalizeAgentChatErrorMessage(message: string, fallback: string): string {
  const cleaned = message
    .replace(/^Error invoking remote method 'paperquay:invoke':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim();

  if (/AGENT_MODEL_ABORTED/i.test(cleaned)) {
    return '已取消模型请求。';
  }

  if (/AGENT_MODEL_TIMEOUT|ETIMEDOUT/i.test(cleaned)) {
    return '连接模型服务超时。请检查 Base URL、网络或代理设置后重试。';
  }

  if (/AGENT_MODEL_NETWORK_ERROR|fetch failed|ECONNREFUSED|ENOTFOUND|ECONNRESET|network/i.test(cleaned)) {
    return '无法连接模型服务。请检查模型 Base URL、API Key、网络连接或代理设置，然后重试。';
  }

  return cleaned || fallback;
}
