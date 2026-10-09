import { normalizeAgentCitationTokens, type AgentCitationBinding } from '../../services/agentAnswerEvidence.ts';
import type { LibraryAgentRagCitation } from '../../services/libraryAgent';

export function citationBindingReason(binding?: AgentCitationBinding): string {
  switch (binding?.reason) {
    case 'supported': return '该句已通过片段证据核验';
    case 'explicit-metadata-mismatch': return '正文题名或页码与来源不一致，未提供跳转';
    case 'semantic-contradiction': return '该引用与此句冲突，未提供跳转';
    case 'insufficient-snippet': return '片段不足以支撑完整主张，未提供跳转';
    case 'no-token-in-registry': return '本轮不存在该来源，未提供跳转';
    case 'ambiguous-token': return '来源身份存在歧义，未提供跳转';
    case 'duplicate-token': return '同句重复引用，未提供跳转';
    case 'legacy-citation': return '未验证的历史或数字引用，未提供跳转';
    case 'malformed-token': return '引用格式不完整，未提供跳转';
    default: return '证据核验未完成，未提供跳转';
  }
}

export function resolveAgentCitationBindings(content: string, citations: LibraryAgentRagCitation[] = [], bindings?: AgentCitationBinding[]) {
  return normalizeAgentCitationTokens(content, citations).map((occurrence) => {
    const matches = bindings?.filter((b) => b.start === occurrence.start && b.end === occurrence.end &&
      b.rawToken === occurrence.rawToken && b.tokenId === occurrence.tokenId && b.citationId === occurrence.citationId &&
      b.sentenceIndex === occurrence.sentenceIndex && b.sentenceText === occurrence.sentenceText) ?? [];
    // A persisted success cannot bypass a newly discovered identity/metadata conflict.
    const binding = matches.length === 1 && occurrence.reason === 'verifier-unavailable' ? matches[0] : occurrence;
    const citation = citations.find((c) => c.id === binding.citationId);
    return { binding, citation };
  });
}

export function usedVerifiedAgentCitations(content: string, citations: LibraryAgentRagCitation[] = [], bindings?: AgentCitationBinding[]) {
  const ids = new Set(resolveAgentCitationBindings(content, citations, bindings)
    .filter(({ binding }) => binding.status === 'verified').map(({ binding }) => binding.citationId));
  return citations.filter((c) => ids.has(c.id));
}

export function injectAgentCitationBindings(content: string, citations: LibraryAgentRagCitation[] = [], bindings?: AgentCitationBinding[]) {
  const resolved = resolveAgentCitationBindings(content, citations, bindings);
  const hrefPrefix = `#agent-binding-${crypto.randomUUID()}-`;
  let result = '';
  let previous = 0;
  // Reserve this URL namespace so model-written Markdown cannot forge a verified occurrence.
  const sanitize = (text: string) => text.replace(/#agent-(?:binding|cite)-/gi, '#agent-untrusted-');
  resolved.forEach(({ binding, citation }, index) => {
    result += sanitize(content.slice(previous, binding.start));
    const label = citation?.label ?? (binding.verifier === 'legacy' ? binding.rawToken.replace(/[\[\]]/g, '') : '?');
    result += `[${label}](${hrefPrefix}${index})`;
    previous = binding.end;
  });
  return { content: result + sanitize(content.slice(previous)), resolved, hrefPrefix };
}
