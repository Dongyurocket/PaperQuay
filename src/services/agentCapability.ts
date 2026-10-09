import { bindAnswerEvidence, type AnswerEvidenceStatus } from './agentAnswerEvidence.ts';
import {
  inspectAgentDeliveryQuality,
  deriveAgentDeliveryRequirement,
  type DeliveryQualityResult,
  type DeliveryRequirement,
} from './agentDeliveryQuality.ts';
import {
  finishSurveyCoverage,
  normalizeSurveyCoverageLedger,
  normalizeSurveyResearchContexts,
  resumeSurveyCoverageLedger,
  summarizeSurveyCoverage,
  type SurveyCoverageLedger,
  type SurveyCoverageSummary,
  type SurveyResearchContext,
} from './agentSurveyCoverage.ts';

export type ComparativeSurveyStage = 'rephrase' | 'decompose' | 'research' | 'report';

export interface ComparativeSurveyArtifacts {
  rephrasedQuestion?: string;
  subquestions?: string[];
  researchNotes?: string;
  researchContexts?: SurveyResearchContext[];
  citations?: ComparativeSurveyCitation[];
  /** Optional resumable paper/subquestion coverage ledger for long surveys. */
  coverage?: SurveyCoverageLedger;
  completedStages: ComparativeSurveyStage[];
}

export interface ComparativeSurveyCitation {
  id?: string;
  label?: string;
  paperId: string;
  paperTitle: string;
  pageIndex?: number | null;
  blockId?: string | null;
  previewText?: string;
  sourceType?: 'mineru-markdown' | 'pdf-text';
}

export interface ComparativeSurveyResult {
  markdown: string;
  citations: ComparativeSurveyCitation[];
  tokenUsage: { promptTokens: number; completionTokens: number };
  artifacts: ComparativeSurveyArtifacts;
  evidenceStats?: Record<AnswerEvidenceStatus, number>;
  coverageSummary?: SurveyCoverageSummary;
  /** Explainable delivery checks; the markdown and citation identities are untouched. */
  deliveryQuality?: DeliveryQualityResult;
}

export type ComparativeSurveyEvent =
  | { kind: 'stage_start'; stage: ComparativeSurveyStage; attempt: number }
  | { kind: 'stage_progress'; stage: ComparativeSurveyStage; completed: number; total: number; detail?: string }
  | { kind: 'stage_end'; stage: ComparativeSurveyStage }
  | { kind: 'stage_retry'; stage: ComparativeSurveyStage; attempt: number; error: string };

export interface ComparativeSurveyHandlers {
  rephrase: (input: { question: string }) => Promise<{ text: string; usage?: Partial<ComparativeSurveyResult['tokenUsage']> }>;
  decompose: (input: { question: string }) => Promise<{ questions: string[]; usage?: Partial<ComparativeSurveyResult['tokenUsage']> }>;
  research: (input: {
    question: string;
    subquestions: string[];
    onProgress: (completed: number, total: number, detail?: string) => void;
    coverage?: SurveyCoverageLedger;
    researchNotes?: string;
    researchContexts?: SurveyResearchContext[];
    citations?: ComparativeSurveyCitation[];
    /** Persist resumable coverage while a long research stage is running. */
    onCheckpoint?: (coverage: SurveyCoverageLedger, progress?: { notes?: string; citations?: ComparativeSurveyCitation[]; contexts?: SurveyResearchContext[] }) => void;
  }) => Promise<{
    notes: string;
    citations: ComparativeSurveyCitation[];
    usage?: Partial<ComparativeSurveyResult['tokenUsage']>;
    /** A handler may update the ledger after each batch; old handlers can omit it. */
    coverage?: SurveyCoverageLedger;
    researchContexts?: SurveyResearchContext[];
  }>;
  report: (input: { question: string; subquestions: string[]; researchNotes: string }) => Promise<{ markdown: string; usage?: Partial<ComparativeSurveyResult['tokenUsage']>; finishReason?: string }>;
}

export interface ComparativeSurveyOptions {
  question: string;
  handlers: ComparativeSurveyHandlers;
  resume?: Partial<ComparativeSurveyArtifacts>;
  maxRetries?: number;
  signal?: AbortSignal;
  onEvent?: (event: ComparativeSurveyEvent) => void;
  onCheckpoint?: (artifacts: ComparativeSurveyArtifacts) => void;
  deliveryRequirement?: DeliveryRequirement;
}

function abortError(): Error {
  const error = new Error('Comparative survey cancelled');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw abortError();
}

function usage(value: Partial<ComparativeSurveyResult['tokenUsage']> | undefined) {
  const normalize = (input: unknown) => Number.isFinite(Number(input)) ? Math.max(0, Math.trunc(Number(input))) : 0;
  return {
    promptTokens: normalize(value?.promptTokens),
    completionTokens: normalize(value?.completionTokens),
  };
}

