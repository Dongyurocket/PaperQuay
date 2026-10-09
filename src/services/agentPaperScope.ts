import type { LiteraturePaper } from '../types/library';

export type AgentPaperScopeMode = 'all-library' | 'selected' | 'empty';

export interface AgentPaperScopeError {
  code: 'paper_out_of_scope' | 'paper_not_found' | 'paper_scope_mixed' | 'empty_scope';
  paperIds: string[];
  allowedPaperIds: string[];
  /** Requested IDs that do not exist in the loaded library. */
  unknownPaperIds?: string[];
  /** Existing IDs that are not authorized by this run's scope. */
  outOfScopePaperIds?: string[];
  message: string;
}

export interface AgentPaperScope {
  mode: AgentPaperScopeMode;
  ids: string[];
  /** Explicit IDs that were supplied but are no longer in the loaded library. */
  unavailableIds: string[];
  papers: LiteraturePaper[];
  paperById: Map<string, LiteraturePaper>;
  explicit: boolean;
}

function normalizeIds(ids: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawId of ids) {
    const id = typeof rawId === 'string' ? rawId.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }

  return normalized;
}

export function resolveAgentPaperScope(
  papers: LiteraturePaper[],
  currentPaperScopeIds?: string[],
): AgentPaperScope {
  const paperById = new Map(papers.map((paper) => [paper.id, paper]));
  const explicit = Array.isArray(currentPaperScopeIds);
  const requestedIds = explicit ? normalizeIds(currentPaperScopeIds ?? []) : [];
  const ids = explicit
    ? requestedIds.filter((id) => paperById.has(id))
    : papers.map((paper) => paper.id);
  const scopedPapers = ids.map((id) => paperById.get(id)).filter((paper): paper is LiteraturePaper => Boolean(paper));

  return {
    mode: !explicit ? 'all-library' : ids.length > 0 ? 'selected' : 'empty',
    ids,
    unavailableIds: requestedIds.filter((id) => !paperById.has(id)),
    papers: scopedPapers,
    paperById,
    explicit,
  };
}

export function resolveAgentPaperIds(
  scope: AgentPaperScope,
  requestedPaperIds: string[] | undefined,
): { ids: string[]; error?: AgentPaperScopeError } {
  const requested = normalizeIds(requestedPaperIds ?? []);

  if (requested.length === 0) {
    if (scope.ids.length === 0) {
      return {
        ids: [],
        error: {
          code: 'empty_scope',
          paperIds: [],
          allowedPaperIds: [],
          message: 'No papers are authorized in the current Agent scope.',
        },
      };
    }

    return { ids: [...scope.ids] };
  }

  const outOfScope = requested.filter((id) => !scope.paperById.has(id) || !scope.ids.includes(id));
  if (outOfScope.length > 0) {
    const unknown = outOfScope.filter((id) => !scope.paperById.has(id));
    const outOfScopeOnly = outOfScope.filter((id) => scope.paperById.has(id));
    const code = unknown.length > 0 && outOfScopeOnly.length > 0
      ? 'paper_scope_mixed'
      : unknown.length > 0 ? 'paper_not_found' : 'paper_out_of_scope';
    return {
      ids: [],
      error: {
        code,
        paperIds: outOfScope,
        allowedPaperIds: [...scope.ids],
        ...(unknown.length > 0 ? { unknownPaperIds: unknown } : {}),
        ...(outOfScopeOnly.length > 0 ? { outOfScopePaperIds: outOfScopeOnly } : {}),
        message: code === 'paper_not_found'
          ? `Requested paper IDs are not available in the current library: ${unknown.join(', ')}`
          : code === 'paper_out_of_scope'
            ? `Requested paper IDs are outside the current Agent scope: ${outOfScopeOnly.join(', ')}`
            : `Some requested paper IDs are unavailable or outside the current Agent scope (unknown: ${unknown.join(', ') || 'none'}; out of scope: ${outOfScopeOnly.join(', ') || 'none'}).`,
      },
    };
  }

  return { ids: requested };
}

export function emptyAgentPaperScopeError(scope: AgentPaperScope): AgentPaperScopeError | undefined {
  return scope.ids.length > 0
    ? undefined
    : {
      code: 'empty_scope',
      paperIds: [],
      allowedPaperIds: [],
      message: 'No papers are authorized in the current Agent scope.',
    };
}
