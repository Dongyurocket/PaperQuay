/**
 * A small, serializable ledger for multi-paper research runs.
 *
 * The ledger deliberately keeps discovery, retrieval, focused reading and
 * citation as separate facts. A slice hit therefore cannot be mistaken for a
 * full-text read, and an unfinished/failed paper remains visible when a run
 * is resumed.
 */

export const SURVEY_COVERAGE_VERSION = 1 as const;

export type SurveyPaperTerminalState = 'reviewed' | 'cited' | 'irrelevant' | 'unresolved' | 'failed';
export type SurveyPaperRetrievalOutcome = 'hit' | 'empty' | 'failed' | 'unavailable';
export type SurveyPaperUnresolvedReason = 'no-document' | 'unreadable-document' | 'no-hit' | 'no-citable-evidence';
export type SurveyPaperStage = 'abstract-reviewed' | 'body-searched' | 'focused-read' | 'cited';
export type SurveySubquestionState = 'pending' | 'in-progress' | 'completed' | 'partial' | 'failed';
export type SurveyCoverageRunState = 'pending' | 'running' | 'completed' | 'partial' | 'cancelled' | 'failed';
export type SurveyCoverageStopReason =
  | 'completed'
  | 'budget-time'
  | 'budget-tokens'
  | 'budget-papers'
  | 'budget-subquestions'
  | 'cancelled'
  | 'error'
  | 'unknown';

export interface SurveyCoverageBudget {
  maxPapers?: number;
  maxSubquestions?: number;
  maxTokens?: number;
  maxMilliseconds?: number;
  promptTokens: number;
  completionTokens: number;
  elapsedMilliseconds: number;
  /** Per-execution allowance; cumulative measured usage above survives continuation. */
  execution?: {
    processedPaperIds: string[];
    completedSubquestionIds: string[];
    promptTokenBaseline: number;
    completionTokenBaseline: number;
    elapsedBaseline: number;
  };
}

export interface SurveyPaperCoverage {
  paperId: string;
  paperTitle?: string;
  candidate: true;
  abstractReviewed: boolean;
  bodySearched: boolean;
  focusedRead: boolean;
  cited: boolean;
  /** Empty hit is represented explicitly and is not the same as a request failure. */
  unresolved: boolean;
  irrelevant: boolean;
  failed: boolean;
  retrievalOutcome?: SurveyPaperRetrievalOutcome;
  unresolvedReason?: SurveyPaperUnresolvedReason;
  attempts: number;
  citationIds: string[];
  subquestionIds: string[];
  error?: string;
  updatedAt?: number;
}

export interface SurveySubquestionCoverage {
  id: string;
  question: string;
  state: SurveySubquestionState;
  candidatePaperIds: string[];
  evidenceCitationIds: string[];
  /** Missing or weak evidence is recorded as a gap instead of being inferred away. */
  evidenceGaps: string[];
  completedPaperIds: string[];
  failedPaperIds: string[];
  updatedAt?: number;
}

export interface SurveyCoverageLedger {
  version: typeof SURVEY_COVERAGE_VERSION;
  runState: SurveyCoverageRunState;
  stopReason?: SurveyCoverageStopReason;
  papers: SurveyPaperCoverage[];
  subquestions: SurveySubquestionCoverage[];
  budget: SurveyCoverageBudget;
  updatedAt: number;
}

/** Only unsynthesized, model-visible excerpts need to survive a batch interruption. */
export interface SurveyResearchContext {
  paperId: string;
  subquestionId: string;
  source: string;
  text: string;
  citationIds: string[];
}

export function normalizeSurveyResearchContexts(value: unknown): SurveyResearchContext[] {
  if (!Array.isArray(value)) return [];
  const records = new Map<string, SurveyResearchContext>();
  for (const record of value) {
    if (!record || typeof record !== 'object') continue;
    const input = record as Partial<SurveyResearchContext>;
    const paperId = cleanId(input.paperId);
    const subquestionId = cleanId(input.subquestionId);
    const source = cleanText(input.source);
    if (!paperId || !subquestionId || !source || typeof input.text !== 'string') continue;
    records.set(`${subquestionId}:${paperId}`, {
      paperId, subquestionId, source, text: input.text, citationIds: uniqueStrings(input.citationIds),
    });
  }
  return [...records.values()];
}

