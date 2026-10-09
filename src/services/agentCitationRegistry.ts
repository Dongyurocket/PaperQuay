import type { LibraryAgentRagCitation } from './libraryAgent';

function normalizedLabel(label: string): string {
  return label.replace(/[\[\]]/g, '').trim();
}

export function formatCitationEvidenceToken(citation: { id: string }): string {
  return `[[cite:${citation.id}]]`;
}

/** Recover legacy tool evidence without widening the current authorized scope. */
export function recoverAgentToolCitations(
  content: string,
  paperById: ReadonlyMap<string, { title: string }>,
  allowedPaperIds: readonly string[],
): LibraryAgentRagCitation[] {
  const asRecord = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown> : null;
  let payload: Record<string, unknown> | null;
  try {
    payload = asRecord(JSON.parse(content));
    if (payload && 'result' in payload) {
      if (payload.isError === true) return [];
      payload = asRecord(typeof payload.result === 'string' ? JSON.parse(payload.result) : payload.result);
    }
  } catch { return []; }
  if (!payload) return [];

  const allowed = new Set(allowedPaperIds);
  const recovered: LibraryAgentRagCitation[] = [];
  const add = (value: unknown, contextPaperId?: string, chunk = false) => {
    const source = asRecord(value);
    if (!source) return;
    const id = chunk ? source.citationId : source.id;
    const paperId = source.paperId ?? contextPaperId;
    if (typeof id !== 'string' || !id.trim() || typeof paperId !== 'string' || !allowed.has(paperId)) return;
    const paper = paperById.get(paperId);
    if (!paper) return;
    if (source.sourceType !== 'pdf-text' && source.sourceType !== 'mineru-markdown') return;
    const page = chunk ? source.page : source.pageIndex;
    if (page != null && (typeof page !== 'number' || !Number.isInteger(page) || page < (chunk ? 1 : 0))) return;
    if (source.blockId != null && typeof source.blockId !== 'string') return;
    const previewText = chunk ? source.snippet : source.previewText;
    if (typeof previewText !== 'string' || !previewText.trim()) return;
    recovered.push({
      id, label: '', paperId, paperTitle: paper.title, sourceType: source.sourceType,
      pageIndex: page == null ? null : chunk ? (page as number) - 1 : page as number,
      blockId: source.blockId as string | null | undefined ?? null,
      previewText,
    });
  };
  if (Array.isArray(payload.papers)) {
    for (const value of payload.papers) {
      const context = asRecord(value);
      if (context && Array.isArray(context.citations)) {
        for (const citation of context.citations) add(citation, typeof context.paperId === 'string' ? context.paperId : undefined);
      }
    }
  }
  if (Array.isArray(payload.chunks)) for (const chunk of payload.chunks) add(chunk, undefined, true);
  return recovered;
}

/** A real document excerpt may be citable without inventing a page or block locator. */
export function createAgentDocumentExcerptCitation(input: {
  paperId: string;
  paperTitle: string;
  source: string;
  contextVersion: string;
  textStart: number;
  textEnd: number;
  text: string;
}): LibraryAgentRagCitation | null {
  if (!input.paperId || !input.contextVersion || !input.text.trim()
    || !/(?:pdf-text|mineru)/i.test(input.source) || /fallback|summary|metadata/i.test(input.source)) return null;
  const sourceType = /mineru/i.test(input.source) ? 'mineru-markdown' : 'pdf-text';
  return {
    id: `agent-context:${input.paperId}:${sourceType}:${input.contextVersion}:${input.textStart}:${input.textEnd}`,
    label: '',
    paperId: input.paperId,
    paperTitle: input.paperTitle,
    sourceType,
    pageIndex: null,
    blockId: null,
    previewText: input.text,
  };
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
