/**
 * RAG 索引失败的粗分类。
 *
 * 只用于 UI 文案与自动重试决策；原始错误仍完整保留在 rag_indexes.last_error。
 * 认证/余额错误不允许自动重试，避免把剩余文献全部刷成失败。
 */
export type RagIndexErrorKind =
  | 'auth'
  | 'billing'
  | 'rate-limit'
  | 'network'
  | 'incomplete-vectors'
  | 'excluded'
  | 'unknown';

export interface RagIndexErrorInfo {
  kind: RagIndexErrorKind;
  /** 自动重试是否有意义。 */
  retryable: boolean;
}

export function classifyRagIndexError(message: string | null | undefined): RagIndexErrorInfo {
  const text = String(message ?? '');

  if (/\bHTTP\s*40[13]\b/i.test(text) || /unauthorized|forbidden|invalid\s+api[\s_-]*key|api[\s_-]*key.*(?:invalid|missing|expired)/i.test(text)) {
    return { kind: 'auth', retryable: false };
  }

  if (/\bHTTP\s*402\b/i.test(text) || /insufficient|balance|billing|quota|credit/i.test(text)) {
    return { kind: 'billing', retryable: false };
  }

  if (/\bHTTP\s*429\b/i.test(text) || /rate[\s_-]*limit|too many requests/i.test(text)) {
    return { kind: 'rate-limit', retryable: true };
  }

  if (/timeout|timed out|ECONN|ENOTFOUND|EAI_AGAIN|fetch failed|network|socket/i.test(text)) {
    return { kind: 'network', retryable: true };
  }

  if (/incomplete\s+(?:vector|embedding)|embedding.*(?:length|count|dimension).*(?:mismatch|invalid|incomplete)/i.test(text)) {
    return { kind: 'incomplete-vectors', retryable: true };
  }

  if (/rag_index_excluded|excluded from (?:the )?local knowledge base/i.test(text)) {
    return { kind: 'excluded', retryable: false };
  }

  return { kind: 'unknown', retryable: true };
}

export function isRagAuthOrBillingError(message: string | null | undefined): boolean {
  const { kind } = classifyRagIndexError(message);
  return kind === 'auth' || kind === 'billing';
}

export function ragIndexErrorLabel(
  kind: RagIndexErrorKind,
  l: (zh: string, en: string) => string,
): string {
  return ({
    auth: l('认证失败', 'Authentication failed'),
    billing: l('余额或配额不足', 'Balance or quota exhausted'),
    'rate-limit': l('请求被限流', 'Rate limited'),
    network: l('网络错误', 'Network error'),
    'incomplete-vectors': l('向量数据不完整', 'Incomplete vectors'),
    excluded: l('已移出知识库', 'Excluded from the knowledge base'),
    unknown: l('未知错误', 'Unknown error'),
  })[kind];
}

export function ragIndexErrorHint(
  kind: RagIndexErrorKind,
  l: (zh: string, en: string) => string,
): string | null {
  return ({
    auth: l('请检查 Embedding API Key。', 'Check the embedding API key.'),
    billing: l('请检查 Embedding 服务余额或配额。', 'Check the embedding service balance or quota.'),
    'rate-limit': l('稍后会自动退避重试。', 'It will retry after a backoff.'),
    network: l('检查网络或服务地址后重试。', 'Check the network or service URL and retry.'),
    'incomplete-vectors': l('重试或重建该文献索引。', 'Retry or rebuild this paper’s index.'),
    excluded: l('先加入知识库再建立索引。', 'Include it in the knowledge base before indexing.'),
    unknown: null,
  })[kind];
}