export interface SurveyCoveragePaperInput {
  id: string;
  title?: string;
}

export interface SurveyCoverageSubquestionInput {
  id?: string;
  question: string;
  candidatePaperIds?: string[];
}

export interface SurveyCoverageSummary {
  runState: SurveyCoverageRunState;
  stopReason?: SurveyCoverageStopReason;
  candidateCount: number;
  abstractReviewedCount: number;
  bodySearchedCount: number;
  focusedReadCount: number;
  citedCount: number;
  irrelevantCount: number;
  unresolvedCount: number;
  failedCount: number;
  emptyHitCount: number;
  unreadableCount: number;
  retrievalFailedCount: number;
  pendingCount: number;
  abstractCoverage: number;
  bodySearchCoverage: number;
  focusedReadCoverage: number;
  citationCoverage: number;
  subquestionCount: number;
  completedSubquestionCount: number;
  partialSubquestionCount: number;
  failedSubquestionCount: number;
  pendingSubquestionCount: number;
  evidenceGaps: string[];
  budgetExhausted: boolean;
  canResume: boolean;
}

export type SurveyCoveragePaperPatch = Partial<Pick<
  SurveyPaperCoverage,
  'paperTitle' | 'abstractReviewed' | 'bodySearched' | 'focusedRead' | 'cited'
    | 'unresolved' | 'irrelevant' | 'failed' | 'error' | 'retrievalOutcome' | 'unresolvedReason'
>> & {
  stage?: SurveyPaperStage;
  citationIds?: string[];
  subquestionIds?: string[];
  attempts?: number;
  timestamp?: number;
};

export interface SurveyCoverageBudgetUpdate {
  promptTokens?: number;
  completionTokens?: number;
  elapsedMilliseconds?: number;
}

function cleanId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values: unknown): string[] {
  return [...new Set((Array.isArray(values) ? values : []).map(cleanId).filter(Boolean))];
}

