import { bindAgentCitationSources, type AgentCitationBinding } from '../../services/agentAnswerEvidence.ts';
import type { LibraryAgentRagCitation } from '../../services/libraryAgent';

export interface AgentAnswerReference {
  number: number;
  citationId: string;
  citation: LibraryAgentRagCitation;
  firstReferenceOffset: number;
}

export interface AgentAnswerCitationOccurrence {
  binding: AgentCitationBinding;
  sourceResolved: boolean;
  citation?: LibraryAgentRagCitation;
  referenceNumber?: number;
}

export interface AgentAnswerReferenceModel {
  occurrences: AgentAnswerCitationOccurrence[];
  references: AgentAnswerReference[];
}

export type AgentCitationClick = (citation: LibraryAgentRagCitation, referenceNumber?: number) => void;

export function citationOccurrenceLabel({ binding, referenceNumber }: Pick<AgentAnswerCitationOccurrence, 'binding' | 'referenceNumber'>): string {
  if (referenceNumber != null) return String(referenceNumber);
  if (binding.reason === 'legacy-citation') return `${binding.rawToken.replace(/[\[\]]/g, '')} · 未验证`;
  if (binding.status === 'rejected') return '引用未通过';
  return binding.reason === 'malformed-token' ? '引用未完成' : '来源不可用';
}

export function citationBindingReason(binding?: AgentCitationBinding): string {
  switch (binding?.reason) {
    case 'supported': return '该句已通过片段证据核验';
    case 'source-resolved': return '来源已定位，内容尚未检查';
    case 'explicit-metadata-mismatch': return '内容检查提示正文题名或页码与来源记录不一致';
    case 'semantic-contradiction': return '内容检查提示该片段与此句冲突';
    case 'insufficient-snippet': return '内容检查提示片段不足以支撑完整主张';
    case 'no-token-in-registry': return '本轮不存在该来源，未提供跳转';
    case 'ambiguous-token': return '来源身份存在歧义，未提供跳转';
    case 'duplicate-token': return '同句重复引用，未提供跳转';
    case 'legacy-citation': return '未验证的历史或数字引用，未提供跳转';
    case 'malformed-token': return '引用格式不完整，未提供跳转';
    default: return '内容检查未完成或暂不可用';
  }
}

export function resolveAgentCitationBindings(content: string, citations: LibraryAgentRagCitation[] = [], bindings?: AgentCitationBinding[]) {
  return bindAgentCitationSources(content, citations).map((occurrence) => {
    const matches = bindings?.filter((b) => b.start === occurrence.start && b.end === occurrence.end &&
      b.rawToken === occurrence.rawToken && b.tokenId === occurrence.tokenId && b.citationId === occurrence.citationId &&
      b.sentenceIndex === occurrence.sentenceIndex && b.sentenceText === occurrence.sentenceText) ?? [];
    const sourceResolved = occurrence.reason === 'source-resolved';
    // Saved content assessments cannot authorize sources that fail fresh identity checks.
    const binding = matches.length === 1 && sourceResolved ? matches[0] : occurrence;
    const citation = sourceResolved ? citations.find((c) => c.id === occurrence.citationId) : undefined;
    return { binding, citation, sourceResolved };
  });
}

export function usedResolvedAgentCitations(content: string, citations: LibraryAgentRagCitation[] = [], bindings?: AgentCitationBinding[]) {
  return buildAgentAnswerReferences(content, citations, bindings).references.map((reference) => reference.citation);
}

export function buildAgentAnswerReferences(content: string, citations: LibraryAgentRagCitation[] = [], bindings?: AgentCitationBinding[]): AgentAnswerReferenceModel {
  const references: AgentAnswerReference[] = [];
  const byId = new Map<string, AgentAnswerReference>();
  const occurrences = resolveAgentCitationBindings(content, citations, bindings)
    .sort((a, b) => a.binding.start - b.binding.start)
    .map(({ binding, citation, sourceResolved }): AgentAnswerCitationOccurrence => {
      if (!sourceResolved || !citation) return { binding, citation, sourceResolved };
      let reference = byId.get(citation.id);
      if (!reference) {
        reference = { number: references.length + 1, citationId: citation.id, citation, firstReferenceOffset: binding.start };
        byId.set(citation.id, reference);
        references.push(reference);
      }
      return { binding, citation, sourceResolved, referenceNumber: reference.number };
    });
  return { occurrences, references };
}

export function injectAgentCitationBindings(content: string, citations: LibraryAgentRagCitation[] = [], bindings?: AgentCitationBinding[], model?: AgentAnswerReferenceModel) {
  const resolved = (model ?? buildAgentAnswerReferences(content, citations, bindings)).occurrences;
  const hrefPrefix = `#agent-binding-${crypto.randomUUID()}-`;
  let result = '';
  let previous = 0;
  // Reserve this URL namespace so model-written Markdown cannot forge a resolved occurrence.
  const sanitize = (text: string) => text.replace(/#agent-(?:binding|cite)-/gi, '#agent-untrusted-')
    .replace(/\[\[(?:c|ci|cit|cite)?$/g, '[引用未完成]');
  resolved.forEach((occurrence, index) => {
    const { binding } = occurrence;
    result += sanitize(content.slice(previous, binding.start));
    const label = citationOccurrenceLabel(occurrence);
    result += `[${label}](${hrefPrefix}${index})`;
    previous = binding.end;
  });
  return { content: result + sanitize(content.slice(previous)), resolved, hrefPrefix };
}
