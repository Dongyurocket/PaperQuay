import type { LibraryAgentRagCitation } from './libraryAgent';

function normalizedLabel(label: string): string {
  return label.replace(/[\[\]]/g, '').trim();
}

export function formatCitationEvidenceToken(citation: { id: string }): string {
  return `[[cite:${citation.id}]]`;
}

export const AGENT_CITATION_PROTOCOL = 'For factual answer sentences, copy only exact [[cite:<id>]] tokens supplied with evidence in this run into the answer body. Never generate numeric [n] citations or invent tokens. Do not hand-write a references or bibliography appendix; the application generates an ordered fragment-level reference list from locally resolved body tokens. When recommending literature, identify each paper by its exact title and available year from supplied records, explain its specific relevance, and distinguish direct evidence from background or limitations. Do not substitute vague descriptions such as 一篇研究 for known titles. Never invent titles, years, authors, pages or blocks, or output raw paper_/category_ IDs. Metadata-only matches may be offered as candidates awaiting full-text evidence; never invent evidence tokens for them. If no evidence token supports a factual claim, say 当前库内没有查到支持该主张的正文证据. Label model inferences 我的推断 and never put them in excerpt or synthesis notes. Preserve tokens verbatim when summarizing or compressing context.';

/**
 * Maintains one canonical citation list for a single Agent run. Labels are
 * assigned once, in discovery order, and never reused by a later tool result.
 */
export class AgentCitationRegistry {
  private readonly byId = new Map<string, LibraryAgentRagCitation>();
  private readonly citations: LibraryAgentRagCitation[];

  constructor(citations: LibraryAgentRagCitation[]) {
    this.citations = citations;
    const initial = [...citations];
    citations.splice(0, citations.length);
    this.register(initial);
  }

  register(next: LibraryAgentRagCitation[] | undefined): LibraryAgentRagCitation[] {
    const registered: LibraryAgentRagCitation[] = [];

    for (const citation of next ?? []) {
      const known = this.byId.get(citation.id);
      if (known) {
        registered.push(known);
        continue;
      }

      const canonical = {
        ...citation,
        label: String(this.citations.length + 1),
      };
      this.citations.push(canonical);
      this.byId.set(canonical.id, canonical);
      registered.push(canonical);
    }

    return registered;
  }
}

/**
 * Rewrites only the source headers injected into the model context. Free-form
 * answer prose is intentionally left unchanged and is validated separately.
 */
export function rewriteAgentCitationSourceLabels(
  text: string,
  source: LibraryAgentRagCitation[] | undefined,
  canonical: LibraryAgentRagCitation[],
): string {
  if (!text || !source?.length || source.length !== canonical.length) {
    return text.replace(/# Source \[(?!\[)[^\]\n]+\]/g, '# Source (unavailable evidence)');
  }

  const labels = new Map<string, string>();
  const duplicateSourceLabels = new Set<string>();

  source.forEach((citation, index) => {
    const from = normalizedLabel(citation.label);
    const to = canonical[index] ? formatCitationEvidenceToken(canonical[index]) : undefined;
    if (!from || !to) return;
    if (labels.has(from)) duplicateSourceLabels.add(from);
    labels.set(from, to);
  });

  return text.replace(/# Source \[(?!\[)([^\]\n]+)\]/g, (_match, rawLabel: string) => {
    const label = normalizedLabel(rawLabel);
    if (!label || duplicateSourceLabels.has(label)) return '# Source (unavailable evidence)';
    const nextLabel = labels.get(label);
    return nextLabel ? `# Source ${nextLabel}` : '# Source (unavailable evidence)';
  });
}

/** Returns a citation only when a numeric label identifies exactly one record. */
export function findUniqueAgentCitationByLabel(
  citations: LibraryAgentRagCitation[] | undefined,
  label: string,
): LibraryAgentRagCitation | null {
  const normalized = normalizedLabel(label);
  if (!normalized || !citations?.length) return null;

  const matches = citations.filter((citation) => normalizedLabel(citation.label) === normalized);
  return matches.length === 1 ? matches[0] : null;
}