function finiteNonNegative(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function positiveLimit(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : undefined;
}

function now(): number {
  return Date.now();
}

function ratio(value: number, total: number): number {
  return total > 0 ? Number((value / total).toFixed(4)) : 0;
}

function paperState(paper: SurveyPaperCoverage): SurveyPaperTerminalState | 'pending' | 'in-progress' {
  if (paper.failed) return 'failed';
  if (paper.unresolved) return 'unresolved';
  if (paper.irrelevant) return 'irrelevant';
  if (paper.cited) return 'cited';
  if (paper.focusedRead) return 'reviewed';
  if (paper.attempts > 0) return 'in-progress';
  return 'pending';
}

function createPaper(input: SurveyCoveragePaperInput): SurveyPaperCoverage {
  const paperId = cleanId(input.id);
  if (!paperId) throw new Error('Survey coverage requires a paper id.');
  return {
    paperId,
    paperTitle: cleanText(input.title) || undefined,
    candidate: true,
    abstractReviewed: false,
    bodySearched: false,
    focusedRead: false,
    cited: false,
    unresolved: false,
    irrelevant: false,
    failed: false,
    attempts: 0,
    citationIds: [],
    subquestionIds: [],
  };
}

function createSubquestion(input: SurveyCoverageSubquestionInput, index: number): SurveySubquestionCoverage {
  const question = cleanText(input.question);
  if (!question) throw new Error('Survey coverage requires a subquestion.');
  return {
    id: cleanId(input.id) || `subquestion-${index + 1}`,
    question,
    state: 'pending',
    candidatePaperIds: uniqueStrings(input.candidatePaperIds),
    evidenceCitationIds: [],
    evidenceGaps: [],
    completedPaperIds: [],
    failedPaperIds: [],
  };
}

export function createSurveyCoverageLedger(input: {
  papers: readonly SurveyCoveragePaperInput[];
  subquestions?: readonly SurveyCoverageSubquestionInput[];
  budget?: Partial<SurveyCoverageBudget>;
  now?: number;
}): SurveyCoverageLedger {
  const papers: SurveyPaperCoverage[] = [];
  const seen = new Set<string>();
  for (const item of input.papers) {
    const paper = createPaper(item);
    if (seen.has(paper.paperId)) continue;
    seen.add(paper.paperId);
    papers.push(paper);
  }
  const subquestions = (input.subquestions ?? []).map((item, index) => createSubquestion(item, index));
  return {
    version: SURVEY_COVERAGE_VERSION,
    runState: 'pending',
    papers,
    subquestions,
    budget: {
      maxPapers: positiveLimit(input.budget?.maxPapers),
      maxSubquestions: positiveLimit(input.budget?.maxSubquestions),
      maxTokens: positiveLimit(input.budget?.maxTokens),
      maxMilliseconds: positiveLimit(input.budget?.maxMilliseconds),
      promptTokens: finiteNonNegative(input.budget?.promptTokens),
      completionTokens: finiteNonNegative(input.budget?.completionTokens),
      elapsedMilliseconds: finiteNonNegative(input.budget?.elapsedMilliseconds),
      execution: {
        processedPaperIds: [],
        completedSubquestionIds: [],
        promptTokenBaseline: finiteNonNegative(input.budget?.promptTokens),
        completionTokenBaseline: finiteNonNegative(input.budget?.completionTokens),
        elapsedBaseline: finiteNonNegative(input.budget?.elapsedMilliseconds),
      },
    },
    updatedAt: input.now ?? now(),
  };
}

/** Add papers discovered after a checkpoint without changing recorded facts. */
export function ensureSurveyCoveragePapers(
  ledger: SurveyCoverageLedger,
  papers: readonly SurveyCoveragePaperInput[],
): SurveyCoverageLedger {
  const known = new Set(ledger.papers.map((paper) => paper.paperId));
  const additions: SurveyPaperCoverage[] = [];
  for (const input of papers) {
    const paper = createPaper(input);
    if (known.has(paper.paperId)) continue;
    known.add(paper.paperId);
    additions.push(paper);
  }
  return additions.length === 0
    ? ledger
    : { ...ledger, papers: [...ledger.papers, ...additions], updatedAt: now() };
}

/** Add or reconcile subquestions after resume while preserving their state. */
export function ensureSurveyCoverageSubquestions(
  ledger: SurveyCoverageLedger,
  subquestions: readonly SurveyCoverageSubquestionInput[],
): SurveyCoverageLedger {
  const next = ledger.subquestions.map((item) => ({
    ...item,
    candidatePaperIds: [...item.candidatePaperIds],
    evidenceCitationIds: [...item.evidenceCitationIds],
    evidenceGaps: [...item.evidenceGaps],
    completedPaperIds: [...item.completedPaperIds],
    failedPaperIds: [...item.failedPaperIds],
  }));
  let changed = false;
  subquestions.forEach((input, index) => {
    const question = cleanText(input.question);
    if (!question) return;
    const desiredId = cleanId(input.id) || `subquestion-${index + 1}`;
    const existingIndex = next.findIndex((item) => item.id === desiredId || item.question === question);
    if (existingIndex < 0) {
      next.push(createSubquestion(input, index));
      changed = true;
      return;
    }
    const existing = next[existingIndex];
    const candidatePaperIds = uniqueStrings([
      ...existing.candidatePaperIds,
      ...(input.candidatePaperIds ?? []),
    ]);
    if (candidatePaperIds.length !== existing.candidatePaperIds.length) {
      next[existingIndex] = { ...existing, candidatePaperIds };
      changed = true;
    }
  });
  return changed ? { ...ledger, subquestions: next, updatedAt: now() } : ledger;
}

export function updateSurveyCoveragePaper(
  ledger: SurveyCoverageLedger,
  paperIdInput: string,
  patch: SurveyCoveragePaperPatch,
): SurveyCoverageLedger {
  const paperId = cleanId(paperIdInput);
  if (!paperId) return ledger;
  const timestamp = patch.timestamp ?? now();
  const papers = ledger.papers.map((paper) => {
    if (paper.paperId !== paperId) return paper;
    const next: SurveyPaperCoverage = {
      ...paper,
      paperTitle: patch.paperTitle === undefined ? paper.paperTitle : cleanText(patch.paperTitle) || undefined,
      abstractReviewed: patch.abstractReviewed ?? paper.abstractReviewed,
      bodySearched: patch.bodySearched ?? paper.bodySearched,
      focusedRead: patch.focusedRead ?? paper.focusedRead,
      cited: patch.cited ?? paper.cited,
      unresolved: patch.unresolved ?? paper.unresolved,
      irrelevant: patch.irrelevant ?? paper.irrelevant,
      failed: patch.failed ?? paper.failed,
      retrievalOutcome: patch.retrievalOutcome ?? paper.retrievalOutcome,
      unresolvedReason: patch.unresolved === false ? undefined : patch.unresolvedReason ?? paper.unresolvedReason,
      error: patch.error === undefined ? paper.error : cleanText(patch.error) || undefined,
      attempts: patch.attempts === undefined ? paper.attempts : finiteNonNegative(patch.attempts),
      citationIds: patch.citationIds === undefined ? paper.citationIds : uniqueStrings(patch.citationIds),
      subquestionIds: patch.subquestionIds === undefined ? paper.subquestionIds : uniqueStrings(patch.subquestionIds),
      updatedAt: timestamp,
    };
    if (patch.stage === 'abstract-reviewed') next.abstractReviewed = true;
    if (patch.stage === 'body-searched') {
      next.abstractReviewed = true;
      next.bodySearched = true;
    }
    if (patch.stage === 'focused-read') {
      next.abstractReviewed = true;
      next.bodySearched = true;
      next.focusedRead = true;
    }
    if (patch.stage === 'cited') {
      next.abstractReviewed = true;
      next.bodySearched = true;
      next.cited = true;
    }
    return next;
  });
  const prior = ledger.papers.find((paper) => paper.paperId === paperId);
  const next = papers.find((paper) => paper.paperId === paperId);
  const execution = ledger.budget.execution;
  return {
    ...ledger,
    papers,
    budget: execution && prior && next && next.attempts > prior.attempts
      ? { ...ledger.budget, execution: { ...execution, processedPaperIds: uniqueStrings([...execution.processedPaperIds, paperId]) } }
      : ledger.budget,
    updatedAt: timestamp,
  };
}

/** Alias used by callers that record one retrieval/read event at a time. */
export const recordSurveyPaperCoverage = updateSurveyCoveragePaper;

export function updateSurveyCoverageSubquestion(
  ledger: SurveyCoverageLedger,
  subquestionIdInput: string,
  patch: Partial<Pick<SurveySubquestionCoverage, 'state' | 'candidatePaperIds' | 'evidenceCitationIds' | 'evidenceGaps' | 'completedPaperIds' | 'failedPaperIds'>> & { timestamp?: number },
): SurveyCoverageLedger {
  const subquestionId = cleanId(subquestionIdInput);
  if (!subquestionId) return ledger;
  const timestamp = patch.timestamp ?? now();
  const subquestions = ledger.subquestions.map((subquestion) => subquestion.id !== subquestionId
    ? subquestion
    : {
      ...subquestion,
      state: patch.state ?? subquestion.state,
      candidatePaperIds: patch.candidatePaperIds === undefined ? subquestion.candidatePaperIds : uniqueStrings(patch.candidatePaperIds),
      evidenceCitationIds: patch.evidenceCitationIds === undefined ? subquestion.evidenceCitationIds : uniqueStrings(patch.evidenceCitationIds),
      evidenceGaps: patch.evidenceGaps === undefined ? subquestion.evidenceGaps : uniqueStrings(patch.evidenceGaps),
      completedPaperIds: patch.completedPaperIds === undefined ? subquestion.completedPaperIds : uniqueStrings(patch.completedPaperIds),
      failedPaperIds: patch.failedPaperIds === undefined ? subquestion.failedPaperIds : uniqueStrings(patch.failedPaperIds),
      updatedAt: timestamp,
    });
  const execution = ledger.budget.execution;
  const completed = subquestions.some((item) => item.id === subquestionId &&
    (item.state === 'completed' || item.state === 'partial' || item.state === 'failed'));
  return {
    ...ledger,
    subquestions,
    budget: execution && completed
      ? { ...ledger.budget, execution: { ...execution, completedSubquestionIds: uniqueStrings([...execution.completedSubquestionIds, subquestionId]) } }
      : ledger.budget,
    updatedAt: timestamp,
  };
}

export const recordSurveySubquestionCoverage = updateSurveyCoverageSubquestion;

export function updateSurveyCoverageBudget(
  ledger: SurveyCoverageLedger,
  usage: SurveyCoverageBudgetUpdate,
  timestamp: number = now(),
): SurveyCoverageLedger {
  return {
    ...ledger,
    budget: {
      ...ledger.budget,
      promptTokens: ledger.budget.promptTokens + finiteNonNegative(usage.promptTokens),
      completionTokens: ledger.budget.completionTokens + finiteNonNegative(usage.completionTokens),
      elapsedMilliseconds: ledger.budget.elapsedMilliseconds + finiteNonNegative(usage.elapsedMilliseconds),
    },
    updatedAt: timestamp,
  };
}

export function isSurveyCoverageBudgetExhausted(ledger: SurveyCoverageLedger): boolean {
  return getSurveyCoverageBudgetStopReason(ledger) !== undefined;
}

/**
 * Return the first configured budget that stopped a run. The order is stable
 * so a checkpoint remains explainable when more than one limit is reached by
 * the same model response.
 */
export function getSurveyCoverageBudgetStopReason(
  ledger: SurveyCoverageLedger,
): Extract<SurveyCoverageStopReason, `budget-${string}`> | undefined {
  const budget = ledger.budget;
  const processedPapers = budget.execution?.processedPaperIds.length
    ?? ledger.papers.filter((paper) => paper.attempts > 0).length;
  const completedSubquestions = budget.execution?.completedSubquestionIds.length
    ?? ledger.subquestions.filter((subquestion) =>
      subquestion.state === 'completed' || subquestion.state === 'partial' || subquestion.state === 'failed').length;
  const tokens = budget.promptTokens + budget.completionTokens
    - (budget.execution?.promptTokenBaseline ?? 0) - (budget.execution?.completionTokenBaseline ?? 0);
  const elapsed = budget.elapsedMilliseconds - (budget.execution?.elapsedBaseline ?? 0);
  if (budget.maxPapers !== undefined && processedPapers >= budget.maxPapers) return 'budget-papers';
  if (budget.maxSubquestions !== undefined && completedSubquestions >= budget.maxSubquestions) return 'budget-subquestions';
  if (budget.maxTokens !== undefined && tokens >= budget.maxTokens) return 'budget-tokens';
  if (budget.maxMilliseconds !== undefined && elapsed >= budget.maxMilliseconds) return 'budget-time';
  return undefined;
}

/** An explicit continuation starts a new allowance without erasing measured total usage. */
export function resumeSurveyCoverageLedger(ledger: SurveyCoverageLedger): SurveyCoverageLedger {
  return {
    ...ledger,
    runState: 'running',
    stopReason: undefined,
    budget: {
      ...ledger.budget,
      execution: {
        processedPaperIds: [],
        completedSubquestionIds: [],
        promptTokenBaseline: ledger.budget.promptTokens,
        completionTokenBaseline: ledger.budget.completionTokens,
        elapsedBaseline: ledger.budget.elapsedMilliseconds,
      },
    },
    updatedAt: now(),
  };
}

/** Select only unfinished papers for a subquestion and reserve no more than the remaining allowance. */
export function selectSurveyCoverageBatch(
  ledger: SurveyCoverageLedger,
  paperIds: readonly string[],
  subquestionId: string,
  batchSize: number,
): string[] {
  if (getSurveyCoverageBudgetStopReason(ledger)) return [];
  const subquestion = ledger.subquestions.find((item) => item.id === subquestionId);
  const completed = new Set(subquestion?.completedPaperIds ?? []);
  const known = new Map(ledger.papers.map((paper) => [paper.paperId, paper]));
  const current = new Set(ledger.budget.execution?.processedPaperIds
    ?? ledger.papers.filter((paper) => paper.attempts > 0).map((paper) => paper.paperId));
  let remaining = ledger.budget.maxPapers === undefined ? Infinity : Math.max(0, ledger.budget.maxPapers - current.size);
  const selected: string[] = [];
  for (const paperId of uniqueStrings(paperIds)) {
    const paper = known.get(paperId);
    if (!paper || paper.irrelevant || (completed.has(paperId) && !paper.failed && !paper.unresolved)) continue;
    if (!current.has(paperId)) {
      if (remaining <= 0) continue;
      remaining -= 1;
    }
    selected.push(paperId);
    if (selected.length >= Math.max(1, Math.trunc(batchSize))) break;
  }
  return selected;
}

export type SurveyCoverageBatchResult<T> = { paperId: string; value: T } | { paperId: string; error: unknown };

/** Save every settled result before propagating cancellation, with no background callbacks after return. */
export async function processSurveyCoverageBatch<T>(input: {
  paperIds: readonly string[];
  signal?: AbortSignal;
  load: (paperId: string) => Promise<T>;
  onResult: (result: SurveyCoverageBatchResult<T>) => void | Promise<void>;
}): Promise<SurveyCoverageBatchResult<T>[]> {
  if (input.signal?.aborted) {
    const error = new Error('Comparative survey cancelled');
    error.name = 'AbortError';
    throw error;
  }
  const settled = await Promise.allSettled(input.paperIds.map(async (paperId) => {
    let result: SurveyCoverageBatchResult<T>;
    try {
      result = { paperId, value: await input.load(paperId) };
    } catch (error) {
      if (input.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
      result = { paperId, error };
    }
    await input.onResult(result);
    return result;
  }));
  const rejected = settled.find((item): item is PromiseRejectedResult => item.status === 'rejected');
  if (input.signal?.aborted) {
    const error = new Error('Comparative survey cancelled');
    error.name = 'AbortError';
    throw error;
  }
  if (rejected) throw rejected.reason;
  return settled.flatMap((item) => item.status === 'fulfilled' ? [item.value] : []);
}

export function summarizeSurveyCoverage(ledger: SurveyCoverageLedger): SurveyCoverageSummary {
  const candidateCount = ledger.papers.filter((paper) => paper.candidate).length;
  const abstractReviewedCount = ledger.papers.filter((paper) => paper.abstractReviewed).length;
  const bodySearchedCount = ledger.papers.filter((paper) => paper.bodySearched).length;
  const focusedReadCount = ledger.papers.filter((paper) => paper.focusedRead).length;
  const citedCount = ledger.papers.filter((paper) => paper.cited).length;
  const irrelevantCount = ledger.papers.filter((paper) => paper.irrelevant).length;
  const unresolvedCount = ledger.papers.filter((paper) => paper.unresolved).length;
  const failedCount = ledger.papers.filter((paper) => paper.failed).length;
  const emptyHitCount = ledger.papers.filter((paper) => paper.retrievalOutcome === 'empty').length;
  const unreadableCount = ledger.papers.filter((paper) => paper.unresolvedReason === 'no-document' || paper.unresolvedReason === 'unreadable-document').length;
  const retrievalFailedCount = ledger.papers.filter((paper) => paper.retrievalOutcome === 'failed').length;
  const pendingCount = ledger.papers.filter((paper) => paperState(paper) === 'pending' || paperState(paper) === 'in-progress').length;
  const completedSubquestionCount = ledger.subquestions.filter((item) => item.state === 'completed').length;
  const partialSubquestionCount = ledger.subquestions.filter((item) => item.state === 'partial').length;
  const failedSubquestionCount = ledger.subquestions.filter((item) => item.state === 'failed').length;
  const pendingSubquestionCount = ledger.subquestions.filter((item) => item.state === 'pending' || item.state === 'in-progress').length;
  const evidenceGaps = uniqueStrings(ledger.subquestions.flatMap((item) => item.evidenceGaps));
  const budgetExhausted = isSurveyCoverageBudgetExhausted(ledger);
  const canResume = pendingCount > 0 || pendingSubquestionCount > 0 || partialSubquestionCount > 0
    || unresolvedCount > 0 || failedCount > 0 || evidenceGaps.length > 0
    || ledger.runState === 'partial' || ledger.runState === 'cancelled' || ledger.runState === 'failed';

  return {
    runState: ledger.runState,
    stopReason: ledger.stopReason,
    candidateCount,
    abstractReviewedCount,
    bodySearchedCount,
    focusedReadCount,
    citedCount,
    irrelevantCount,
    unresolvedCount,
    failedCount,
    emptyHitCount,
    unreadableCount,
    retrievalFailedCount,
    pendingCount,
    abstractCoverage: ratio(abstractReviewedCount, candidateCount),
    bodySearchCoverage: ratio(bodySearchedCount, candidateCount),
    focusedReadCoverage: ratio(focusedReadCount, candidateCount),
    citationCoverage: ratio(citedCount, candidateCount),
    subquestionCount: ledger.subquestions.length,
    completedSubquestionCount,
    partialSubquestionCount,
    failedSubquestionCount,
    pendingSubquestionCount,
    evidenceGaps,
    budgetExhausted,
    canResume,
  };
}

export function finishSurveyCoverage(
  ledger: SurveyCoverageLedger,
  input: { state?: SurveyCoverageRunState; stopReason?: SurveyCoverageStopReason; timestamp?: number } = {},
): SurveyCoverageLedger {
  const summary = summarizeSurveyCoverage(ledger);
  const budgetStopReason = getSurveyCoverageBudgetStopReason(ledger);
  const state = input.state ?? (budgetStopReason
    ? 'partial'
    : summary.canResume
      ? 'partial'
      : 'completed');
  return {
    ...ledger,
    runState: state,
    stopReason: input.stopReason
      ?? (state === 'completed' ? 'completed' : ledger.stopReason ?? budgetStopReason ?? 'unknown'),
    updatedAt: input.timestamp ?? now(),
  };
}

function normalizePaper(value: unknown): SurveyPaperCoverage | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<SurveyPaperCoverage>;
  const paperId = cleanId(item.paperId);
  if (!paperId) return null;
  return {
    paperId,
    paperTitle: cleanText(item.paperTitle) || undefined,
    candidate: true,
    abstractReviewed: item.abstractReviewed === true,
    bodySearched: item.bodySearched === true,
    focusedRead: item.focusedRead === true,
    cited: item.cited === true,
    unresolved: item.unresolved === true,
    irrelevant: item.irrelevant === true,
    failed: item.failed === true,
    retrievalOutcome: ['hit', 'empty', 'failed', 'unavailable'].includes(item.retrievalOutcome as string)
      ? item.retrievalOutcome : undefined,
    unresolvedReason: item.unresolved === true && ['no-document', 'unreadable-document', 'no-hit', 'no-citable-evidence'].includes(item.unresolvedReason as string)
      ? item.unresolvedReason : undefined,
    attempts: finiteNonNegative(item.attempts),
    citationIds: uniqueStrings(item.citationIds),
    subquestionIds: uniqueStrings(item.subquestionIds),
    error: cleanText(item.error) || undefined,
    updatedAt: finiteNonNegative(item.updatedAt) || undefined,
  };
}

function normalizeSubquestion(value: unknown, index: number): SurveySubquestionCoverage | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<SurveySubquestionCoverage>;
  const question = cleanText(item.question);
  if (!question) return null;
  const allowed: SurveySubquestionState[] = ['pending', 'in-progress', 'completed', 'partial', 'failed'];
  return {
    id: cleanId(item.id) || `subquestion-${index + 1}`,
    question,
    state: allowed.includes(item.state as SurveySubquestionState) ? item.state as SurveySubquestionState : 'pending',
    candidatePaperIds: uniqueStrings(item.candidatePaperIds),
    evidenceCitationIds: uniqueStrings(item.evidenceCitationIds),
    evidenceGaps: uniqueStrings(item.evidenceGaps),
    completedPaperIds: uniqueStrings(item.completedPaperIds),
    failedPaperIds: uniqueStrings(item.failedPaperIds),
    updatedAt: finiteNonNegative(item.updatedAt) || undefined,
  };
}