function addUsage(
  target: ComparativeSurveyResult['tokenUsage'],
  next: Partial<ComparativeSurveyResult['tokenUsage']> | undefined,
) {
  const normalized = usage(next);
  target.promptTokens += normalized.promptTokens;
  target.completionTokens += normalized.completionTokens;
}

async function withRetry<T>(input: {
  stage: ComparativeSurveyStage;
  maxRetries: number;
  signal?: AbortSignal;
  emit: (event: ComparativeSurveyEvent) => void;
  run: () => Promise<T>;
}): Promise<T> {
  let attempt = 0;

  while (true) {
    throwIfAborted(input.signal);
    attempt += 1;
    input.emit({ kind: 'stage_start', stage: input.stage, attempt });

    try {
      const result = await input.run();
      throwIfAborted(input.signal);
      input.emit({ kind: 'stage_end', stage: input.stage });
      return result;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      if (attempt >= input.maxRetries + 1) throw error;
      input.emit({
        kind: 'stage_retry',
        stage: input.stage,
        attempt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export async function runComparativeSurveyCapability(options: ComparativeSurveyOptions): Promise<ComparativeSurveyResult> {
  const question = options.question.trim();

  if (!question) {
    throw new Error('Comparative survey requires a research question.');
  }

  const emit = (event: ComparativeSurveyEvent) => options.onEvent?.(event);
  const maxRetries = Math.max(0, Math.min(3, Math.trunc(options.maxRetries ?? 1)));
  const recoveredCoverage = normalizeSurveyCoverageLedger(options.resume?.coverage);
  const resumedCoverage = recoveredCoverage && recoveredCoverage.runState !== 'completed'
    ? resumeSurveyCoverageLedger(recoveredCoverage)
    : recoveredCoverage;
  const artifacts: ComparativeSurveyArtifacts = {
    rephrasedQuestion: options.resume?.rephrasedQuestion,
    subquestions: options.resume?.subquestions ? [...options.resume.subquestions] : undefined,
    researchNotes: options.resume?.researchNotes,
    researchContexts: normalizeSurveyResearchContexts(options.resume?.researchContexts),
    ...(options.resume?.citations ? { citations: options.resume.citations.map((citation) => ({ ...citation })) } : {}),
    ...(resumedCoverage ? { coverage: resumedCoverage } : {}),
    completedStages: [...(options.resume?.completedStages ?? [])],
  };
  if (artifacts.coverage) {
    artifacts.coverage = {
      ...artifacts.coverage,
      runState: artifacts.coverage.runState === 'completed' ? 'completed' : 'running',
    };
  }
  const tokenUsage = { promptTokens: 0, completionTokens: 0 };
  const saveCheckpoint = () => options.onCheckpoint?.({
    ...artifacts,
    subquestions: artifacts.subquestions ? [...artifacts.subquestions] : undefined,
    citations: artifacts.citations?.map((citation) => ({ ...citation })),
    researchContexts: normalizeSurveyResearchContexts(artifacts.researchContexts),
    coverage: artifacts.coverage
      ? normalizeSurveyCoverageLedger(JSON.parse(JSON.stringify(artifacts.coverage))) ?? undefined
      : undefined,
    completedStages: [...artifacts.completedStages],
  });

  try {
  if (!artifacts.rephrasedQuestion) {
    const result = await withRetry({
      stage: 'rephrase',
      maxRetries,
      signal: options.signal,
      emit,
      run: () => options.handlers.rephrase({ question }),
    });
    artifacts.rephrasedQuestion = result.text.trim() || question;
    artifacts.completedStages.push('rephrase');
    addUsage(tokenUsage, result.usage);
    saveCheckpoint();
  }

  if (!artifacts.subquestions?.length) {
    const result = await withRetry({
      stage: 'decompose',
      maxRetries,
      signal: options.signal,
      emit,
      run: () => options.handlers.decompose({ question: artifacts.rephrasedQuestion ?? question }),
    });
    artifacts.subquestions = result.questions.map((item) => item.trim()).filter(Boolean).slice(0, 8);
    if (artifacts.subquestions.length === 0) artifacts.subquestions = [artifacts.rephrasedQuestion ?? question];
    artifacts.completedStages.push('decompose');
    addUsage(tokenUsage, result.usage);
    saveCheckpoint();
  }

  let citations: ComparativeSurveyCitation[] = artifacts.citations?.map((citation) => ({ ...citation })) ?? [];
  const coverageNeedsResearch = artifacts.coverage ? summarizeSurveyCoverage(artifacts.coverage).canResume : false;
  if (!artifacts.researchNotes || !artifacts.completedStages.includes('research') || coverageNeedsResearch) {
    const result = await withRetry({
      stage: 'research',
      maxRetries,
      signal: options.signal,
      emit,
      run: () => options.handlers.research({
        question: artifacts.rephrasedQuestion ?? question,
        subquestions: artifacts.subquestions ?? [question],
        onProgress: (completed, total, detail) => emit({ kind: 'stage_progress', stage: 'research', completed, total, detail }),
        researchNotes: artifacts.researchNotes,
        researchContexts: normalizeSurveyResearchContexts(artifacts.researchContexts),
        citations: artifacts.citations?.map((citation) => ({ ...citation })),
        onCheckpoint: (coverage, progress) => {
          const normalized = normalizeSurveyCoverageLedger(coverage);
          if (!normalized) return;
          artifacts.coverage = normalized;
          if (progress?.notes !== undefined) artifacts.researchNotes = progress.notes;
          if (progress?.citations) artifacts.citations = progress.citations.map((citation) => ({ ...citation }));
          if (progress?.contexts) artifacts.researchContexts = normalizeSurveyResearchContexts(progress.contexts);
          saveCheckpoint();
        },
        ...(artifacts.coverage ? { coverage: artifacts.coverage } : {}),
      }),
    });
    artifacts.researchNotes = result.notes;
    citations = result.citations;
    artifacts.citations = result.citations.map((citation) => ({ ...citation }));
    artifacts.researchContexts = normalizeSurveyResearchContexts(result.researchContexts);
    if (result.coverage) {
      artifacts.coverage = normalizeSurveyCoverageLedger(result.coverage) ?? artifacts.coverage;
    }
    if (!artifacts.completedStages.includes('research')) artifacts.completedStages.push('research');
    addUsage(tokenUsage, result.usage);
    saveCheckpoint();
  }

  const report = await withRetry({
    stage: 'report',
    maxRetries,
    signal: options.signal,
    emit,
    run: () => options.handlers.report({
      question: artifacts.rephrasedQuestion ?? question,
      subquestions: artifacts.subquestions ?? [question],
      researchNotes: artifacts.researchNotes ?? '',
    }),
  });
  if (!artifacts.completedStages.includes('report')) artifacts.completedStages.push('report');
  addUsage(tokenUsage, report.usage);
  if (artifacts.coverage) {
    artifacts.coverage = finishSurveyCoverage(artifacts.coverage, report.finishReason === 'length'
      ? { state: 'partial', stopReason: 'budget-tokens' }
      : !report.markdown.trim()
        ? { state: 'failed', stopReason: 'error' }
        : undefined);
  }
  saveCheckpoint();

  const markdown = report.markdown.trim() || 'No comparative survey report was generated.';
  const deliveryRequirement = options.deliveryRequirement ?? deriveAgentDeliveryRequirement({ instruction: question, defaultKind: 'survey' });
  const deliveryQuality = inspectAgentDeliveryQuality({
    markdown,
    requirement: {
      ...deliveryRequirement,
      kind: deliveryRequirement.kind === 'engineering' ? 'engineering' : 'survey',
      completeness: deliveryRequirement.completeness === 'partial' ? 'partial' : 'full',
      candidateCount: artifacts.coverage ? summarizeSurveyCoverage(artifacts.coverage).candidateCount : undefined,
      pendingCount: artifacts.coverage ? summarizeSurveyCoverage(artifacts.coverage).pendingCount : undefined,
    },
    runState: !report.markdown.trim()
      ? 'invalid-output'
      : report.finishReason === 'length' || artifacts.coverage?.stopReason?.startsWith('budget-')
        ? 'budget'
        : artifacts.coverage?.runState === 'failed'
          ? 'failed'
          : artifacts.coverage?.runState === 'cancelled'
            ? 'cancelled'
            : artifacts.coverage?.runState === 'partial'
              ? 'partial'
              : 'completed',
  });
  const evidence = bindAnswerEvidence({
    answer: markdown,
    citations: citations.map((c, index) => ({
      id: c.id,
      label: c.label ?? String(index + 1),
      paperId: c.paperId,
      paperTitle: c.paperTitle,
      pageIndex: c.pageIndex,
      blockId: c.blockId,
      previewText: c.previewText,
    })),
  });

  return {
    markdown,
    citations,
    tokenUsage,
    artifacts,
    evidenceStats: evidence.counts,
    coverageSummary: artifacts.coverage ? summarizeSurveyCoverage(artifacts.coverage) : undefined,
    deliveryQuality,
  };
  } catch (error) {
    // Preserve the most recent research checkpoint when a long survey is
    // cancelled or fails. A resumed run must see an explicit terminal reason
    // instead of mistaking the last running snapshot for a completed stage.
    if (artifacts.coverage) {
      const cancelled = error instanceof Error && error.name === 'AbortError';
      artifacts.coverage = finishSurveyCoverage(artifacts.coverage, {
        state: cancelled ? 'cancelled' : 'failed',
        stopReason: cancelled ? 'cancelled' : 'error',
      });
      saveCheckpoint();
    }
    throw error;
  }
}
