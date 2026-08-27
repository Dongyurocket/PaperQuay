export type ComparativeSurveyStage = 'rephrase' | 'decompose' | 'research' | 'report';

export interface ComparativeSurveyArtifacts {
  rephrasedQuestion?: string;
  subquestions?: string[];
  researchNotes?: string;
  citations?: ComparativeSurveyCitation[];
  completedStages: ComparativeSurveyStage[];
}

export interface ComparativeSurveyCitation {
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
}

export type ComparativeSurveyEvent =
  | { kind: 'stage_start'; stage: ComparativeSurveyStage; attempt: number }
  | { kind: 'stage_progress'; stage: ComparativeSurveyStage; completed: number; total: number; detail?: string }
  | { kind: 'stage_end'; stage: ComparativeSurveyStage }
  | { kind: 'stage_retry'; stage: ComparativeSurveyStage; attempt: number; error: string };

export interface ComparativeSurveyHandlers {
  rephrase: (input: { question: string }) => Promise<{ text: string; usage?: Partial<ComparativeSurveyResult['tokenUsage']> }>;
  decompose: (input: { question: string }) => Promise<{ questions: string[]; usage?: Partial<ComparativeSurveyResult['tokenUsage']> }>;
  research: (input: { question: string; subquestions: string[]; onProgress: (completed: number, total: number, detail?: string) => void }) => Promise<{
    notes: string;
    citations: ComparativeSurveyCitation[];
    usage?: Partial<ComparativeSurveyResult['tokenUsage']>;
  }>;
  report: (input: { question: string; subquestions: string[]; researchNotes: string }) => Promise<{ markdown: string; usage?: Partial<ComparativeSurveyResult['tokenUsage']> }>;
}

export interface ComparativeSurveyOptions {
  question: string;
  handlers: ComparativeSurveyHandlers;
  resume?: Partial<ComparativeSurveyArtifacts>;
  maxRetries?: number;
  signal?: AbortSignal;
  onEvent?: (event: ComparativeSurveyEvent) => void;
  onCheckpoint?: (artifacts: ComparativeSurveyArtifacts) => void;
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
  const artifacts: ComparativeSurveyArtifacts = {
    rephrasedQuestion: options.resume?.rephrasedQuestion,
    subquestions: options.resume?.subquestions ? [...options.resume.subquestions] : undefined,
    researchNotes: options.resume?.researchNotes,
    completedStages: [...(options.resume?.completedStages ?? [])],
  };
  const tokenUsage = { promptTokens: 0, completionTokens: 0 };
  const saveCheckpoint = () => options.onCheckpoint?.({
    ...artifacts,
    subquestions: artifacts.subquestions ? [...artifacts.subquestions] : undefined,
    citations: artifacts.citations?.map((citation) => ({ ...citation })),
    completedStages: [...artifacts.completedStages],
  });

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
  if (!artifacts.researchNotes) {
    const result = await withRetry({
      stage: 'research',
      maxRetries,
      signal: options.signal,
      emit,
      run: () => options.handlers.research({
        question: artifacts.rephrasedQuestion ?? question,
        subquestions: artifacts.subquestions ?? [question],
        onProgress: (completed, total, detail) => emit({ kind: 'stage_progress', stage: 'research', completed, total, detail }),
      }),
    });
    artifacts.researchNotes = result.notes;
    citations = result.citations;
    artifacts.citations = result.citations.map((citation) => ({ ...citation }));
    artifacts.completedStages.push('research');
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
  artifacts.completedStages.push('report');
  addUsage(tokenUsage, report.usage);
  saveCheckpoint();

  return {
    markdown: report.markdown.trim() || 'No comparative survey report was generated.',
    citations,
    tokenUsage,
    artifacts,
  };
}