/** Backward-compatible recovery: malformed fields are dropped, never invented as completed. */
export function normalizeSurveyCoverageLedger(value: unknown): SurveyCoverageLedger | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<SurveyCoverageLedger>;
  const papers = Array.isArray(input.papers)
    ? input.papers.map(normalizePaper).filter((paper): paper is SurveyPaperCoverage => Boolean(paper))
    : [];
  const subquestions = Array.isArray(input.subquestions)
    ? input.subquestions.map((item, index) => normalizeSubquestion(item, index)).filter((item): item is SurveySubquestionCoverage => Boolean(item))
    : [];
  const states: SurveyCoverageRunState[] = ['pending', 'running', 'completed', 'partial', 'cancelled', 'failed'];
  const reasons: SurveyCoverageStopReason[] = ['completed', 'budget-time', 'budget-tokens', 'budget-papers', 'budget-subquestions', 'cancelled', 'error', 'unknown'];
  const rawBudget = input.budget && typeof input.budget === 'object' ? input.budget : {};
  const budget = rawBudget as Partial<SurveyCoverageBudget>;
  const execution = budget.execution && typeof budget.execution === 'object' ? budget.execution : undefined;
  const updatedAt = finiteNonNegative(input.updatedAt) || now();
  return {
    version: SURVEY_COVERAGE_VERSION,
    runState: states.includes(input.runState as SurveyCoverageRunState) ? input.runState as SurveyCoverageRunState : 'pending',
    stopReason: reasons.includes(input.stopReason as SurveyCoverageStopReason) ? input.stopReason as SurveyCoverageStopReason : undefined,
    papers,
    subquestions,
    budget: {
      maxPapers: positiveLimit(budget.maxPapers),
      maxSubquestions: positiveLimit(budget.maxSubquestions),
      maxTokens: positiveLimit(budget.maxTokens),
      maxMilliseconds: positiveLimit(budget.maxMilliseconds),
      promptTokens: finiteNonNegative(budget.promptTokens),
      completionTokens: finiteNonNegative(budget.completionTokens),
      elapsedMilliseconds: finiteNonNegative(budget.elapsedMilliseconds),
      ...(execution ? {
        execution: {
          processedPaperIds: uniqueStrings(execution.processedPaperIds).filter((id) => papers.some((paper) => paper.paperId === id)),
          completedSubquestionIds: uniqueStrings(execution.completedSubquestionIds).filter((id) => subquestions.some((item) => item.id === id)),
          promptTokenBaseline: Math.min(finiteNonNegative(execution.promptTokenBaseline), finiteNonNegative(budget.promptTokens)),
          completionTokenBaseline: Math.min(finiteNonNegative(execution.completionTokenBaseline), finiteNonNegative(budget.completionTokens)),
          elapsedBaseline: Math.min(finiteNonNegative(execution.elapsedBaseline), finiteNonNegative(budget.elapsedMilliseconds)),
        },
      } : {}),
    },
    updatedAt,
  };
}
