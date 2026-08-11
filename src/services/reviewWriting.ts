import { invoke } from '../platform/electron/core';
import { listen } from '../platform/electron/event';
import type { ModelReasoningEffort, OpenAICompatibleApiMode } from '../types/reader';

export const REVIEW_GENERATION_PROGRESS_EVENT = 'paperquay://review-generation-progress';

export interface ReviewFigureCandidate {
  id: string;
  sourceId?: string;
  title?: string;
  sourceTitle?: string;
  caption: string;
  path: string;
  pageIndex?: number;
  blockId?: string;
  kind: 'image' | 'table' | string;
}

export interface ReviewJsonFigure extends ReviewFigureCandidate {
  placement?: string;
  reason?: string;
}

export interface ReviewContextItem {
  id: string;
  sourceType: 'paper' | 'note' | 'summary';
  title: string;
  authors?: string;
  year?: string;
  journal?: string;
  pages?: string;
  doi?: string;
  text: string;
  paperId?: string;
  noteId?: string;
  score?: number;
  figures?: ReviewFigureCandidate[];
}

export interface ReviewJsonSection {
  id?: string;
  heading: string;
  content: string;
  citations: string[];
}

export interface ReviewBlueprintTask {
  id?: string;
  task: string;
  evidenceIds: string[];
  retrievalNotes?: string;
  keyEvidence?: string[];
  target?: string;
}

export interface ReviewBlueprintSection extends ReviewBlueprintTask {
  id: string;
  heading: string;
  paragraphTasks: ReviewBlueprintTask[];
}

export interface ReviewBlueprintComparison extends ReviewBlueprintTask {
  id: string;
  theme: string;
}

export interface ReviewBlueprint {
  title: string;
  keywords: string[];
  intentSummary: string;
  thesis: string;
  abstractTask: ReviewBlueprintTask;
  introductionTask: ReviewBlueprintTask;
  sections: ReviewBlueprintSection[];
  comparisonTable: ReviewBlueprintComparison[];
  researchGaps: ReviewBlueprintTask[];
  futureDirections: ReviewBlueprintTask[];
  conclusionTask: ReviewBlueprintTask;
  references: ReviewJsonReference[];
  sources: ReviewJsonSource[];
  figures: ReviewJsonFigure[];
}

export interface ReviewJsonComparisonRow {
  theme: string;
  papers: string[];
  conclusion: string;
}

export interface ReviewJsonReference {
  id: string;
  title: string;
  authors: string;
  year: string;
  journal?: string;
  pages?: string;
  doi: string;
}

export interface ReviewJsonSource {
  id: string;
  title: string;
  sourceType: string;
  relevance: string;
}

export interface ReviewJsonDraft {
  title: string;
  abstract: string;
  keywords: string[];
  intentSummary: string;
  thesis: string;
  introduction: string;
  sections: ReviewJsonSection[];
  comparisonTable: ReviewJsonComparisonRow[];
  researchGaps: string[];
  futureDirections: string[];
  conclusion: string;
  references: ReviewJsonReference[];
  sources: ReviewJsonSource[];
  figures: ReviewJsonFigure[];
}

export interface ReviewGeneratedPart {
  content: string;
  citations: string[];
}

export interface ReviewGeneratedPartsCheckpoint {
  abstract?: ReviewGeneratedPart | null;
  introduction?: ReviewGeneratedPart | null;
  sectionParagraphs?: Array<Array<ReviewGeneratedPart | null>>;
  comparisonTable?: Array<ReviewGeneratedPart | null>;
  researchGaps?: Array<ReviewGeneratedPart | null>;
  futureDirections?: Array<ReviewGeneratedPart | null>;
  conclusion?: ReviewGeneratedPart | null;
}

export interface ReviewModelOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  requestId?: string;
  apiMode?: OpenAICompatibleApiMode;
  temperature?: number;
  reasoningEffort?: ModelReasoningEffort;
  intent: string;
  reviewType: string;
  sourceScope?: string;
  targetAudience: string;
  outputLanguage: string;
  contextItems: ReviewContextItem[];
  writingConcurrency?: number;
  blueprint?: ReviewBlueprint;
  resumeParts?: ReviewGeneratedPartsCheckpoint;
}

export interface ReviewGenerationProgress {
  requestId: string;
  phase: 'blueprint' | 'writing' | 'merge' | 'done';
  taskKind:
    | 'blueprint'
    | 'abstract'
    | 'introduction'
    | 'section_paragraph'
    | 'comparison'
    | 'research_gap'
    | 'future_direction'
    | 'conclusion'
    | 'merge'
    | 'done';
  status: 'running' | 'done' | 'error';
  current: number;
  total: number;
  taskKey?: string;
  heading?: string;
  sectionIndex?: number;
  sectionTotal?: number;
  paragraphIndex?: number;
  paragraphTotal?: number;
  itemIndex?: number;
  itemTotal?: number;
  generatedPart?: ReviewGeneratedPart;
  error?: string;
  updatedAt?: number;
}

export interface ReviewDocxExportResult {
  outputPath: string;
  byteSize: number;
  skippedFigures?: Array<{
    index: number;
    id: string;
    reason: string;
  }>;
  validation: {
    status: 'passed' | 'warning';
    errors: string[];
    warnings: string[];
    paragraphCount: number;
    imageCount: number;
    formulaCount: number;
    markdownCharacterCount: number;
  };
}

function cleanBridgeErrorMessage(message: string): string {
  return message
    .replace(/^Error invoking remote method 'paperquay:invoke':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .replace(/^TypeError:\s*/i, '')
    .trim();
}

function isMojibakeText(message: string): boolean {
  return /妯″瀷|缁艰堪|璇锋眰|鎷掔粷|椋庢帶|鍐欎綔|妫€娴嬪埌|绂佹|鍙兘|鎻愰棶|鍘熷閿欒|閫夋嫨|瀵煎嚭|澶辫触/.test(message);
}

function normalizeReviewErrorMessage(message: string, fallback: string): string {
  const cleaned = cleanBridgeErrorMessage(message);

  if (
    cleaned.includes('REVIEW_POLICY_BLOCKED') ||
    cleaned.includes('content_policy_violation') ||
    /OpenAI-compatible responses HTTP 403/i.test(cleaned)
  ) {
    const serviceDetail = cleaned.match(/Service message:\s*(.+)$/i)?.[1]?.trim();
    return [
      '模型服务拒绝了本次综述生成请求，通常是服务商风控、接口格式，或检索到的某段论文/笔记文本触发。',
      '请在“设置 > 模型 > 综述写作”切换到更适合长文本学术写作的模型，或把该预设的接口格式改为 Chat Completions 后重试。',
      serviceDetail && !isMojibakeText(serviceDetail) ? `服务消息：${serviceDetail}` : '',
    ].filter(Boolean).join(' ');
  }

  if (
    cleaned.includes('REVIEW_NETWORK_ERROR') ||
    /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|network/i.test(cleaned)
  ) {
    return '无法连接模型服务。请检查模型 Base URL、API Key、网络连接或代理设置，然后重试。';
  }

  if (!cleaned || isMojibakeText(cleaned)) {
    return fallback;
  }

  return cleaned;
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return normalizeReviewErrorMessage(error.message, fallback);
  }

  if (typeof error === 'string') {
    return normalizeReviewErrorMessage(error, fallback);
  }

  return fallback;
}

export async function listenReviewGenerationProgress(
  handler: (progress: ReviewGenerationProgress) => void,
): Promise<() => void> {
  return listen<ReviewGenerationProgress>(REVIEW_GENERATION_PROGRESS_EVENT, ({ payload }) => {
    if (payload?.requestId) {
      handler(payload);
    }
  });
}

export async function selectReviewDocxTemplate(): Promise<string | null> {
  try {
    return await invoke<string | null>('review_select_docx_template');
  } catch (error) {
    throw new Error(toErrorMessage(error, '选择 Word 模板失败'));
  }
}

export async function selectReviewDocxOutputPath(suggestedFileName: string): Promise<string | null> {
  try {
    return await invoke<string | null>('review_select_docx_output_path', { suggestedFileName });
  } catch (error) {
    throw new Error(toErrorMessage(error, '选择综述导出路径失败'));
  }
}

export async function generateReviewJsonDraft(options: ReviewModelOptions): Promise<ReviewJsonDraft> {
  try {
    return await invoke<ReviewJsonDraft>('review_generate_structured_json_openai_compatible', { options });
  } catch (error) {
    throw new Error(toErrorMessage(error, '生成综述写作数据失败'));
  }
}

export async function generateReviewBlueprint(options: ReviewModelOptions): Promise<ReviewBlueprint> {
  try {
    return await invoke<ReviewBlueprint>('review_generate_blueprint_openai_compatible', { options });
  } catch (error) {
    throw new Error(toErrorMessage(error, '生成综述写作蓝图失败'));
  }
}

export async function generateReviewJsonDraftFromBlueprint(
  options: ReviewModelOptions & { blueprint: ReviewBlueprint },
): Promise<ReviewJsonDraft> {
  try {
    return await invoke<ReviewJsonDraft>('review_generate_structured_json_from_blueprint_openai_compatible', { options });
  } catch (error) {
    throw new Error(toErrorMessage(error, '根据写作蓝图生成综述失败'));
  }
}

export async function exportReviewDocx(
  templatePath: string,
  outputPath: string,
  data: ReviewJsonDraft & { outputLanguage?: string },
): Promise<ReviewDocxExportResult> {
  try {
    return await invoke<ReviewDocxExportResult>('review_export_docx', {
      templatePath,
      outputPath,
      data,
    });
  } catch (error) {
    throw new Error(toErrorMessage(error, '导出 Word 综述失败'));
  }
}

export async function openReviewOutput(path: string): Promise<void> {
  try {
    await invoke('review_open_output', { path });
  } catch (error) {
    throw new Error(toErrorMessage(error, '打开导出的综述失败'));
  }
}
