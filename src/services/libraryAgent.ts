import { invoke } from '../platform/electron/core';
import { listen } from '../platform/electron/event';
import { runOpenAiCompatibleAgentChatTurn } from './agentChat';
import {
  createAgentMemoryWritePlan,
  readAgentMemory,
  type AgentMemoryWritePlan,
} from './agentMemory';
import type { AgentNoteWritePlan } from './agentNotePlan';
import {
  emptyAgentSessionArtifacts,
  type AgentSessionArtifacts,
} from './agentContextBudget';
import {
  runComparativeSurveyCapability,
  type ComparativeSurveyArtifacts,
  type ComparativeSurveyEvent,
  type ComparativeSurveyResult,
} from './agentCapability';
import {
  type AgentCapabilityCallModel,
  type AgentCapabilityEvent,
  type AgentCapabilityId,
  type AgentCapabilityResult,
  getAgentCapability,
} from './agentCapabilityRegistry';
import { resolveAgentCapabilityRoute } from './agentCapabilityRoute';
import { classifyAgentCapabilityRoute } from './agentCapabilityClassifier';
import { bindAgentCitationSources, citationBindingStats, verifyAgentCitationBindings, type AgentCitationBinding, type AnswerEvidenceStatus } from './agentAnswerEvidence.ts';
import { AGENT_CITATION_PROTOCOL, AgentCitationRegistry, createAgentDocumentExcerptCitation, formatCitationEvidenceToken, recoverAgentToolCitations, rewriteAgentCitationSourceLabels } from './agentCitationRegistry.ts';
import { agentToolTextVersion, sliceAgentToolText } from './agentToolContent.ts';
import { buildWorkingMemoryInjection } from './agentMemoryContract.ts';
import { isComparativeSurveyInstruction } from './agentCapabilityTrigger';
import {
  runAgentLoop,
  type AgentLoopEvent,
  type AgentLoopMessage,
  type AgentToolMountContext,
} from './agentLoop';
import { createLibraryAgentTools, paperSearchText, type AgentPaperContextResult } from './agentTools';
import {
  readLocalBinaryFile,
  readLocalTextFileIfExists,
} from './desktop';
import {
  matchRagVisionCandidates,
  prepareAgentVisionAttachments,
  userAttachmentVisionCandidates,
  type AgentVisionCandidate,
} from './agentVision';
import { resolveLocalRag } from './localRag';
import { embedRagText, ragRetrieveDocumentChunks } from './rag';
import { resolveAgentPaperScope, resolveAgentPaperIds } from './agentPaperScope';
import { buildAgentDeliveryQualityPrompt, deriveAgentDeliveryRequirement, inspectAgentDeliveryQuality, type DeliveryQualityResult } from './agentDeliveryQuality.ts';
import {
  createSurveyCoverageLedger,
  ensureSurveyCoveragePapers,
  ensureSurveyCoverageSubquestions,
  finishSurveyCoverage,
  getSurveyCoverageBudgetStopReason,
  normalizeSurveyCoverageLedger,
  normalizeSurveyResearchContexts,
  processSurveyCoverageBatch,
  recordSurveyPaperCoverage,
  recordSurveySubquestionCoverage,
  selectSurveyCoverageBatch,
  summarizeSurveyCoverage,
  updateSurveyCoverageBudget,
  type SurveyCoverageLedger,
  type SurveyCoverageBatchResult,
  type SurveyPaperRetrievalOutcome,
} from './agentSurveyCoverage';
import {
  paperAuthors,
  paperPdfPath,
  normalizeComparable,
  stripKnownReadPrefix,
  uniqueTags,
} from './libraryAgentPlanHelpers';
import { readReaderConfigFile } from './readerConfig';
import {
  buildMineruMarkdownDocument,
  extractPdfTextByPdfJs,
} from './summarySource';
import {
  flattenMineruPages,
  extractCaptionFromMineruBlock,
  extractMineruAssetPathFromBlock,
  parseMineruPages,
  resolveMineruAssetPath,
} from './mineru';
import {
  buildMineruCachePathCandidates,
  getMineruJsonPathCandidates,
  guessSiblingJsonPaths,
  guessSiblingMarkdownPath,
} from '../utils/mineruCache';
import type { LiteratureCategory, LiteraturePaper, UpdatePaperRequest } from '../types/library';
import type {
  DocumentChatAttachment,
  DocumentChatCitation,
  ModelRuntimeConfig,
  ModelReasoningEffort,
  OpenAICompatibleApiMode,
  PositionedMineruBlock,
  QaModelPreset,
  ReaderConfigFile,
  ReaderSecrets,
  ReaderSettings,
  WorkspaceItem,
} from '../types/reader';

export type LibraryAgentTool =
  | 'rename'
  | 'metadata'
  | 'smart-tags'
  | 'clean-tags'
  | 'classify';

export type LibraryAgentToolChoice = LibraryAgentTool | 'auto';

export type RenameOperation =
  | { mode: 'suffix'; value: string }
  | { mode: 'prefix'; value: string }
  | { mode: 'replace'; from: string; to: string };

export interface LibraryAgentPlanItem {
  id: string;
  tool: LibraryAgentTool;
  paperId: string;
  paperTitle: string;
  title: string;
  description: string;
  before?: string;
  after?: string;
  updateRequest?: UpdatePaperRequest;
  targetCategoryName?: string;
  targetCategoryParentName?: string;
  metadataSource?: string;
}

export interface LibraryAgentPlan {
  id: string;
  tool: LibraryAgentTool;
  title: string;
  description: string;
  items: LibraryAgentPlanItem[];
  createdAt: number;
}

export interface ApplyLibraryAgentPlanResult {
  applied: number;
  failed: number;
  errors: string[];
}

interface LibraryAgentPaperInput {
  id: string;
  title: string;
  authors: string[];
  year?: string | null;
  publication?: string | null;
  doi?: string | null;
  url?: string | null;
  abstractText?: string | null;
  aiSummary?: string | null;
  userNote?: string | null;
  contextSource?: string | null;
  contextText?: string | null;
  keywords: string[];
  tags: string[];
  categoryIds: string[];
  categories: string[];
  categoryPaths: string[];
}

interface LibraryAgentCategoryInput {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  paperCount: number;
}

export interface LibraryAgentPaperScopeInput {
  id: string;
  label: string;
  paperIds: string[];
  source: 'current' | 'history';
  messageRole?: 'assistant' | 'user';
  messageContent?: string;
}

interface OpenAICompatibleLibraryAgentOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  apiMode?: OpenAICompatibleApiMode;
  temperature?: number;
  reasoningEffort?: ModelReasoningEffort;
  responseLanguage?: string;
  allowContextRequest?: boolean;
  tool: LibraryAgentToolChoice;
  instruction?: string | null;
  messages?: LibraryAgentConversationMessage[];
  currentPaperScopeIds?: string[];
  paperScopes?: LibraryAgentPaperScopeInput[];
  categories?: LibraryAgentCategoryInput[];
  papers: LibraryAgentPaperInput[];
}

type LibraryAgentModelPreset = QaModelPreset & {
  temperature?: number;
  reasoningEffort?: ModelReasoningEffort;
};

interface LibraryAgentPaperUpdate {
  title?: string | null;
  year?: string | null;
  publication?: string | null;
  doi?: string | null;
  url?: string | null;
  abstractText?: string | null;
  keywords?: string[] | null;
  tags?: string[] | null;
  authors?: string[] | null;
}

interface LibraryAgentGeneratedItem {
  paperId?: string | null;
  id?: string | null;
  title?: string | null;
  description?: string | null;
  before?: string | null;
  after?: string | null;
  update?: LibraryAgentPaperUpdate | null;
  updateRequest?: LibraryAgentPaperUpdate | null;
  newTitle?: string | null;
  targetTitle?: string | null;
  updatedTitle?: string | null;
  afterTitle?: string | null;
  titleAfter?: string | null;
  targetCategoryName?: string | null;
  targetCategoryParentName?: string | null;
  [key: string]: unknown;
}

interface LibraryAgentGeneratedPlan {
  tool?: LibraryAgentTool | string | null;
  summary?: string | null;
  description?: string | null;
  items?: LibraryAgentGeneratedItem[] | null;
  updates?: LibraryAgentGeneratedItem[] | null;
  paperUpdates?: LibraryAgentGeneratedItem[] | null;
  papers?: LibraryAgentGeneratedItem[] | null;
  [key: string]: unknown;
}

interface LibraryAgentPaperContextDecision {
  kind: 'paper-skill-decision';
  action: 'load-context' | 'continue-without-context' | 'ask-user-to-select-papers';
  summary: string;
  reason: string;
  mode: LibraryAgentContextRequest['mode'];
  paperIds: string[];
  thinking?: string | null;
}

export interface LibraryAgentRagCitation extends DocumentChatCitation {
  paperId: string;
  paperTitle: string;
}

export interface LibraryPaperReviewContext {
  paperId: string;
  source: string;
  text: string;
  citations?: LibraryAgentRagCitation[];
  figures?: LibraryPaperReviewFigure[];
}

export interface LibraryPaperReviewFigure {
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

export interface LibraryAgentFigureReference extends LibraryPaperReviewFigure {
  paperId: string;
  paperTitle: string;
  dataUrl?: string;
}

export type LibraryAgentRunResult =
  | {
    kind: 'answer';
    answer: string;
    contextLabel: string;
    thinking?: string | null;
    citations?: LibraryAgentRagCitation[];
    figures?: LibraryAgentFigureReference[];
    visionNotice?: string | null;
    /** RAG 检索失败时的用户可见提示（已回退到全文/摘要上下文）。 */
    ragNotice?: string | null;
    evidenceStats?: Record<AnswerEvidenceStatus, number>;
    citationBindings?: AgentCitationBinding[];
    deliveryQuality?: DeliveryQualityResult;
  }
  | {
    kind: 'choice';
    answer: string;
    choices: LibraryAgentUserChoice[];
    thinking?: string | null;
    citations?: LibraryAgentRagCitation[];
    figures?: LibraryAgentFigureReference[];
    visionNotice?: string | null;
    ragNotice?: string | null;
    evidenceStats?: Record<AnswerEvidenceStatus, number>;
    citationBindings?: AgentCitationBinding[];
  }
  | {
    kind: 'paper-selection';
    answer: string;
    request: LibraryAgentPaperSelectionRequest;
    thinking?: string | null;
  }
  | {
    kind: 'capability';
    capabilityId: AgentCapabilityId;
    result: AgentCapabilityResult;
    citations?: LibraryAgentRagCitation[];
    figures?: LibraryAgentFigureReference[];
    visionNotice?: string | null;
    ragNotice?: string | null;
    evidenceStats?: Record<AnswerEvidenceStatus, number>;
    citationBindings?: AgentCitationBinding[];
  }
  | {
    kind: 'memory-plan';
    memoryPlan: AgentMemoryWritePlan;
    citations?: LibraryAgentRagCitation[];
    figures?: LibraryAgentFigureReference[];
    visionNotice?: string | null;
    ragNotice?: string | null;
  }
  | {
    kind: 'note-plan';
    notePlan: AgentNoteWritePlan;
    citations?: LibraryAgentRagCitation[];
    figures?: LibraryAgentFigureReference[];
    visionNotice?: string | null;
    ragNotice?: string | null;
  }
  | {
    kind: 'plan';
    plan: LibraryAgentPlan;
    thinking?: string | null;
    citations?: LibraryAgentRagCitation[];
    figures?: LibraryAgentFigureReference[];
    visionNotice?: string | null;
    ragNotice?: string | null;
  };

interface LibraryAgentContextRequest {
  summary: string;
  mode: 'summary' | 'pdf-text';
  paperIds?: string[];
  reason: string;
}

export interface LibraryAgentPaperSelectionRequest {
  summary: string;
  mode: LibraryAgentContextRequest['mode'];
  reason: string;
  instruction: string;
}

interface PaperContextPayload {
  source: string;
  text: string;
  citations?: LibraryAgentRagCitation[];
  figures?: LibraryPaperReviewFigure[];
  visionCandidates?: AgentVisionCandidate[];
  /** RAG 检索失败时的错误信息（已回退到全文/摘要），用于向用户透传状态。 */
  ragError?: string | null;
  retrievalOutcome?: SurveyPaperRetrievalOutcome;
}

function buildAgentRagNotice(ragErrors: string[]): string | null {
  if (ragErrors.length === 0) {
    return null;
  }

  const detail = ragErrors.join('；');

  return `本次未命中本地 RAG：检索失败，已回退到全文/摘要上下文。错误：${detail}（Local RAG retrieval failed and fell back to full-text context: ${detail}）`;
}

function buildAgentRagCitations(
  paper: LiteraturePaper,
  citations: DocumentChatCitation[] = [],
): LibraryAgentRagCitation[] {
  return citations.map((citation) => ({
    ...citation,
    id: `agent-rag:${paper.id}:${citation.sourceType}:${citation.chunkId || citation.id}`,
    paperId: paper.id,
    paperTitle: paper.title,
  }));
}

function renumberPaperContextCitations(
  context: PaperContextPayload,
  startIndex: number,
): PaperContextPayload {
  if (!context.citations?.length) {
    return context;
  }

  const nextCitations = context.citations.map((citation, index) => ({
    ...citation,
    label: String(startIndex + index + 1),
  }));

  return {
    ...context,
    text: rewriteAgentCitationSourceLabels(context.text, context.citations, nextCitations),
    citations: nextCitations,
  };
}

export interface LibraryAgentUserChoice {
  id: string;
  label: string;
  description: string;
  instruction: string;
}

export interface LibraryAgentConversationMessage {
  role: 'assistant' | 'user';
  content: string;
  paperScopeIds?: string[];
  attachments?: DocumentChatAttachment[];
}

export {
  applyLibraryAgentPlan,
  buildAutoClassifyPlan,
  buildCleanTagsPlan,
  buildMetadataCompletionPlan,
  buildRenamePlan,
  buildSmartTagPlan,
  inferCollectionNameForPaper,
  inferSmartTagsForPaper,
  normalizeAgentTagName,
  normalizeComparable,
  paperAuthors,
  paperPdfPath,
  parseRenameCommand,
  uniqueTags,
} from './libraryAgentPlanHelpers';

const SETTINGS_STORAGE_KEY = 'paper-reader-settings-v3';
const SECRETS_STORAGE_KEY = 'paper-reader-secrets-v1';
const AUTO_CLASSIFY_PARENT_NAME = 'Agent 自动归类';
const MAX_REACT_INITIAL_PAPERS = 20;
const MAX_REACT_INITIAL_CONTEXT_CHARS = 48_000;

export interface LibraryAgentStreamHandlers {
  /** `turn` lets consumers keep a draft scoped to the current model turn. */
  onDelta?: (text: string, fullText: string, turn?: number) => void;
  onThinkingDelta?: (text: string, fullText: string, turn?: number) => void;
  onLoopEvent?: (event: AgentLoopEvent) => void;
  onCapabilityEvent?: (event: AgentCapabilityEvent) => void;
  /**
   * 能力路由事件（方案第 9 节）：每次运行解析后记 capability_route；
   * 分类器失败另记 capability_route_failed。payload 不含分类器原始输出。
   */
  onCapabilityRoute?: (event:
    | { kind: 'capability_route'; capabilityId: AgentCapabilityId | null; source: string; reason: string }
    | { kind: 'capability_route_failed'; reason: string }) => void;
  onCapabilityUsage?: (usage: { promptTokens: number; completionTokens: number; capabilityId: AgentCapabilityId | 'classifier' | 'citation-verifier' }) => void;
  onCitationVerification?: (bindings: AgentCitationBinding[]) => void;
  onCapabilityCheckpoint?: (artifacts: ComparativeSurveyArtifacts) => void;
  onRecoveryCheckpoint?: (messages: AgentLoopMessage[], turn: number, citations?: LibraryAgentRagCitation[]) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
}

function newPlanId(tool: LibraryAgentTool): string {
  return `agent-plan:${tool}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return fallback;
}

function readStorageJson<T>(key: string): Partial<T> {
  try {
    const rawValue = window.localStorage.getItem(key);

    if (!rawValue) {
      return {};
    }

    return JSON.parse(rawValue) as Partial<T>;
  } catch {
    return {};
  }
}

async function loadPersistedReaderConfig(): Promise<Partial<ReaderConfigFile> | null> {
  try {
    return await readReaderConfigFile();
  } catch {
    return null;
  }
}

function normalizeAgentRuntimeConfig(settings: Partial<ReaderSettings>): ModelRuntimeConfig {
  const config = settings.modelRuntimeConfigs?.agent ?? {};
  const temperature =
    typeof config.temperature === 'number' && Number.isFinite(config.temperature)
      ? Math.min(2, Math.max(0, config.temperature))
      : undefined;
  const reasoningEffort =
    config.reasoningEffort === 'low' ||
    config.reasoningEffort === 'medium' ||
    config.reasoningEffort === 'high' ||
    config.reasoningEffort === 'xhigh' ||
    config.reasoningEffort === 'max'
      ? config.reasoningEffort
      : 'auto';

  return { temperature, reasoningEffort };
}

function normalizeAgentApiMode(value: unknown): OpenAICompatibleApiMode {
  return value === 'responses' ? 'responses' : 'chat_completions';
}

function normalizeLibraryAgentModelPreset(preset: QaModelPreset): QaModelPreset {
  return {
    ...preset,
    apiMode: normalizeAgentApiMode((preset as Partial<QaModelPreset>).apiMode),
  };
}

function normalizeStoredReaderSettings(value: Partial<ReaderSettings>): Pick<
  ReaderSettings,
  | 'localRagEnabled'
  | 'localRagTopK'
  | 'ragSourceMode'
  | 'embeddingBaseUrl'
  | 'embeddingModel'
  | 'embeddingDimensions'
  | 'embeddingRequestTimeoutSeconds'
  | 'embeddingBatchSize'
> {
  return {
    localRagEnabled: value.localRagEnabled !== false,
    localRagTopK:
      typeof value.localRagTopK === 'number' && Number.isFinite(value.localRagTopK)
        ? Math.max(1, Math.min(12, Math.trunc(value.localRagTopK)))
        : 6,
    ragSourceMode:
      value.ragSourceMode === 'off' ||
      value.ragSourceMode === 'mineru-markdown' ||
      value.ragSourceMode === 'pdf-text' ||
      value.ragSourceMode === 'hybrid'
        ? value.ragSourceMode
        : 'hybrid',
    embeddingBaseUrl: value.embeddingBaseUrl?.trim() || 'https://api.openai.com',
    embeddingModel: value.embeddingModel?.trim() || 'text-embedding-3-small',
    embeddingDimensions:
      typeof value.embeddingDimensions === 'number' && Number.isFinite(value.embeddingDimensions)
        ? Math.max(1, Math.min(4096, Math.trunc(value.embeddingDimensions)))
        : null,
    embeddingRequestTimeoutSeconds:
      typeof value.embeddingRequestTimeoutSeconds === 'number' &&
      Number.isFinite(value.embeddingRequestTimeoutSeconds)
        ? Math.max(10, Math.min(600, Math.trunc(value.embeddingRequestTimeoutSeconds)))
        : 180,
    embeddingBatchSize:
      typeof value.embeddingBatchSize === 'number' && Number.isFinite(value.embeddingBatchSize)
        ? Math.max(1, Math.min(128, Math.trunc(value.embeddingBatchSize)))
        : 24,
  };
}

export async function loadLibraryAgentModelPreset(): Promise<LibraryAgentModelPreset | null> {
  return loadLibraryAgentModelPresetById();
}

export async function loadLibraryAgentModelPresetById(
  preferredPresetId?: string | null,
): Promise<LibraryAgentModelPreset | null> {
  const persistedConfig = await loadPersistedReaderConfig();
  const storedSettings = readStorageJson<ReaderSettings>(SETTINGS_STORAGE_KEY);
  const storedSecrets = readStorageJson<ReaderSecrets>(SECRETS_STORAGE_KEY);
  const settings = {
    ...(persistedConfig?.settings ?? {}),
    ...storedSettings,
  };
  const secrets = {
    ...(persistedConfig?.secrets ?? {}),
    ...storedSecrets,
  };
  const presets = Array.isArray(secrets.qaModelPresets)
    ? secrets.qaModelPresets.map(normalizeLibraryAgentModelPreset)
    : [];
  const preferredId =
    preferredPresetId ||
    settings.agentModelPresetId ||
    settings.qaActivePresetId ||
    settings.summaryModelPresetId ||
    settings.translationModelPresetId ||
    presets[0]?.id;

  const preset = presets.find((item) => item.id === preferredId) ?? presets[0] ?? null;

  if (!preset) {
    return null;
  }

  const runtimeConfig = normalizeAgentRuntimeConfig(settings);

  return {
    ...preset,
    temperature: runtimeConfig.temperature,
    reasoningEffort: runtimeConfig.reasoningEffort,
  };
}

export async function loadLibraryAgentAvailableModelPresets(): Promise<QaModelPreset[]> {
  const persistedConfig = await loadPersistedReaderConfig();
  const storedSecrets = readStorageJson<ReaderSecrets>(SECRETS_STORAGE_KEY);
  const secrets = {
    ...(persistedConfig?.secrets ?? {}),
    ...storedSecrets,
  };

  return Array.isArray(secrets.qaModelPresets)
    ? secrets.qaModelPresets.map(normalizeLibraryAgentModelPreset)
    : [];
}

function normalizeAgentContext(value: string): string {
  return value.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function buildAgentInstructionWithHistory(
  instruction: string,
  historyMessages: LibraryAgentConversationMessage[] = [],
): string {
  const history = historyMessages
    .filter((message) => message.content.trim())
    .slice(-12)
    .map((message) => {
      const paperScopeSection = message.paperScopeIds?.length
        ? `\n[Paper scope IDs]\n${message.paperScopeIds.join(', ')}`
        : '';
      const attachmentSection = message.attachments?.length
        ? `\n[Attachments]\n${message.attachments
          .map((attachment) => {
            const details = [
              attachment.summary?.trim(),
              attachment.textContent?.trim(),
            ].filter(Boolean).join('\n');

            return details ? `${attachment.name}\n${details}` : attachment.name;
          })
          .join('\n\n')}`
        : '';

      return `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.content.trim()}${paperScopeSection}${attachmentSection}`;
    })
    .join('\n\n');

  if (!history) {
    return instruction;
  }

  return [
    'Recent conversation in the current Agent window:',
    history,
    '',
    'Current user request. This request has priority over the history above:',
    instruction,
  ].join('\n');
}

function stripAgentHistoryAttachmentData(
  attachments: DocumentChatAttachment[] | undefined,
): DocumentChatAttachment[] | undefined {
  if (!attachments?.length) {
    return undefined;
  }

  return attachments.map(({ dataUrl: _dataUrl, ...attachment }) => attachment);
}

function buildReActAgentMessages({
  instruction,
  historyMessages,
  responseLanguage,
  papers,
  categories,
  currentPaperScopeIds,
  paperScopes,
  attachments,
  memoryContext,
}: {
  instruction: string;
  historyMessages: LibraryAgentConversationMessage[];
  responseLanguage?: string;
  papers: LibraryAgentPaperInput[];
  categories: LibraryAgentCategoryInput[];
  currentPaperScopeIds: string[];
  paperScopes: LibraryAgentPaperScopeInput[];
  attachments?: DocumentChatAttachment[];
  memoryContext?: { topics: string; synthesis: string };
}): AgentLoopMessage[] {
  const scopedPaperIds = new Set(currentPaperScopeIds);
  const orderedPapers = [
    ...papers.filter((paper) => scopedPaperIds.has(paper.id)),
    ...papers.filter((paper) => !scopedPaperIds.has(paper.id)),
  ].slice(0, MAX_REACT_INITIAL_PAPERS);
  let remainingContextChars = MAX_REACT_INITIAL_CONTEXT_CHARS;
  const payloadPapers = orderedPapers.map((paper) => {
    const contextText = paper.contextText?.slice(0, Math.max(0, remainingContextChars)) ?? null;
    remainingContextChars -= contextText?.length ?? 0;

    return {
      ...paper,
      contextText,
    };
  });
  const context = {
    responseLanguage,
    currentPaperScopeIds,
    paperScopes,
    categories,
    papers: payloadPapers,
    truncatedPaperCount: Math.max(0, papers.length - payloadPapers.length),
  };

  return [
    {
      role: 'system',
      content: [
        AGENT_CITATION_PROTOCOL,
        buildAgentDeliveryQualityPrompt(deriveAgentDeliveryRequirement({ instruction, historyMessages })),
        'For write requests, call exactly one matching write tool with reviewable items. The user must approve before application.',
        'Notebook workflows: to turn scattered excerpts into a close-reading card, first use search_notes with pageKind="excerpt" and the target paperId; to turn cross-paper excerpts into a concept page, use pageKind="excerpt" plus the topic keyword or tag. Create the result with write_notes using pageKind="paper-card" or "concept". Every substantive point must link back to the exact excerpt title with [[title]].',
        'Notebook citation rule: paper citations in generated notes must be paperReference nodes reconstructed by the shared Markdown parser from [n] plus a unique ## 参考文献 entry containing the real paper title or DOI. Never hand-write citation prose or citation numbers as a substitute for paperReference. Do not alter source excerpt anchors, snapshots, or “我的想法”; aggregation is additive and reviewable through write_notes.',
        'Notebook health repair: when given a health report, create a write_notes repair plan and wait for approval. Prefer reconnecting broken links by existing noteId, and never guess a replacement title. Delete-like cleanup is report-only by default: list candidates and do not emit delete operations unless the user explicitly approves deletion.',
        'System pages are maintained after approved note writes: log is appended, while index and overview refresh every five successful note operations. Do not overwrite a system page that has been manually edited.',
        'When writing LaTeX math, every backslash command must be separated from a following letter by a space: write "\\pi r^2", "\\Omega r", "\\sigma C_{d_0}", "\\sum T_{z,i}", "\\times a_z", "\\int V_x\\,dt" — never "\\pir", "\\Omegar", "\\sigmaC_{d_0}", "\\sumT_{z,i}", "\\timesa_z" (glued commands are undefined and render in red). Wrap multi-character sub/superscripts in braces (x_{cg}, C_T^{2}) and use \\mathrm{} for word-like subscripts (P_{\\mathrm{induced}}).',
        // 工作记忆注入（方案第 6.3 节）：政策句始终在；L2/L3 正文仅在非空时附加、各截 1_200 字符；
        // 本地文件超长时不落盘截断，只截断注入并追加提示行。
        buildWorkingMemoryInjection({
          topics: memoryContext?.topics ?? '',
          synthesis: memoryContext?.synthesis ?? '',
        }),
        `[PaperQuay library payload]\n${JSON.stringify(context)}`,
      ].join('\n\n'),
    },
    ...historyMessages
      .filter((message) => message.content.trim())
      .slice(-12)
      .map((message): AgentLoopMessage => ({
        role: message.role,
        content: message.content.trim(),
        toolCallId: undefined,
        attachments: stripAgentHistoryAttachmentData(message.attachments),
      })),
    {
      role: 'user',
      content: instruction,
      attachments,
    },
  ];
}

function fallbackSummaryContext(paper: LiteraturePaper): PaperContextPayload {
  const sections = [
    paper.aiSummary?.trim() ? `AI overview:\n${paper.aiSummary.trim()}` : '',
    paper.abstractText?.trim() ? `Abstract:\n${paper.abstractText.trim()}` : '',
    paper.userNote?.trim() ? `User note:\n${paper.userNote.trim()}` : '',
  ].filter(Boolean);

  return {
    source: sections.length > 0 ? 'summary' : 'metadata',
    text: sections.join('\n\n'),
  };
}

function paperToWorkspaceItem(paper: LiteraturePaper): WorkspaceItem | null {
  const pdfPath = paperPdfPath(paper);

  if (!pdfPath) {
    return null;
  }

  return {
    itemKey: paper.id,
    title: paper.title,
    creators: paperAuthors(paper).join(', '),
    year: paper.year ?? '',
    itemType: 'pdf',
    attachmentFilename: pdfPath.split(/[\\/]/).pop() || 'paper.pdf',
    localPdfPath: pdfPath,
    source: 'native-library',
    workspaceId: `native-library:${paper.id}`,
    groupKey: `native-library:${paper.id}`,
  };
}

interface AgentDocumentContextSettings {
  autoLoadSiblingJson: boolean;
  mineruCacheDir: string;
}

interface MineruAgentContext {
  source: string;
  text: string;
  blocks: PositionedMineruBlock[];
  figures: LibraryPaperReviewFigure[];
}

function isLocalReviewFigureAssetPath(value: string): boolean {
  return Boolean(value.trim()) && !/^(?:https?|cloud):/i.test(value);
}

function collectMineruReviewFigures(
  blocks: PositionedMineruBlock[],
  mineruPath: string,
): LibraryPaperReviewFigure[] {
  const figures: LibraryPaperReviewFigure[] = [];

  for (const block of blocks) {
    if (block.type !== 'image' && block.type !== 'table') {
      continue;
    }

    const relativeAssetPath = extractMineruAssetPathFromBlock(block);
    const assetPath = relativeAssetPath
      ? resolveMineruAssetPath(mineruPath, relativeAssetPath)
      : undefined;

    if (!assetPath || !isLocalReviewFigureAssetPath(assetPath)) {
      continue;
    }

    const caption = extractCaptionFromMineruBlock(block).trim();
    const kindLabel = block.type === 'table' ? 'Table' : 'Figure';
    const pageLabel = block.pageIndex >= 0 ? `page ${block.pageIndex + 1}` : 'source document';

    figures.push({
      id: `F${figures.length + 1}`,
      caption: caption || `${kindLabel} from ${pageLabel}`,
      path: assetPath,
      pageIndex: block.pageIndex,
      blockId: block.blockId,
      kind: block.type,
    });
  }

  return figures;
}

function normalizeAgentDocumentContextSettings(settings: Partial<ReaderSettings>): AgentDocumentContextSettings {
  return {
    autoLoadSiblingJson: settings.autoLoadSiblingJson === true,
    mineruCacheDir: settings.mineruCacheDir?.trim() || '',
  };
}

async function loadAgentSettingsAndSecrets(): Promise<{
  settings: Partial<ReaderSettings>;
  secrets: Partial<ReaderSecrets>;
}> {
  const persistedConfig = await loadPersistedReaderConfig();
  const storedSettings = readStorageJson<ReaderSettings>(SETTINGS_STORAGE_KEY);
  const storedSecrets = readStorageJson<ReaderSecrets>(SECRETS_STORAGE_KEY);

  return {
    settings: {
      ...(persistedConfig?.settings ?? {}),
      ...storedSettings,
    },
    secrets: {
      ...(persistedConfig?.secrets ?? {}),
      ...storedSecrets,
    },
  };
}

function mineruMarkdownCandidatePaths(item: WorkspaceItem, settings: AgentDocumentContextSettings): string[] {
  const candidates = new Set<string>();

  if (settings.mineruCacheDir) {
    for (const cachePaths of buildMineruCachePathCandidates(settings.mineruCacheDir, item)) {
      candidates.add(cachePaths.markdownPath);
    }
  }

  if (item.localPdfPath && settings.autoLoadSiblingJson) {
    candidates.add(guessSiblingMarkdownPath(item.localPdfPath));
  }

  return [...candidates];
}

function mineruJsonCandidatePaths(item: WorkspaceItem, settings: AgentDocumentContextSettings): string[] {
  const candidates = new Set<string>();

  if (settings.mineruCacheDir) {
    for (const cachePaths of buildMineruCachePathCandidates(settings.mineruCacheDir, item)) {
      for (const candidatePath of getMineruJsonPathCandidates(cachePaths)) {
        candidates.add(candidatePath);
      }
    }
  }

  if (item.localPdfPath && settings.autoLoadSiblingJson) {
    for (const candidatePath of guessSiblingJsonPaths(item.localPdfPath)) {
      candidates.add(candidatePath);
    }
  }

  return [...candidates];
}

async function loadMineruAgentContext(
  item: WorkspaceItem,
  settings: AgentDocumentContextSettings,
): Promise<MineruAgentContext | null> {
  let markdownContext: MineruAgentContext | null = null;

  for (const candidatePath of mineruMarkdownCandidatePaths(item, settings)) {
    try {
      const text = await readLocalTextFileIfExists(candidatePath);

      if (text?.trim()) {
        markdownContext = {
          source: 'mineru-markdown',
          text: normalizeAgentContext(text),
          blocks: [],
          figures: [],
        };
        break;
      }
    } catch {
      continue;
    }
  }

  for (const candidatePath of mineruJsonCandidatePaths(item, settings)) {
    try {
      const jsonText = await readLocalTextFileIfExists(candidatePath);

      if (!jsonText?.trim()) {
        continue;
      }

      const blocks = flattenMineruPages(parseMineruPages(jsonText));
      const markdown = buildMineruMarkdownDocument(blocks, candidatePath);
      const figures = collectMineruReviewFigures(blocks, candidatePath);

      if (markdown.trim() || figures.length > 0) {
        return {
          source: 'mineru-json',
          text: normalizeAgentContext(markdown),
          blocks,
          figures,
        };
      }
    } catch {
      continue;
    }
  }

  return markdownContext;
}

async function loadPaperContext(
  paper: LiteraturePaper,
  mode: LibraryAgentContextRequest['mode'],
  requestReason: string,
  options?: {
    ragEnabled?: boolean;
    signal?: AbortSignal;
  },
): Promise<PaperContextPayload> {
  if (options?.signal?.aborted) {
    const error = new Error('Context loading aborted');
    error.name = 'AbortError';
    throw error;
  }

  if (mode === 'summary') {
    const context = fallbackSummaryContext(paper);

    return {
      ...context,
      text: normalizeAgentContext(context.text),
    };
  }

  const pdfPath = paperPdfPath(paper);

  if (!pdfPath) {
    const fallback = fallbackSummaryContext(paper);

    return {
      source: `${fallback.source}-fallback-no-pdf`,
      text: normalizeAgentContext(fallback.text),
      retrievalOutcome: 'unavailable',
    };
  }

  try {
    const { settings, secrets } = await loadAgentSettingsAndSecrets();
    const documentContextSettings = normalizeAgentDocumentContextSettings(settings);
    const ragSettings = normalizeStoredReaderSettings(settings);
    const workspaceItem = paperToWorkspaceItem(paper);
    const mineruContext = workspaceItem
      ? await loadMineruAgentContext(workspaceItem, documentContextSettings)
      : null;
    let normalizedPdfText = '';

    if (!mineruContext || ragSettings.ragSourceMode === 'pdf-text') {
      if (options?.signal?.aborted) {
        const error = new Error('Context loading aborted');
        error.name = 'AbortError';
        throw error;
      }
      try {
        const pdfData = await readLocalBinaryFile(pdfPath);
        const pdfText = await extractPdfTextByPdfJs(pdfData);
        normalizedPdfText = normalizeAgentContext(pdfText);
      } catch (error) {
        if (options?.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
        console.warn('Failed to load Agent PDF context', error);
      }
    }

    let ragError: string | null = null;
    let retrievalOutcome: SurveyPaperRetrievalOutcome = 'unavailable';

    if (
      options?.ragEnabled !== false &&
      workspaceItem &&
      (normalizedPdfText || (mineruContext?.text && mineruContext.blocks.length > 0)) &&
      secrets.embeddingApiKey?.trim() &&
      ragSettings.embeddingBaseUrl.trim() &&
      ragSettings.embeddingModel.trim()
    ) {
      if (options?.signal?.aborted) {
        const error = new Error('Context loading aborted');
        error.name = 'AbortError';
        throw error;
      }
      try {
        const ragResolution = await resolveLocalRag({
          item: workspaceItem,
          settings: ragSettings,
          embedding: {
            baseUrl: ragSettings.embeddingBaseUrl,
            apiKey: secrets.embeddingApiKey.trim(),
            model: ragSettings.embeddingModel,
            dimensions: ragSettings.embeddingDimensions,
            timeoutSeconds: ragSettings.embeddingRequestTimeoutSeconds,
          },
          question: requestReason,
          mineruBlocks: mineruContext?.blocks ?? [],
          mineruDocumentText: mineruContext?.text ?? '',
          pdfDocumentText: normalizedPdfText,
          signal: options?.signal,
          syncIndexing: false,
        });

        if (ragResolution.kind === 'retrieved' && ragResolution.documentText.trim()) {
          const figures = mineruContext?.figures ?? [];
          return {
            source: `${mineruContext?.source ?? 'pdf-text'}-rag`,
            retrievalOutcome: 'hit',
            text: normalizeAgentContext(ragResolution.documentText),
            citations: buildAgentRagCitations(paper, ragResolution.citations),
            figures,
            visionCandidates: matchRagVisionCandidates({
              paperId: paper.id,
              paperTitle: paper.title,
              figures,
              retrievals: ragResolution.retrievals,
            }),
          };
        }

        if (ragResolution.kind === 'failed') {
          retrievalOutcome = 'failed';
          ragError = ragResolution.errorMessage?.trim() || '本地 RAG 检索失败';
        } else if (ragResolution.kind === 'empty') {
          retrievalOutcome = 'empty';
        }
      } catch (error) {
        if (options?.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
        retrievalOutcome = 'failed';
        ragError = error instanceof Error ? error.message : String(error);
        console.warn('Failed to build local Agent RAG context', error);
      }
    }

    if (mineruContext?.text) {
      return {
        source: mineruContext.source,
        text: mineruContext.text,
        figures: mineruContext.figures,
        ragError,
        retrievalOutcome,
      };
    }

    if (normalizedPdfText) {
      return {
        source: 'pdf-text',
        text: normalizedPdfText,
        figures: mineruContext?.figures ?? [],
        ragError,
        retrievalOutcome,
      };
    }
  } catch (error) {
    if (options?.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
    console.warn('Failed to load Agent document context', error);
  }

  const fallback = fallbackSummaryContext(paper);

  return {
    source: `${fallback.source}-fallback-pdf-error`,
    text: normalizeAgentContext(fallback.text),
    retrievalOutcome: 'unavailable',
  };
}

export async function loadLibraryPaperReviewContext({
  paper,
  intent,
  ragEnabled = true,
}: {
  paper: LiteraturePaper;
  intent: string;
  ragEnabled?: boolean;
}): Promise<LibraryPaperReviewContext> {
  const context = await loadPaperContext(
    paper,
    'pdf-text',
    intent.trim() || 'Literature review context retrieval.',
    { ragEnabled },
  );

  return {
    paperId: paper.id,
    source: context.source,
    text: context.text,
    citations: context.citations,
    figures: context.figures,
  };
}

async function buildPapersWithRequestedContext(
  papers: LiteraturePaper[],
  request: LibraryAgentContextRequest,
  options?: {
    ragEnabled?: boolean;
    categoryPathById?: Map<string, string>;
  },
): Promise<{
  inputs: LibraryAgentPaperInput[];
  label: string;
  citations: LibraryAgentRagCitation[];
  ragErrors: string[];
  contexts: Map<string, PaperContextPayload>;
}> {
  const requestedIds = new Set((Array.isArray(request.paperIds) ? request.paperIds : []).filter(Boolean));
  const requestedPapers = requestedIds.size > 0
    ? papers.filter((paper) => requestedIds.has(paper.id))
    : [];
  // A non-empty request that resolves to no papers is an empty result, not a
  // reason to widen the context back to the whole library.
  const targetPapers = requestedIds.size > 0 ? requestedPapers : papers;
  const targetIds = new Set(targetPapers.map((paper) => paper.id));
  const contextByPaperId = new Map<string, PaperContextPayload>();
  const contextMode: LibraryAgentContextRequest['mode'] = request.mode === 'pdf-text' ? 'pdf-text' : 'summary';
  const requestReason = request.reason?.trim() || 'Selected paper context requested by the Agent.';

  for (const paper of targetPapers) {
    contextByPaperId.set(
      paper.id,
      await loadPaperContext(paper, contextMode, requestReason, options),
    );
  }

  const normalizedContextByPaperId = new Map<string, PaperContextPayload>();
  const citations: LibraryAgentRagCitation[] = [];
  let citationOffset = 0;

  for (const paper of targetPapers) {
    const context = contextByPaperId.get(paper.id);

    if (!context) {
      continue;
    }

    const normalizedContext = renumberPaperContextCitations(context, citationOffset);
    citationOffset += normalizedContext.citations?.length ?? 0;
    normalizedContextByPaperId.set(paper.id, normalizedContext);
    citations.push(...(normalizedContext.citations ?? []));
  }

  const sourceCounts = new Map<string, number>();

  for (const context of normalizedContextByPaperId.values()) {
    sourceCounts.set(context.source, (sourceCounts.get(context.source) ?? 0) + 1);
  }

  const label = [...sourceCounts.entries()]
    .map(([source, count]) => `${source} x${count}`)
    .join(', ') || 'metadata only';

  const ragErrors = [...new Set(
    [...normalizedContextByPaperId.values()]
      .map((context) => context.ragError?.trim())
      .filter((message): message is string => Boolean(message)),
  )];

  return {
    inputs: papers.map((paper) => paperToAgentInput(
      paper,
      targetIds.has(paper.id) ? normalizedContextByPaperId.get(paper.id) : undefined,
      options?.categoryPathById,
    )),
    label,
    citations,
    ragErrors,
    contexts: normalizedContextByPaperId,
  };
}

function categoryDisplayNameForAgent(category: LiteratureCategory): string {
  switch (category.systemKey) {
    case 'all':
      return 'All Papers';
    case 'recent':
      return 'Recently Imported';
    case 'uncategorized':
      return 'Uncategorized';
    case 'favorites':
      return 'Favorites';
    default:
      return category.name;
  }
}

function buildCategoryPathMap(categories: LiteratureCategory[]): Map<string, string> {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const pathById = new Map<string, string>();

  const resolvePath = (category: LiteratureCategory, seen = new Set<string>()): string => {
    const cached = pathById.get(category.id);

    if (cached) {
      return cached;
    }

    const name = categoryDisplayNameForAgent(category);

    if (!category.parentId || seen.has(category.id)) {
      pathById.set(category.id, name);
      return name;
    }

    seen.add(category.id);
    const parent = categoryById.get(category.parentId);
    const path = parent ? `${resolvePath(parent, seen)} / ${name}` : name;
    pathById.set(category.id, path);
    return path;
  };

  for (const category of categories) {
    resolvePath(category);
  }

  return pathById;
}

function categoriesToAgentInputs(
  categories: LiteratureCategory[],
  categoryPathById = buildCategoryPathMap(categories),
): LibraryAgentCategoryInput[] {
  return categories.map((category) => ({
    id: category.id,
    name: categoryDisplayNameForAgent(category),
    path: categoryPathById.get(category.id) ?? categoryDisplayNameForAgent(category),
    parentId: category.parentId,
    paperCount: category.paperCount,
  }));
}

function buildAgentCategoryPayload(categories: LiteratureCategory[] = []) {
  const categoryPathById = buildCategoryPathMap(categories);

  return {
    categories: categoriesToAgentInputs(categories, categoryPathById),
    categoryPathById,
  };
}

function isInsufficientMetadataOnlyAnswer(answer: string): boolean {
  const normalized = answer.toLocaleLowerCase();
  const metadataOnlySignals = [
    '仅基于论文标题',
    '仅基于标题',
    '仅基于元数据',
    '基于论文标题、标签和元数据',
    '未读取到全文',
    '未读取全文',
    '未读取到摘要',
    '未读取摘要',
    '建议加载',
    '仅基于论文标题',
    '仅基于标题',
    '仅基于元数据',
    '基于论文标题、标签和元数据',
    '未读取到全文',
    '未读取全文',
    '未读取到摘要',
    '未读取摘要',
    '建议加载',
    'load the abstract',
    'load abstracts',
    'load the pdf',
    'load pdf',
    'metadata only',
    'titles and metadata',
  ];

  return metadataOnlySignals.filter((signal) => normalized.includes(signal.toLocaleLowerCase())).length >= 2;
}

function currentScopePapers(papers: LiteraturePaper[], currentPaperScopeIds: string[] = []): LiteraturePaper[] {
  if (currentPaperScopeIds.length === 0) {
    return papers;
  }

  const idSet = new Set(currentPaperScopeIds);
  const scopedPapers = papers.filter((paper) => idSet.has(paper.id));

  return scopedPapers;
}

function uniqueAvailablePaperIds(
  ids: Array<string | null | undefined>,
  availablePaperIds: Set<string>,
): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const rawId of ids) {
    const id = rawId?.trim();

    if (!id || seen.has(id) || !availablePaperIds.has(id)) {
      continue;
    }

    seen.add(id);
    normalized.push(id);
  }

  return normalized;
}

function buildEffectiveContextRequest(
  request: LibraryAgentContextRequest | null | undefined,
  papers: LiteraturePaper[],
  currentPaperScopeIds: string[] = [],
): LibraryAgentContextRequest | null {
  const availablePaperIds = new Set(papers.map((paper) => paper.id));
  const requestedPaperIds = uniqueAvailablePaperIds(request?.paperIds ?? [], availablePaperIds);
  const currentPaperIds = uniqueAvailablePaperIds(currentPaperScopeIds, availablePaperIds);
  const paperIds = requestedPaperIds.length > 0 ? requestedPaperIds : currentPaperIds;

  if (!request && paperIds.length === 0) {
    return null;
  }

  return {
    summary: request?.summary?.trim() || 'Use the papers already selected for this turn.',
    mode: request?.mode === 'pdf-text' ? 'pdf-text' : 'summary',
    reason: request?.reason?.trim() || 'The user already selected the target papers, so PaperQuay should load context for that scope.',
    paperIds,
  };
}

function buildEmptyAgentAnswerFallback(
  papers: LiteraturePaper[],
  responseLanguage?: string,
): string {
  const useEnglish = responseLanguage?.toLocaleLowerCase().includes('english') ?? false;
  const scopedPapers = papers.slice(0, 6);

  if (useEnglish) {
    if (scopedPapers.length === 0) {
      return 'The model returned no usable content. Please restate the request with the target papers or the exact change you want.';
    }

    return [
      `I have ${papers.length} paper(s) in the current scope, but the request still needs the exact change to apply.`,
      'Please provide the new title for each paper, or a clear rename rule such as adding a prefix/suffix.',
      scopedPapers.map((paper, index) => `${index + 1}. ${paper.title}`).join('\n'),
    ].join('\n\n');
  }

  if (scopedPapers.length === 0) {
    return '模型没有返回可用内容。请重新说明目标论文，或补充你希望执行的具体修改。';
  }

  return [
    `当前范围内有 ${papers.length} 篇论文，但还需要你补充具体要怎么改。`,
    '请提供每篇论文的新标题，或给出统一规则，例如“标题前加已读”“去掉标题里的 PDF 编号”“改成 DOI 查询到的正式标题”。',
    scopedPapers.map((paper, index) => `${index + 1}. ${paper.title}`).join('\n'),
  ].join('\n\n');
}

function isLikelyContextSizeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const normalized = message.toLocaleLowerCase();

  return [
    'context length',
    'maximum context',
    'too many tokens',
    'token limit',
    'request too large',
    'payload too large',
    '413',
  ].some((signal) => normalized.includes(signal));
}

function paperSelectionResultFromContextRequest(
  request: LibraryAgentContextRequest | null | undefined,
  instruction: string,
  thinking?: string | null,
): LibraryAgentRunResult {
  const mode = request?.mode === 'pdf-text' ? 'pdf-text' : 'summary';
  const summary = request?.summary?.trim() || '需要先选择要提供给模型的文献。';
  const reason = request?.reason?.trim() || '当前任务需要论文上下文，但本轮还没有明确的目标文献。';

  return {
    kind: 'paper-selection',
    answer: [summary, reason].filter(Boolean).join('\n\n'),
    request: {
      summary,
      mode,
      reason,
      instruction,
    },
    thinking,
  };
}

function normalizeModelThinking(value: string | null | undefined): string | null {
  const normalized = value?.replace(/<\/?think\b[^>]*>/gi, '').trim();
  return normalized || null;
}

function paperToAgentInput(
  paper: LiteraturePaper,
  context?: PaperContextPayload,
  categoryPathById?: Map<string, string>,
): LibraryAgentPaperInput {
  const categoryPaths = paper.categoryIds.map((id) => categoryPathById?.get(id) ?? id);

  return {
    id: paper.id,
    title: paper.title,
    authors: paperAuthors(paper),
    year: paper.year,
    publication: paper.publication,
    doi: paper.doi,
    url: paper.url,
    abstractText: paper.abstractText,
    aiSummary: paper.aiSummary,
    userNote: paper.userNote,
    contextSource: context?.source ?? null,
    contextText: context?.text ?? null,
    keywords: paper.keywords,
    tags: paper.tags.map((tag) => tag.name).filter(Boolean),
    categoryIds: paper.categoryIds,
    categories: categoryPaths.map((path) => {
      const segments = path.split(' / ');
      return segments[segments.length - 1] ?? path;
    }),
    categoryPaths,
  };
}

function describePaperState(paper: LiteraturePaper): string {
  return [
    paper.title,
    paperAuthors(paper).join(', '),
    paper.year,
    paper.publication,
    paper.doi,
    paper.tags.length > 0 ? `tags: ${paper.tags.map((tag) => tag.name).join('、')}` : '',
  ].filter(Boolean).join(' · ');
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function firstStringFromRecord(
  record: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = stringValue(record[key]);

    if (value) {
      return value;
    }
  }

  return undefined;
}

function stringArrayValue(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => stringValue(item))
      .filter((item): item is string => Boolean(item));

    return items.length > 0 ? items : undefined;
  }

  if (typeof value === 'string' && value.trim()) {
    const items = value
      .split(/[,\n;；、]/)
      .map((item) => item.trim())
      .filter(Boolean);

    return items.length > 0 ? items : undefined;
  }

  return undefined;
}

function firstStringArrayFromRecord(
  record: Record<string, unknown>,
  keys: string[],
): string[] | undefined {
  for (const key of keys) {
    const value = stringArrayValue(record[key]);

    if (value) {
      return value;
    }
  }

  return undefined;
}

function firstObjectFromRecord(
  record: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> | undefined {
  for (const key of keys) {
    const value = record[key];

    if (isObjectRecord(value)) {
      return value;
    }
  }

  return undefined;
}

function isLibraryAgentTool(value: string): value is LibraryAgentTool {
  return ['rename', 'metadata', 'smart-tags', 'clean-tags', 'classify'].includes(value);
}

function normalizeGeneratedTool(
  value: string | null | undefined,
  fallbackTool: string | null | undefined,
): LibraryAgentTool {
  const aliases: Record<string, LibraryAgentTool> = {
    rename: 'rename',
    rename_papers: 'rename',
    batch_rename: 'rename',
    metadata: 'metadata',
    update_paper_metadata: 'metadata',
    metadata_completion: 'metadata',
    smart_tags: 'smart-tags',
    smart_tag: 'smart-tags',
    'smart-tags': 'smart-tags',
    update_paper_tags: 'smart-tags',
    clean_tags: 'clean-tags',
    clean_tag: 'clean-tags',
    'clean-tags': 'clean-tags',
    clean_paper_tags: 'clean-tags',
    classify: 'classify',
    classification: 'classify',
    classify_papers: 'classify',
    auto_classify: 'classify',
  };
  const candidates = [value, fallbackTool]
    .map((item) => item?.trim())
    .filter((item): item is string => Boolean(item));

  for (const candidate of candidates) {
    const normalized = candidate.toLocaleLowerCase().replace(/\s+/g, '_');
    const tool = aliases[normalized] ?? aliases[normalized.replace(/-/g, '_')];

    if (tool) {
      return tool;
    }

    if (isLibraryAgentTool(candidate)) {
      return candidate;
    }
  }

  return 'classify';
}

function generatedPlanItems(generatedPlan: LibraryAgentGeneratedPlan): LibraryAgentGeneratedItem[] {
  const record = generatedPlan as Record<string, unknown>;
  const args = firstObjectFromRecord(record, ['arguments', 'parameters', 'args']);
  const candidates = [
    generatedPlan.items,
    generatedPlan.updates,
    generatedPlan.paperUpdates,
    generatedPlan.papers,
    record.paper_items,
    record.paperUpdates,
    args?.items,
    args?.updates,
    args?.paperUpdates,
    args?.papers,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(isObjectRecord) as LibraryAgentGeneratedItem[];
    }
  }

  return [];
}

function generatedPlanTool(generatedPlan: LibraryAgentGeneratedPlan): string | null | undefined {
  const record = generatedPlan as Record<string, unknown>;
  const args = firstObjectFromRecord(record, ['arguments', 'parameters', 'args']);

  return (
    stringValue(generatedPlan.tool) ||
    firstStringFromRecord(record, ['tool', 'name', 'functionName']) ||
    (args ? firstStringFromRecord(args, ['tool', 'name', 'functionName']) : undefined)
  );
}

function generatedPaperId(item: LibraryAgentGeneratedItem): string | undefined {
  const record = item as Record<string, unknown>;

  return firstStringFromRecord(record, [
    'paperId',
    'paperID',
    'paper_id',
    'id',
    'itemId',
    'item_id',
  ]);
}

function normalizeGeneratedPaperUpdate(value: unknown): LibraryAgentPaperUpdate | undefined {
  if (typeof value === 'string' && value.trim()) {
    return { title: value.trim() };
  }

  if (!isObjectRecord(value)) {
    return undefined;
  }

  const update: LibraryAgentPaperUpdate = {};
  const title = firstStringFromRecord(value, [
    'title',
    'newTitle',
    'targetTitle',
    'updatedTitle',
    'after',
    'afterTitle',
    'titleAfter',
  ]);
  const year = firstStringFromRecord(value, ['year', 'publicationYear']);
  const publication = firstStringFromRecord(value, ['publication', 'venue', 'journal', 'conference']);
  const doi = firstStringFromRecord(value, ['doi', 'DOI']);
  const url = firstStringFromRecord(value, ['url', 'URL', 'link']);
  const abstractText = firstStringFromRecord(value, ['abstractText', 'abstract', 'summary']);
  const keywords = firstStringArrayFromRecord(value, ['keywords', 'keyword']);
  const tags = firstStringArrayFromRecord(value, ['tags', 'tagNames', 'tag']);
  const authors = firstStringArrayFromRecord(value, ['authors', 'creators']);

  if (title) update.title = title;
  if (year) update.year = year;
  if (publication) update.publication = publication;
  if (doi) update.doi = doi;
  if (url) update.url = url;
  if (abstractText) update.abstractText = abstractText;
  if (keywords) update.keywords = keywords;
  if (tags) update.tags = tags;
  if (authors) update.authors = authors;

  return Object.keys(update).length > 0 ? update : undefined;
}

function inferRenameTitleFromGeneratedItem(
  paper: LiteraturePaper,
  item: LibraryAgentGeneratedItem,
): string | undefined {
  const record = item as Record<string, unknown>;
  const title = firstStringFromRecord(record, [
    'after',
    'newTitle',
    'targetTitle',
    'updatedTitle',
    'afterTitle',
    'titleAfter',
  ]);

  if (!title || title === paper.title) {
    return undefined;
  }

  return title;
}

function updateRequestFromGeneratedAgentItem(
  paper: LiteraturePaper,
  item: LibraryAgentGeneratedItem,
  tool: LibraryAgentTool,
): UpdatePaperRequest | undefined {
  const record = item as Record<string, unknown>;
  const explicitUpdate =
    normalizeGeneratedPaperUpdate(record.update) ??
    normalizeGeneratedPaperUpdate(record.updateRequest) ??
    normalizeGeneratedPaperUpdate(record.changes) ??
    normalizeGeneratedPaperUpdate(record.patch);

  if (tool !== 'rename') {
    return updateRequestFromAgentItem(paper, explicitUpdate);
  }

  const renameTitle = explicitUpdate?.title?.trim() || inferRenameTitleFromGeneratedItem(paper, item);

  return updateRequestFromAgentItem(paper, {
    ...(explicitUpdate ?? {}),
    title: renameTitle,
  });
}

function updateRequestFromAgentItem(
  paper: LiteraturePaper,
  update: LibraryAgentPaperUpdate | null | undefined,
): UpdatePaperRequest | undefined {
  if (!update) {
    return undefined;
  }

  const request: UpdatePaperRequest = { paperId: paper.id };
  let changed = false;
  const assignString = <Key extends keyof UpdatePaperRequest>(
    key: Key,
    currentValue: string | null,
    nextValue: string | null | undefined,
  ) => {
    let normalized = nextValue?.trim();

    if (
      key === 'title' &&
      normalized &&
      normalizeComparable(normalized) === normalizeComparable(stripKnownReadPrefix(paper.title))
    ) {
      normalized = stripKnownReadPrefix(paper.title);
    }

    if (!normalized || normalized === currentValue?.trim()) {
      return;
    }

    (request[key] as string | null | undefined) = normalized;
    changed = true;
  };
  const assignArray = <Key extends keyof UpdatePaperRequest>(
    key: Key,
    currentValue: string[],
    nextValue: string[] | null | undefined,
  ) => {
    const normalized = uniqueTags(nextValue ?? []);

    if (
      normalized.length === 0 ||
      normalized.join('\n').toLocaleLowerCase() === currentValue.join('\n').toLocaleLowerCase()
    ) {
      return;
    }

    (request[key] as string[] | undefined) = normalized;
    changed = true;
  };

  assignString('title', paper.title, update.title);
  assignString('year', paper.year, update.year);
  assignString('publication', paper.publication, update.publication);
  assignString('doi', paper.doi, update.doi);
  assignString('url', paper.url, update.url);
  assignString('abstractText', paper.abstractText, update.abstractText);
  assignArray('keywords', paper.keywords, update.keywords);
  assignArray('tags', paper.tags.map((tag) => tag.name), update.tags);

  const nextAuthors = update.authors?.map((author) => author.trim()).filter(Boolean) ?? [];

  if (
    nextAuthors.length > 0 &&
    nextAuthors.join('\n').toLocaleLowerCase() !== paperAuthors(paper).join('\n').toLocaleLowerCase()
  ) {
    request.authors = nextAuthors;
    changed = true;
  }

  return changed ? request : undefined;
}

function convertGeneratedAgentPlan(
  fallbackTool: LibraryAgentTool | string | null | undefined,
  papers: LiteraturePaper[],
  generatedPlan: LibraryAgentGeneratedPlan,
): LibraryAgentPlan {
  const tool = normalizeGeneratedTool(generatedPlanTool(generatedPlan), fallbackTool);
  const paperById = new Map(papers.map((paper) => [paper.id, paper]));
  const generatedItems = generatedPlanItems(generatedPlan);
  const items = generatedItems
    .map((item, index): LibraryAgentPlanItem | null => {
      const record = item as Record<string, unknown>;
      const paperId = generatedPaperId(item);
      const paper = paperId ? paperById.get(paperId) : undefined;

      if (!paper) {
        return null;
      }

      const updateRequest = updateRequestFromGeneratedAgentItem(paper, item, tool);
      const targetCategoryName = firstStringFromRecord(record, [
        'targetCategoryName',
        'categoryName',
        'collectionName',
        'targetCollectionName',
      ]);

      if (!updateRequest && !targetCategoryName) {
        return null;
      }

      const before = firstStringFromRecord(record, ['before', 'oldTitle', 'currentTitle', 'from']);
      const after = firstStringFromRecord(record, [
        'after',
        'newTitle',
        'targetTitle',
        'updatedTitle',
        'afterTitle',
        'titleAfter',
        'to',
      ]);

      return {
        id: `${paper.id}:${tool}:llm:${index}`,
        tool,
        paperId: paper.id,
        paperTitle: paper.title,
        title: firstStringFromRecord(record, ['title', 'label']) || 'Agent 工具调用',
        description: firstStringFromRecord(record, ['description', 'summary']) || '模型通过 tool call 生成的计划项。',
        before: before || describePaperState(paper),
        after:
          after ||
          [
            updateRequest?.title,
            updateRequest?.authors?.join(', '),
            updateRequest?.year,
            updateRequest?.publication,
            updateRequest?.doi,
            updateRequest?.tags ? `tags: ${updateRequest.tags.join('、')}` : '',
            targetCategoryName,
          ].filter(Boolean).join(' · '),
        updateRequest,
        targetCategoryName,
        targetCategoryParentName:
          firstStringFromRecord(record, ['targetCategoryParentName', 'categoryParentName', 'parentCategoryName']) ||
          AUTO_CLASSIFY_PARENT_NAME,
      };
    })
    .filter((item): item is LibraryAgentPlanItem => item !== null);

  return {
    id: newPlanId(tool),
    tool,
    title: `大模型工具调用：${generatedPlan.summary || tool}`,
    description: generatedPlan.summary || `模型返回 ${items.length} 个 tool call 计划项。`,
    items,
    createdAt: Date.now(),
  };
}

function agentAbortError(): Error {
  const error = new Error('Agent run aborted');
  error.name = 'AbortError';
  return error;
}

/** 主进程 IPC 调用无法直接接收 AbortSignal，改用 requestId + agent_chat_turn_cancel 实现取消。 */
function wireAgentTurnCancel(signal: AbortSignal | undefined, requestId: string): () => void {
  if (!signal) {
    return () => {};
  }

  const cancel = () => {
    void invoke('agent_chat_turn_cancel', { requestId }).catch(() => {});
  };

  if (signal.aborted) {
    cancel();
  }

  signal.addEventListener('abort', cancel, { once: true });
  return () => signal.removeEventListener('abort', cancel);
}

async function decideLibraryAgentPaperContextOpenAICompatible(
  options: OpenAICompatibleLibraryAgentOptions,
  signal?: AbortSignal,
): Promise<LibraryAgentPaperContextDecision | null> {
  if (!Array.isArray(options.papers) || options.papers.length === 0) {
    return null;
  }

  const requestId = crypto.randomUUID();
  const unwireCancel = wireAgentTurnCancel(signal, requestId);

  try {
    return await invoke<LibraryAgentPaperContextDecision>('decide_library_agent_paper_context_openai_compatible', {
      requestId,
      options,
    });
  } catch (error) {
    if (signal?.aborted) {
      throw agentAbortError();
    }
    console.warn('Failed to run paper-context decision', error);
    return null;
  } finally {
    unwireCancel();
  }
}

function recordAgentCitations(
  artifacts: AgentSessionArtifacts,
  citations: LibraryAgentRagCitation[] | undefined,
) {
  for (const citation of citations ?? []) {
    artifacts.citationTokens ??= [];
    const token = formatCitationEvidenceToken(citation);
    if (!artifacts.citationTokens.includes(token)) artifacts.citationTokens.push(token);
    const page = citation.pageIndex === null || citation.pageIndex === undefined
      ? citation.paperId
      : `${citation.paperId}#${citation.pageIndex + 1}`;

    if (!artifacts.citedPages.includes(page)) {
      artifacts.citedPages.push(page);
    }
  }
}

function recordToolPaperIds(artifacts: AgentSessionArtifacts, args: Record<string, unknown>) {
  const paperIds = [
    typeof args.paperId === 'string' ? args.paperId : '',
    ...(Array.isArray(args.paperIds) ? args.paperIds.filter((value): value is string => typeof value === 'string') : []),
  ].map((paperId) => paperId.trim()).filter(Boolean);

  for (const paperId of paperIds) {
    if (!artifacts.readPaperIds.includes(paperId)) {
      artifacts.readPaperIds.push(paperId);
    }
  }
}

export async function verifyLibraryAgentAnswerCitations(input: {
  answer: string;
  citations: LibraryAgentRagCitation[];
  preset: LibraryAgentModelPreset;
  signal?: AbortSignal;
  streamHandlers?: LibraryAgentStreamHandlers;
  checkContent?: boolean;
}) {
  const citationBindings = input.checkContent ? await verifyAgentCitationBindings({
    answer: input.answer, citations: input.citations, signal: input.signal, model: input.preset.model,
    callModel: async ({ system, user, signal }) => {
      const response = await runOpenAiCompatibleAgentChatTurn({
        options: { baseUrl: input.preset.baseUrl, apiKey: input.preset.apiKey, model: input.preset.model,
          apiMode: input.preset.apiMode, reasoningEffort: 'low', temperature: 0, maxOutputTokens: 512 },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        toolChoice: 'none', stream: false, signal,
      });
      input.streamHandlers?.onCapabilityUsage?.({
        capabilityId: 'citation-verifier', promptTokens: response.usage?.promptTokens ?? 0,
        completionTokens: response.usage?.completionTokens ?? 0,
      });
      return { content: response.content };
    },
  }) : bindAgentCitationSources(input.answer, input.citations);
  input.streamHandlers?.onCitationVerification?.(citationBindings);
  return { citationBindings, evidenceStats: citationBindingStats(citationBindings) };
}

export async function runConversationalLibraryAgent({
  papers,
  knownLibraryPapers,
  categories = [],
  instruction,
  preset,
  streamHandlers,
  historyMessages = [],
  currentPaperScopeIds,
  paperScopes = [],
  responseLanguage,
  ragEnabled = true,
  attachments,
  signal,
  capabilityResume,
  loopResumeMessages,
  loopResumeCitations,
  pinnedCapabilityId,
}: {
  papers: LiteraturePaper[];
  /** Full local identity map; model context and tools still obey currentPaperScopeIds. */
  knownLibraryPapers?: LiteraturePaper[];
  categories?: LiteratureCategory[];
  instruction: string;
  preset: LibraryAgentModelPreset;
  streamHandlers?: LibraryAgentStreamHandlers;
  historyMessages?: LibraryAgentConversationMessage[];
  currentPaperScopeIds?: string[];
  paperScopes?: LibraryAgentPaperScopeInput[];
  responseLanguage?: string;
  ragEnabled?: boolean;
  attachments?: DocumentChatAttachment[];
  signal?: AbortSignal;
  capabilityResume?: Partial<ComparativeSurveyArtifacts>;
  loopResumeMessages?: AgentLoopMessage[];
  loopResumeCitations?: LibraryAgentRagCitation[];
  pinnedCapabilityId?: AgentCapabilityId | 'auto' | null;
}): Promise<LibraryAgentRunResult> {
  if (!preset.baseUrl.trim() || !preset.apiKey.trim() || !preset.model.trim()) {
    throw new Error('请先在设置里配置支持 tool/function calling 的 OpenAI-compatible 模型。');
  }

  const normalizedInstruction = instruction.trim();

  if (!normalizedInstruction) {
    throw new Error('请输入要让 Agent 执行的文库整理指令。');
  }

  const deliveryRequirement = deriveAgentDeliveryRequirement({ instruction: normalizedInstruction, historyMessages });

  // An omitted scope is the explicit all-library mode used by direct service
  // callers. An explicitly empty array remains an authorized empty scope.
  const allLibraryPapers = knownLibraryPapers ?? papers;
  currentPaperScopeIds = currentPaperScopeIds === undefined
    ? papers.map((paper) => paper.id)
    : [...new Set(currentPaperScopeIds.map((id) => id.trim()).filter(Boolean))];
  const paperScope = resolveAgentPaperScope(allLibraryPapers, currentPaperScopeIds);
  papers = paperScope.papers;

  const persisted = await loadAgentSettingsAndSecrets();

  const mountContext: AgentToolMountContext = {
    papersCount: paperScope.papers.length,
    hasOpenDocument: paperScope.papers.some((paper) => Boolean(paperPdfPath(paper))),
    ragReady: persisted.settings.localRagEnabled !== false,
    localLibraryMode: true,
  };

  // 当次运行累积的引用活数组：ReAct 的 rag_search/request_paper_context、
  // citation-audit 的 retrieve、note-distill 的 RAG 兜底都向同一个数组追加（方案第 3.3 节）。
  const citations: LibraryAgentRagCitation[] = [];
  const citationRegistry = new AgentCitationRegistry(citations);
  const registerScopedCitations = (next: LibraryAgentRagCitation[] | undefined) =>
    citationRegistry.register((next ?? []).filter((citation) =>
      paperScope.ids.includes(citation.paperId) && paperScope.paperById.has(citation.paperId)));

  registerScopedCitations(loopResumeCitations);
  for (const message of loopResumeMessages ?? []) {
    if (message.role !== 'tool') continue;
    registerScopedCitations(recoverAgentToolCitations(message.content, paperScope.paperById, paperScope.ids));
  }
  const ragErrors: string[] = [];
  const ragSettings = normalizeStoredReaderSettings(persisted.settings);
  const ragReady = Boolean(
    ragEnabled &&
    persisted.secrets.embeddingApiKey?.trim() &&
    ragSettings.embeddingBaseUrl.trim() &&
    ragSettings.embeddingModel.trim(),
  );

  // 与 rag_search 工具完全相同的检索实现：citation-audit 的 retrieve 与
  // note-distill 的 RAG 兜底直接复用它，不新写检索器（方案第 5.2/5.3 节）。
  const searchRag = async (
    input: { query: string; paperIds?: string[]; topK?: number },
    searchOptions?: { signal?: AbortSignal },
  ) => {
    const effectiveSignal = searchOptions?.signal ?? signal;
    if (effectiveSignal?.aborted) {
      const error = new Error('RAG search aborted');
      error.name = 'AbortError';
      throw error;
    }

    const embeddingApiKey = persisted.secrets.embeddingApiKey?.trim() || '';
    if (!ragReady || !embeddingApiKey) {
      return { chunks: [], ragErrors: ['Local RAG is not configured or ready.'] };
    }

    try {
      const resolvedIds = resolveAgentPaperIds(paperScope, input.paperIds);
      if (resolvedIds.error) {
        return { chunks: [], ragErrors: [`scope_error:${resolvedIds.error.code}:${resolvedIds.error.message}`] };
      }
      const targetKeys = resolvedIds.ids;

      const queryEmbedding = await embedRagText(
        input.query,
        {
          baseUrl: ragSettings.embeddingBaseUrl,
          apiKey: embeddingApiKey,
          model: ragSettings.embeddingModel,
          dimensions: ragSettings.embeddingDimensions,
          timeoutSeconds: ragSettings.embeddingRequestTimeoutSeconds,
        },
      );

      if (effectiveSignal?.aborted) {
        const error = new Error('RAG search aborted');
        error.name = 'AbortError';
        throw error;
      }

      const topK = Math.max(1, Math.min(30, input.topK ?? 12));

      const rawResults = await ragRetrieveDocumentChunks({
        documentKeys: targetKeys,
        queryEmbedding,
        queryText: input.query,
        topK,
      });

      const paperById = paperScope.paperById;
      const chunks: Array<{
        citationId: string;
        evidenceToken: string;
        sourceType: string;
        paperId: string;
        paperTitle?: string;
        page: number | null;
        blockId: string | null;
        snippet: string;
        hasImage: boolean;
      }> = [];
      const droppedReasons: string[] = [];

      // Validate identity and scope, register canonical citation, then expose
      // the token. This ordering prevents model-visible unregistered evidence.
      for (const chunk of rawResults) {
        const documentKey = chunk.documentKey?.trim();
        if (!documentKey) {
          droppedReasons.push(`missing_document_key:${chunk.chunkId}`);
          continue;
        }
        const paper = paperById.get(documentKey);
        if (!paper) {
          droppedReasons.push(`unknown_paper:${documentKey}`);
          continue;
        }
        if (!targetKeys.includes(documentKey)) {
          droppedReasons.push(`out_of_scope:${documentKey}`);
          continue;
        }
        const sourceType = chunk.sourceType ?? 'pdf-text';
        const citationId = `agent-rag:${paper.id}:${sourceType}:${chunk.chunkId}`;
        const [canonical] = citationRegistry.register([{
          id: citationId,
          label: '',
          sourceType,
          pageIndex: chunk.pageIndex ?? null,
          blockId: chunk.blockId ?? null,
          previewText: chunk.text ?? '',
          paperId: paper.id,
          paperTitle: paper.title,
        }]);
        if (!canonical) {
          droppedReasons.push(`unregistered_citation:${citationId}`);
          continue;
        }
        chunks.push({
          citationId: canonical.id,
          evidenceToken: formatCitationEvidenceToken(canonical),
          sourceType,
          paperId: paper.id,
          paperTitle: paper.title,
          page: chunk.pageIndex === null || chunk.pageIndex === undefined ? null : chunk.pageIndex + 1,
          blockId: chunk.blockId ?? null,
          snippet: chunk.text ?? '',
          hasImage: false,
        });
      }

      return { chunks, ragErrors: droppedReasons.length > 0 ? [`dropped_indexed_results:${droppedReasons.join(',')}`] : [] };
    } catch (error) {
      if (effectiveSignal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw error;
      }
      return { chunks: [], ragErrors: [error instanceof Error ? error.message : String(error)] };
    }
  };

  // 能力子调用（分类器/引用核对/笔记蒸馏）共用的模型通道：temperature 0、不流式、toolChoice none。
  let usageCapabilityId: AgentCapabilityId | 'classifier' = 'classifier';
  const callCapabilityModel: AgentCapabilityCallModel = async (input) => {
    const controller = new AbortController();
    const abortFromParent = () => controller.abort();
    const abortFromCall = () => controller.abort();
    signal?.addEventListener('abort', abortFromParent, { once: true });
    input.signal?.addEventListener('abort', abortFromCall, { once: true });
    try {
      const response = await runOpenAiCompatibleAgentChatTurn({
        options: {
          baseUrl: preset.baseUrl,
          apiKey: preset.apiKey.trim(),
          model: preset.model,
          apiMode: preset.apiMode,
          temperature: 0,
          reasoningEffort: preset.reasoningEffort,
          maxOutputTokens: preset.maxOutputTokens,
        },
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user },
        ],
        toolChoice: 'none',
        stream: false,
        signal: controller.signal,
      });
      streamHandlers?.onCapabilityUsage?.({
        promptTokens: response.usage?.promptTokens ?? 0,
        completionTokens: response.usage?.completionTokens ?? 0,
        capabilityId: usageCapabilityId,
      });
      return { content: response.content };
    } finally {
      signal?.removeEventListener('abort', abortFromParent);
      input.signal?.removeEventListener('abort', abortFromCall);
    }
  };

  // 只有明确请求专门能力时才调用分类器；普通问答直接进入原有 Agent 循环。
  // 分类器未配置、超时、报错、解析失败都在 classifyAgentCapabilityRoute 内降级为 null
  // 并 emit capability_route_failed，随后进入普通 ReAct，绝不中断问答。
  const pinnedIsAutoOrUnset = !pinnedCapabilityId || pinnedCapabilityId === 'auto';
  const classifierResult = pinnedIsAutoOrUnset &&
      normalizedInstruction.length >= 12 &&
      /引用核对|核查(?:主张|引用|证据)|核对(?:主张|引用|证据)|笔记蒸馏|提炼.*笔记|生成.*笔记|概念笔记|论文卡片|图谱探索|知识图谱|citation audit|note distill|graph explor/i.test(normalizedInstruction) &&
      !isComparativeSurveyInstruction(normalizedInstruction, papers.length)
    ? await classifyAgentCapabilityRoute({
      instruction: normalizedInstruction,
      callModel: callCapabilityModel,
      signal,
      onEvent: (event) => streamHandlers?.onCapabilityRoute?.(event),
    })
    : null;

  const route = resolveAgentCapabilityRoute({
    instruction: normalizedInstruction,
    paperCount: papers.length,
    deliveryRequirement,
    pinnedCapabilityId,
    mountContext,
    classifierResult,
  });
  usageCapabilityId = route.capabilityId ?? 'classifier';
  streamHandlers?.onCapabilityRoute?.({
    kind: 'capability_route',
    capabilityId: route.capabilityId,
    source: route.source,
    reason: route.reason,
  });

  if (route.capabilityId === 'comparative-survey') {
    if (papers.length < 2) {
      const noticeMarkdown = '库内综述（对比调研）需要至少选择或提供 2 篇文献才能进行对比分析。请选择至少两篇文献后再试。';
      streamHandlers?.onDelta?.(noticeMarkdown, noticeMarkdown);
      streamHandlers?.onDone?.();
      return {
        kind: 'capability',
        capabilityId: 'comparative-survey',
        result: {
          kind: 'survey',
          survey: {
            markdown: noticeMarkdown,
            citations: [],
            tokenUsage: { promptTokens: 0, completionTokens: 0 },
            artifacts: { completedStages: [] },
            deliveryQuality: inspectAgentDeliveryQuality({
              markdown: noticeMarkdown,
              requirement: { ...deliveryRequirement, kind: 'survey', completeness: 'full' },
              runState: 'partial',
            }),
          },
        },
        citations: [],
        figures: [],
        visionNotice: null,
        ragNotice: null,
        evidenceStats: { supported: 0, partial: 0, 'not-in-library': 0 },
      };
    }

    const citationAccumulator: LibraryAgentRagCitation[] = [];
    const surveyRegistry = new AgentCitationRegistry(citationAccumulator);
    surveyRegistry.register((capabilityResume?.citations ?? []).map((citation, index) => ({
      ...citation,
      id: citation.id ?? `agent-rag:${citation.paperId}:recovered:${citation.pageIndex ?? 'na'}:${citation.blockId ?? 'na'}`,
      label: citation.label ?? String(index + 1),
      pageIndex: citation.pageIndex ?? null,
      sourceType: citation.sourceType ?? 'pdf-text',
    })));
    const ragErrors: string[] = [];
    // Keep one mutable, serializable ledger for the whole capability run. It
    // is returned by the research stage and checkpointed after each batch so
    // an interrupted survey can resume without treating candidates as read.
    let surveyCoverage: SurveyCoverageLedger = normalizeSurveyCoverageLedger(capabilityResume?.coverage)
      ?? createSurveyCoverageLedger({
        papers: papers.map((paper) => ({ id: paper.id, title: paper.title })),
        budget: { maxPapers: 40, maxSubquestions: 6, maxTokens: 200_000, maxMilliseconds: 15 * 60_000 },
      });
    surveyCoverage = ensureSurveyCoveragePapers(
      surveyCoverage,
      papers.map((paper) => ({ id: paper.id, title: paper.title })),
    );
    surveyCoverage = {
      ...surveyCoverage,
      budget: {
        ...surveyCoverage.budget,
        maxPapers: surveyCoverage.budget.maxPapers ?? 40,
        maxSubquestions: surveyCoverage.budget.maxSubquestions ?? 6,
        maxTokens: surveyCoverage.budget.maxTokens ?? 200_000,
        maxMilliseconds: surveyCoverage.budget.maxMilliseconds ?? 15 * 60_000,
      },
    };
    let persistSurveyCoverage: ((coverage: SurveyCoverageLedger) => void) | undefined;
    const mergeCoverageSnapshot = (snapshot: SurveyCoverageLedger) => ({
      ...snapshot,
      budget: {
        ...snapshot.budget,
        maxPapers: snapshot.budget.maxPapers ?? surveyCoverage.budget.maxPapers,
        maxSubquestions: snapshot.budget.maxSubquestions ?? surveyCoverage.budget.maxSubquestions,
        maxTokens: snapshot.budget.maxTokens ?? surveyCoverage.budget.maxTokens,
        maxMilliseconds: snapshot.budget.maxMilliseconds ?? surveyCoverage.budget.maxMilliseconds,
        promptTokens: Math.max(snapshot.budget.promptTokens, surveyCoverage.budget.promptTokens),
        completionTokens: Math.max(snapshot.budget.completionTokens, surveyCoverage.budget.completionTokens),
        elapsedMilliseconds: Math.max(snapshot.budget.elapsedMilliseconds, surveyCoverage.budget.elapsedMilliseconds),
      },
    });
    const callModel = async (system: string, user: string) => {
      const controller = new AbortController();
      const abortFromParent = () => controller.abort();
      signal?.addEventListener('abort', abortFromParent, { once: true });
      const startedAt = Date.now();
      let elapsedRecorded = false;
      try {
        const response = await runOpenAiCompatibleAgentChatTurn({
          options: {
            baseUrl: preset.baseUrl,
            apiKey: preset.apiKey.trim(),
            model: preset.model,
            apiMode: preset.apiMode,
            temperature: preset.temperature,
            reasoningEffort: preset.reasoningEffort,
            maxOutputTokens: preset.maxOutputTokens,
          },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          toolChoice: 'none',
          stream: false,
          signal: controller.signal,
        });
        streamHandlers?.onCapabilityUsage?.({
          promptTokens: response.usage?.promptTokens ?? 0,
          completionTokens: response.usage?.completionTokens ?? 0,
          capabilityId: 'comparative-survey',
        });
        surveyCoverage = updateSurveyCoverageBudget(surveyCoverage, {
          promptTokens: response.usage?.promptTokens ?? 0,
          completionTokens: response.usage?.completionTokens ?? 0,
          elapsedMilliseconds: Date.now() - startedAt,
        });
        elapsedRecorded = true;
        persistSurveyCoverage?.(surveyCoverage);
        return response;
      } finally {
        if (!elapsedRecorded) {
          surveyCoverage = updateSurveyCoverageBudget(surveyCoverage, { elapsedMilliseconds: Date.now() - startedAt });
          persistSurveyCoverage?.(surveyCoverage);
        }
        signal?.removeEventListener('abort', abortFromParent);
      }
    };
    const survey = await runComparativeSurveyCapability({
      question: normalizedInstruction,
      deliveryRequirement,
      resume: capabilityResume,
      signal,
      onEvent: streamHandlers?.onCapabilityEvent
        ? (event) => streamHandlers.onCapabilityEvent?.({ ...event, capabilityId: 'comparative-survey' })
        : undefined,
      onCheckpoint(artifacts) {
        const normalizedCoverage = normalizeSurveyCoverageLedger(artifacts.coverage ?? surveyCoverage);
        const checkpointCoverage = normalizedCoverage ? mergeCoverageSnapshot(normalizedCoverage) : undefined;
        if (checkpointCoverage) surveyCoverage = checkpointCoverage;
        streamHandlers?.onCapabilityCheckpoint?.({
          ...artifacts,
          ...(checkpointCoverage ? { coverage: checkpointCoverage } : {}),
        });
      },
      handlers: {
        async rephrase({ question }) {
          const response = await callModel(
            'Rewrite the comparative research question into one precise academic question. Return only the rewritten question.',
            question,
          );
          return { text: response.content, usage: response.usage };
        },
        async decompose({ question }) {
          const response = await callModel(
            'Decompose the research question into 2 to 6 concise subquestions. Return one subquestion per line and no extra prose.',
            question,
          );
          return {
            questions: response.content.split(/\r?\n/).map((line) => line.replace(/^[-*\d.)\s]+/, '').trim()).filter(Boolean),
            usage: response.usage,
          };
        },
        async research({ subquestions, onProgress, coverage, researchNotes, researchContexts, onCheckpoint }) {
          const notes: string[] = researchNotes?.trim() ? [researchNotes] : [];
          const pendingContexts = new Map(normalizeSurveyResearchContexts(researchContexts)
            .map((context) => [`${context.subquestionId}:${context.paperId}`, context]));
          let promptTokens = 0;
          let completionTokens = 0;
          // The capability runner passes the latest checkpoint back on resume.
          // Keep the outer ledger as the single mutable source so model usage,
          // retrieval events and stage checkpoints cannot diverge.
          if (coverage) {
            const normalizedCoverage = normalizeSurveyCoverageLedger(coverage);
            if (normalizedCoverage) surveyCoverage = mergeCoverageSnapshot(normalizedCoverage);
          }
          surveyCoverage = ensureSurveyCoveragePapers(
            surveyCoverage,
            papers.map((paper) => ({ id: paper.id, title: paper.title })),
          );
          surveyCoverage = ensureSurveyCoverageSubquestions(
            surveyCoverage,
            subquestions.map((question, index) => ({
              id: `subquestion-${index + 1}`,
              question,
              candidatePaperIds: papers.map((paper) => paper.id),
            })),
          );
          surveyCoverage = { ...surveyCoverage, runState: 'running' };
          // callModel also updates the token/time budget. Forward those updates
          // to the capability checkpoint so an interrupted run can continue.
          const saveResearchProgress = () => onCheckpoint?.(surveyCoverage, {
            notes: notes.join('\n\n'),
            citations: citationAccumulator.map((citation) => ({ ...citation })),
            contexts: [...pendingContexts.values()],
          });
          persistSurveyCoverage = () => saveResearchProgress();
          saveResearchProgress();

          // 按模型上下文窗口分配每篇论文的正文配额，避免大范围调研把 prompt 撑爆。
          // token 到字符按保守的 1:2 换算，并预留系统提示与报告阶段的开销。
          const contextCharBudget = Math.max(8192, ((preset.contextWindow ?? 128_000) - 32_768) * 2);
          const perPaperContextChars = Math.max(
            256,
            Math.min(16_000, Math.floor(contextCharBudget / Math.max(1, papers.length))),
          );
          // 并发抽取全量 PDF 文本会造成内存峰值，分批处理。
          const CONTEXT_LOAD_CONCURRENCY = 4;
          const loadContextsInBatches = async (
            subquestion: string,
            subquestionId: string,
            onResult: (result: SurveyCoverageBatchResult<PaperContextPayload>) => Promise<void>,
          ) => {
            let loadedCount = 0;
            const pendingPaperIds = new Set(papers.map((paper) => paper.id));
            while (pendingPaperIds.size > 0) {
              if (signal?.aborted) {
                const error = new Error('Comparative survey cancelled');
                error.name = 'AbortError';
                throw error;
              }
              // Keep maxPapers meaningful even though context extraction is
              // concurrent. A resumed ledger may already have consumed part
              // of the allowance, so never schedule a batch larger than the
              // remaining paper budget.
              const batchIds = selectSurveyCoverageBatch(surveyCoverage, [...pendingPaperIds], subquestionId, CONTEXT_LOAD_CONCURRENCY);
              if (batchIds.length === 0) break;
              const batch = batchIds.flatMap((id) => papers.find((paper) => paper.id === id) ?? []);
              for (const paper of batch) {
                pendingPaperIds.delete(paper.id);
                const prior = surveyCoverage.papers.find((item) => item.paperId === paper.id);
                surveyCoverage = recordSurveyPaperCoverage(surveyCoverage, paper.id, {
                  attempts: (prior?.attempts ?? 0) + 1,
                  subquestionIds: [...(prior?.subquestionIds ?? []), subquestionId],
                });
              }
              saveResearchProgress();
              const loadStartedAt = Date.now();
              try {
                const results = await processSurveyCoverageBatch({
                  paperIds: batchIds,
                  signal,
                  load: async (paperId) => {
                    const paper = batch.find((item) => item.id === paperId)!;
                    return loadPaperContext(
                      paper,
                      'pdf-text',
                      subquestion,
                      { ragEnabled, signal },
                    );
                  },
                  onResult,
                });
                loadedCount += results.length;
              } finally {
                surveyCoverage = updateSurveyCoverageBudget(surveyCoverage, { elapsedMilliseconds: Date.now() - loadStartedAt });
                saveResearchProgress();
              }
            }

            return loadedCount;
          };

          for (let index = 0; index < subquestions.length; index += 1) {
            if (signal?.aborted) {
              const error = new Error('Comparative survey cancelled');
              error.name = 'AbortError';
              throw error;
            }
            const subquestion = subquestions[index] ?? normalizedInstruction;
            const subquestionId = `subquestion-${index + 1}`;
            const candidatePaperIds = papers.map((paper) => paper.id);
            const budgetStopReason = getSurveyCoverageBudgetStopReason(surveyCoverage);
            if (budgetStopReason) {
              surveyCoverage = finishSurveyCoverage(surveyCoverage, {
                state: 'partial',
                stopReason: budgetStopReason,
              });
              saveResearchProgress();
              break;
            }
            const existingSubquestion = surveyCoverage.subquestions.find((item) =>
              item.id === subquestionId || item.question === subquestion,
            );
            if (existingSubquestion?.state === 'completed') {
              onProgress(index + 1, subquestions.length, subquestion);
              continue;
            }
            const effectiveSubquestionId = existingSubquestion?.id ?? subquestionId;
            surveyCoverage = ensureSurveyCoverageSubquestions(surveyCoverage, [{
              id: effectiveSubquestionId,
              question: subquestion,
              candidatePaperIds,
            }]);
            surveyCoverage = recordSurveySubquestionCoverage(surveyCoverage, effectiveSubquestionId, {
              state: 'in-progress',
              candidatePaperIds,
            });
            saveResearchProgress();
            onProgress(index, subquestions.length, subquestion);
            const contextsByPaperId = new Map<string, PaperContextPayload>([...pendingContexts.values()]
              .filter((context) => context.subquestionId === effectiveSubquestionId)
              .map((context) => [context.paperId, {
                source: context.source,
                text: context.text,
                citations: citationAccumulator.filter((citation) => context.citationIds.includes(citation.id)),
              }]));
            const completedPaperIds = [...(existingSubquestion?.completedPaperIds ?? [])];
            const failedPaperIds = new Set(existingSubquestion?.failedPaperIds ?? []);
            const evidenceCitationIds = [...(existingSubquestion?.evidenceCitationIds ?? [])];
            const evidenceGaps = (existingSubquestion?.evidenceGaps ?? []).filter((gap) =>
              !papers.some((paper) => gap.startsWith(`${paper.title}:`))
              && !gap.startsWith(`${subquestion}: research stopped at`)
              && !gap.startsWith(`${subquestion}: synthesis `),
            );
            const paperEvidenceGaps = new Map(surveyCoverage.papers
              .filter((paper) => candidatePaperIds.includes(paper.paperId) && (paper.failed || paper.unresolved))
              .map((paper) => [paper.paperId, `${paper.paperTitle ?? paper.paperId}: ${paper.failed ? 'context loading failed' : 'no full-text evidence was available'}`]));
            const allEvidenceGaps = () => [...evidenceGaps, ...paperEvidenceGaps.values()];
            const saveSubquestionProgress = () => {
              surveyCoverage = recordSurveySubquestionCoverage(surveyCoverage, effectiveSubquestionId, {
                state: 'in-progress', candidatePaperIds, completedPaperIds,
                failedPaperIds: [...failedPaperIds], evidenceCitationIds: [...new Set(evidenceCitationIds)],
                evidenceGaps: allEvidenceGaps(),
              });
              saveResearchProgress();
            };
            const loadedCount = await loadContextsInBatches(subquestion, effectiveSubquestionId, async (result) => {
              const paper = papers.find((item) => item.id === result.paperId)!;
              const priorPaper = surveyCoverage.papers.find((item) => item.paperId === paper.id);
              const attempts = priorPaper?.attempts ?? 1;
              if ('error' in result) {
                failedPaperIds.add(paper.id);
                surveyCoverage = recordSurveyPaperCoverage(surveyCoverage, paper.id, {
                  paperTitle: paper.title,
                  attempts,
                  failed: true,
                  error: toErrorMessage(result.error, 'context load failed'),
                  subquestionIds: [...(priorPaper?.subquestionIds ?? []), effectiveSubquestionId],
                });
                paperEvidenceGaps.set(paper.id, `${paper.title}: context loading failed`);
                saveSubquestionProgress();
                return;
              }

              const context = result.value;
              if (!context) {
                failedPaperIds.add(paper.id);
                surveyCoverage = recordSurveyPaperCoverage(surveyCoverage, paper.id, {
                  paperTitle: paper.title,
                  attempts,
                  failed: true,
                  error: 'context load returned no result',
                  subquestionIds: [...(priorPaper?.subquestionIds ?? []), effectiveSubquestionId],
                });
                paperEvidenceGaps.set(paper.id, `${paper.title}: context load returned no result`);
                saveSubquestionProgress();
                return;
              }

              const hasBodyContext = /(?:pdf-text|mineru)/i.test(context.source)
                && !/fallback-no-pdf|fallback-pdf-error/i.test(context.source);
              const canonical = surveyRegistry.register(context.citations);
              const slice = sliceAgentToolText(rewriteAgentCitationSourceLabels(context.text, context.citations, canonical), perPaperContextChars);
              let visibleText = slice.text;
              if (canonical.length === 0 && hasBodyContext && visibleText.trim()) {
                const excerptCitation = createAgentDocumentExcerptCitation({
                  paperId: paper.id, paperTitle: paper.title, source: context.source,
                  contextVersion: await agentToolTextVersion(paper.id, context.source, context.text),
                  textStart: 0, textEnd: slice.offset, text: visibleText,
                });
                if (excerptCitation) {
                  canonical.push(...surveyRegistry.register([excerptCitation]));
                  visibleText = `# Source ${formatCitationEvidenceToken(canonical[0]!)}\n${visibleText}`;
                }
              }
              const citationIds = canonical.filter((citation) => visibleText.includes(formatCitationEvidenceToken(citation))).map((citation) => citation.id);
              const hasEffectiveEvidence = Boolean(visibleText.trim()) && hasBodyContext && citationIds.length > 0;
              if (context.ragError?.trim() && !ragErrors.includes(context.ragError.trim())) {
                ragErrors.push(context.ragError.trim());
              }
              if (citationIds.length > 0) evidenceCitationIds.push(...citationIds);
              if (!hasEffectiveEvidence) {
                paperEvidenceGaps.set(paper.id, `${paper.title}: no full-text evidence was available`);
              } else {
                paperEvidenceGaps.delete(paper.id);
              }
              failedPaperIds.delete(paper.id);
              if (!completedPaperIds.includes(paper.id)) completedPaperIds.push(paper.id);
              surveyCoverage = recordSurveyPaperCoverage(surveyCoverage, paper.id, {
                paperTitle: paper.title,
                attempts,
                abstractReviewed: true,
                bodySearched: hasBodyContext,
                unresolved: !hasEffectiveEvidence,
                unresolvedReason: hasEffectiveEvidence ? undefined
                  : /fallback-no-pdf/i.test(context.source) ? 'no-document'
                    : /fallback-pdf-error/i.test(context.source) ? 'unreadable-document'
                      : context.retrievalOutcome === 'empty' ? 'no-hit' : 'no-citable-evidence',
                retrievalOutcome: context.retrievalOutcome,
                failed: false,
                error: context.ragError ?? '',
                citationIds: [...(priorPaper?.citationIds ?? []), ...citationIds],
                subquestionIds: [...(priorPaper?.subquestionIds ?? []), effectiveSubquestionId],
              });
              contextsByPaperId.set(paper.id, {
                ...context,
                citations: canonical,
                text: visibleText,
              });
              pendingContexts.set(`${effectiveSubquestionId}:${paper.id}`, {
                paperId: paper.id, subquestionId: effectiveSubquestionId,
                source: context.source, text: visibleText, citationIds,
              });
              saveSubquestionProgress();
            });
            const postLoadBudgetStopReason = getSurveyCoverageBudgetStopReason({
              ...surveyCoverage,
              budget: { ...surveyCoverage.budget, maxPapers: undefined, maxSubquestions: undefined },
            }) ?? getSurveyCoverageBudgetStopReason(surveyCoverage);
            if (postLoadBudgetStopReason && (loadedCount === 0 || postLoadBudgetStopReason === 'budget-time' || postLoadBudgetStopReason === 'budget-tokens')) {
              evidenceGaps.push(`${subquestion}: research stopped at ${postLoadBudgetStopReason}`);
              surveyCoverage = recordSurveySubquestionCoverage(surveyCoverage, effectiveSubquestionId, {
                state: 'partial',
                candidatePaperIds,
                evidenceCitationIds: [...new Set(evidenceCitationIds)],
                evidenceGaps: allEvidenceGaps(),
                completedPaperIds,
                failedPaperIds: [...failedPaperIds],
              });
              surveyCoverage = finishSurveyCoverage(surveyCoverage, {
                state: 'partial',
                stopReason: postLoadBudgetStopReason,
              });
              saveResearchProgress();
              break;
            }
            // Preserve paper ordering in the model payload, including failed or
            // unresolved entries as empty context rather than shifting IDs.
            const response = await callModel(
              `Synthesize evidence for one comparative-survey subquestion. Return compact research notes. ${AGENT_CITATION_PROTOCOL}`,
              JSON.stringify({
                subquestion,
                previousResearchNotes: notes.join('\n\n'),
                papers: papers.map((paper) => ({
                  id: paper.id,
                  title: paper.title,
                  context: contextsByPaperId.get(paper.id)?.text ?? '',
                })),
              }),
            );
            promptTokens += response.usage?.promptTokens ?? 0;
            completionTokens += response.usage?.completionTokens ?? 0;
            // Input evidence is not proof that synthesis retained it. Only
            // locally resolved output tokens for this subquestion can finish
            // its synthesis; interrupted notes must keep their source context.
            const synthesisBindings = bindAgentCitationSources(response.content, citationAccumulator);
            const availableEvidenceIds = new Set(evidenceCitationIds);
            const uniqueEvidenceCitationIds = [...new Set(synthesisBindings
              .filter((binding) => binding.reason === 'source-resolved' && availableEvidenceIds.has(binding.citationId))
              .map((binding) => binding.citationId))];
            const synthesisGap = response.finishReason === 'length'
              ? `${subquestion}: synthesis stopped at model output length`
              : !response.content.trim()
                ? `${subquestion}: synthesis returned no research notes`
                : synthesisBindings.some((binding) => binding.reason !== 'source-resolved')
                  ? `${subquestion}: synthesis contains unresolved evidence citations`
                  : uniqueEvidenceCitationIds.length === 0
                    ? `${subquestion}: synthesis produced no canonical evidence citation`
                    : undefined;
            if (synthesisGap) {
              evidenceGaps.push(synthesisGap);
              surveyCoverage = recordSurveySubquestionCoverage(surveyCoverage, effectiveSubquestionId, {
                state: 'partial', candidatePaperIds, completedPaperIds,
                failedPaperIds: [...failedPaperIds], evidenceCitationIds: [...availableEvidenceIds],
                evidenceGaps: allEvidenceGaps(),
              });
              surveyCoverage = finishSurveyCoverage(surveyCoverage, {
                state: 'partial', stopReason: response.finishReason === 'length' ? 'budget-tokens' : 'error',
              });
              saveResearchProgress();
              onProgress(index, subquestions.length, `${subquestion}：证据合成未完成，已保存正文摘段与来源。`);
              break;
            }
            notes.push(`## ${subquestion}\n${response.content}`);
            for (const paperId of completedPaperIds) {
              const context = contextsByPaperId.get(paperId);
              if (!context) continue;
              const paper = surveyCoverage.papers.find((item) => item.paperId === paperId);
              if (paper?.bodySearched && !paper.failed && !paper.unresolved) {
                surveyCoverage = recordSurveyPaperCoverage(surveyCoverage, paperId, { focusedRead: true });
              }
              pendingContexts.delete(`${effectiveSubquestionId}:${paperId}`);
            }
            const completedCount = new Set([...completedPaperIds, ...failedPaperIds]).size;
            const state = failedPaperIds.size > 0 || allEvidenceGaps().length > 0 || completedCount < candidatePaperIds.length
              ? 'partial'
              : 'completed';
            surveyCoverage = recordSurveySubquestionCoverage(surveyCoverage, effectiveSubquestionId, {
              state,
              candidatePaperIds,
              evidenceCitationIds: uniqueEvidenceCitationIds,
              evidenceGaps: allEvidenceGaps(),
              completedPaperIds,
              failedPaperIds: [...failedPaperIds],
            });
            saveResearchProgress();
            const postSynthesisBudgetStopReason = getSurveyCoverageBudgetStopReason(surveyCoverage);
            if (postSynthesisBudgetStopReason) {
              surveyCoverage = finishSurveyCoverage(surveyCoverage, {
                state: 'partial',
                stopReason: postSynthesisBudgetStopReason,
              });
              saveResearchProgress();
              onProgress(index + 1, subquestions.length, subquestion);
              break;
            }
            onProgress(index + 1, subquestions.length, subquestion);
          }

          return {
            notes: notes.join('\n\n'),
            citations: citationAccumulator.map((citation) => ({
              id: citation.id,
              label: citation.label,
              paperId: citation.paperId,
              paperTitle: citation.paperTitle,
              pageIndex: citation.pageIndex,
              blockId: citation.blockId,
              previewText: citation.previewText,
              sourceType: citation.sourceType,
            })),
            usage: { promptTokens, completionTokens },
            coverage: surveyCoverage,
            researchContexts: [...pendingContexts.values()],
          };
        },
        async report({ question, subquestions, researchNotes }) {
          const modelBudgetStopReason = getSurveyCoverageBudgetStopReason({
            ...surveyCoverage,
            budget: { ...surveyCoverage.budget, maxPapers: undefined, maxSubquestions: undefined },
          });
          const synthesisStopped = surveyCoverage.subquestions.some((subquestion) =>
            subquestion.state === 'partial' && subquestion.evidenceGaps.some((gap) =>
              gap.startsWith(`${subquestion.question}: synthesis `)),
          );
          if (modelBudgetStopReason || synthesisStopped) {
            surveyCoverage = finishSurveyCoverage(surveyCoverage, {
              state: 'partial', stopReason: modelBudgetStopReason ?? surveyCoverage.stopReason ?? 'error',
            });
            persistSurveyCoverage?.(surveyCoverage);
            const summary = summarizeSurveyCoverage(surveyCoverage);
            const reason = modelBudgetStopReason
              ? `本轮已达到${modelBudgetStopReason === 'budget-time' ? '时间' : 'token'}预算，调研尚未完成。`
              : surveyCoverage.stopReason === 'budget-tokens'
                ? '本轮证据合成达到模型输出长度限制，调研尚未完成。'
                : '本轮未取得带有效来源引用的完整证据合成，调研尚未完成。';
            return {
              markdown: `# 部分调研结果\n\n${reason}\n\n${researchNotes.trim() || '本轮尚未完成证据合成。'}\n\n## 待处理\n\n尚有 ${summary.pendingCount} 篇候选待处理，${summary.pendingSubquestionCount + summary.partialSubquestionCount} 个子问题未完成。已取得的正文摘段与来源仍保存在调研检查点，可继续调研以处理剩余证据并重新生成报告。`,
            };
          }
          const response = await callModel(
            `Write the requested academic deliverable in Markdown. Start with the conclusion unless the user's requested chapter order requires otherwise, compare methods and evidence, and state limitations. ${buildAgentDeliveryQualityPrompt({ ...deliveryRequirement, completeness: deliveryRequirement.completeness === 'partial' ? 'partial' : 'full' })} ${AGENT_CITATION_PROTOCOL}`,
            JSON.stringify({ originalRequest: normalizedInstruction, question, subquestions, researchNotes, deliveryRequirement }),
          );
          return { markdown: response.content, usage: response.usage, finishReason: response.finishReason };
        },
      },
    });

    for (const citation of survey.citations) {
      if (citationAccumulator.some((current) =>
        current.paperId === citation.paperId &&
        current.pageIndex === citation.pageIndex &&
        current.blockId === citation.blockId
      )) {
        continue;
      }
      surveyRegistry.register([{
        id: citation.id ?? `agent-rag:${citation.paperId}:recovered:${citation.pageIndex ?? 'na'}:${citation.blockId ?? 'na'}`,
        label: citation.label ?? '',
        sourceType: citation.sourceType ?? 'pdf-text',
        pageIndex: citation.pageIndex ?? null,
        blockId: citation.blockId ?? null,
        previewText: citation.previewText,
        paperId: citation.paperId,
        paperTitle: citation.paperTitle,
      }]);
    }
    streamHandlers?.onDelta?.(survey.markdown, survey.markdown);
    streamHandlers?.onDone?.();

    const bindingResult = await verifyLibraryAgentAnswerCitations({
      answer: survey.markdown,
      citations: citationAccumulator,
      preset, signal, streamHandlers,
    });

    // Only citations that actually occur in the final answer count as cited.
    // Retrieval and synthesis citations remain evidence candidates until the
    // answer binding step resolves their canonical IDs.
    const finalCoverageSnapshot = normalizeSurveyCoverageLedger(survey.artifacts.coverage);
    if (finalCoverageSnapshot) surveyCoverage = mergeCoverageSnapshot(finalCoverageSnapshot);
    const citedCitationIds = new Set(
      bindingResult.citationBindings
        .filter((binding) => binding.reason === 'source-resolved')
        .map((binding) => binding.citationId)
        .filter(Boolean),
    );
    for (const citationId of citedCitationIds) {
      const citation = citationAccumulator.find((candidate) => candidate.id === citationId);
      if (!citation) continue;
      const coveredPaper = surveyCoverage.papers.find((paper) => paper.paperId === citation.paperId);
      surveyCoverage = recordSurveyPaperCoverage(surveyCoverage, citation.paperId, {
        cited: true,
        citationIds: [...(coveredPaper?.citationIds ?? []), citationId],
      });
    }
    survey.artifacts.coverage = surveyCoverage;
    survey.coverageSummary = summarizeSurveyCoverage(surveyCoverage);
    const deliveryRunState = surveyCoverage.stopReason?.startsWith('budget-')
      ? 'budget'
      : surveyCoverage.runState === 'cancelled'
        ? 'cancelled'
        : surveyCoverage.runState === 'failed'
          ? 'failed'
          : surveyCoverage.runState === 'partial'
            ? 'partial'
            : surveyCoverage.runState === 'completed'
              ? 'completed'
              : undefined;
    survey.deliveryQuality = inspectAgentDeliveryQuality({
      markdown: survey.markdown,
      requirement: {
        ...deliveryRequirement,
        kind: deliveryRequirement.kind === 'engineering' ? 'engineering' : 'survey',
        completeness: deliveryRequirement.completeness === 'partial' ? 'partial' : 'full',
        candidateCount: survey.coverageSummary.candidateCount,
        pendingCount: survey.coverageSummary.pendingCount,
      },
      runState: deliveryRunState,
    });
    streamHandlers?.onCapabilityCheckpoint?.(survey.artifacts);

    return {
      kind: 'capability',
      capabilityId: 'comparative-survey',
      result: {
        kind: 'survey',
        survey,
      },
      citations: citationAccumulator,
      figures: [],
      visionNotice: preset.supportsVision === true ? null : '当前模型未标记为支持视觉，调研阶段未发送论文图片。',
      ragNotice: buildAgentRagNotice(ragErrors),
      ...bindingResult,
    };
  } else if (route.capabilityId) {
    const definition = getAgentCapability(route.capabilityId);
    if (definition) {
      const routedCapabilityId = route.capabilityId;
      let capabilityResult: AgentCapabilityResult | null = null;
      try {
        capabilityResult = await definition.runner({
          instruction: normalizedInstruction,
          priorAssistantAnswer: [...historyMessages].reverse().find((message) => message.role === 'assistant')?.content,
          papers: papers.map((paper) => ({
            id: paper.id,
            title: paper.title,
            tagNames: paper.tags.map((tag) => tag.name),
            categoryIds: paper.categoryIds,
            searchText: paperSearchText(paper),
          })),
          currentPaperScopeIds,
          signal,
          onEvent: streamHandlers?.onCapabilityEvent
            ? (event) => streamHandlers.onCapabilityEvent?.({ ...event, capabilityId: routedCapabilityId })
            : undefined,
          callModel: callCapabilityModel,
          searchRag,
        });
      } catch (capabilityError) {
        // 不变量 2：分类器选中的能力失败时降级回 ReAct，不阻断普通问答；
        // 钉选/关键词命中的能力失败仍按错误上抛——用户明确选择了该能力，需要看到失败。
        if (
          route.source === 'model' &&
          !(capabilityError instanceof Error && capabilityError.name === 'AbortError')
        ) {
          streamHandlers?.onError?.(
            `能力「${routedCapabilityId}」执行失败，已回退到普通问答：${toErrorMessage(capabilityError, 'capability failed')}`,
          );
          capabilityResult = null;
        } else {
          throw capabilityError;
        }
      }

      if (capabilityResult) {
        const answerMarkdown = capabilityResult.kind === 'audit'
          ? capabilityResult.audit.markdown
          : capabilityResult.kind === 'note-plan'
            ? capabilityResult.answer
            : capabilityResult.kind === 'graph-report'
              ? capabilityResult.report.markdown
              : '';
        streamHandlers?.onDelta?.(answerMarkdown, answerMarkdown);
        streamHandlers?.onDone?.();

        if (capabilityResult.kind === 'graph-report') {
          // 图谱报告没有检索引用：由 graph-explore 把报告所用论文补进绑定输入（方案第 3.3 节）。
          const graphCitations: LibraryAgentRagCitation[] = (capabilityResult.citations ?? []).map((citation) => ({
            id: `graph-explore:${citation.paperId}:${citation.label}`,
            label: citation.label,
            sourceType: 'pdf-text',
            pageIndex: citation.pageIndex,
            blockId: citation.blockId,
            previewText: citation.previewText,
            paperId: citation.paperId,
            paperTitle: citation.paperTitle,
          }));
          const bindingResult = await verifyLibraryAgentAnswerCitations({
            answer: answerMarkdown,
            citations: graphCitations,
            preset, signal, streamHandlers,
          });

          return {
            kind: 'capability',
            capabilityId: routedCapabilityId,
            result: capabilityResult,
            citations: graphCitations,
            figures: [],
            visionNotice: null,
            ragNotice: null,
            ...bindingResult,
          };
        }

        if (capabilityResult.kind === 'note-plan') {
          // 笔记蒸馏的 collect 证据（收集到的笔记 + RAG 兜底片段）挂到消息引用区；
          // 笔记写入门禁与回答引用核验独立，后者仅决定回答中哪些引用可点击。
          const distillCitations: LibraryAgentRagCitation[] = (capabilityResult.citations ?? [])
            .filter((citation) => citation.paperId && !citation.paperId.startsWith('note:'))
            .map((citation, index) => ({
              id: `note-distill:${citation.paperId}:${citation.label || index + 1}`,
              label: citation.label || String(index + 1),
              sourceType: 'pdf-text' as const,
              pageIndex: citation.pageIndex ?? null,
              blockId: citation.blockId ?? null,
              previewText: citation.previewText ?? '',
              paperId: citation.paperId,
              paperTitle: citation.paperTitle,
            }));

          return {
            kind: 'capability',
            capabilityId: routedCapabilityId,
            result: capabilityResult,
            citations: distillCitations,
            figures: [],
            visionNotice: null,
            ragNotice: null,
            ...await verifyLibraryAgentAnswerCitations({ answer: answerMarkdown, citations: distillCitations, preset, signal, streamHandlers }),
          };
        }

        // citation-audit：retrieve 复用 rag_search 检索，片段已累积进当次引用数组；
        // 审计表格保留自己的判定；回答中的引用另行核验，旧数字引用不放行。
        return {
          kind: 'capability',
          capabilityId: routedCapabilityId,
          result: capabilityResult,
          citations,
          figures: [],
          visionNotice: null,
          ragNotice: null,
          ...await verifyLibraryAgentAnswerCitations({ answer: answerMarkdown, citations, preset, signal, streamHandlers }),
        };
      }
      // capabilityResult 为 null：分类器选中的能力失败，继续走下方 ReAct 主循环。
    }
  }

  const categoryPayload = buildAgentCategoryPayload(categories);
  const metadataContextLabel = papers.length > 0 ? 'metadata only' : 'general chat';
  let contextLabel = metadataContextLabel;
  const scopedPapers = currentPaperScopeIds.length > 0
    ? currentScopePapers(papers, currentPaperScopeIds)
    : papers;
  let paperInputs = scopedPapers.map((paper) => paperToAgentInput(
    paper,
    undefined,
    categoryPayload.categoryPathById,
  ));
  const artifacts = emptyAgentSessionArtifacts();
  recordAgentCitations(artifacts, citations);
  const contexts = new Map<string, PaperContextPayload>();
  const contextModes = new Map<string, LibraryAgentContextRequest['mode']>();
  const contextQueries = new Map<string, string>();
  const fullTextContexts = new Set<string>();
  if (currentPaperScopeIds.length > 0) {
    const enriched = await buildPapersWithRequestedContext(scopedPapers, {
      summary: 'Use the papers selected for this turn.',
      mode: 'summary',
      reason: normalizedInstruction,
      paperIds: currentPaperScopeIds,
    }, {
      ragEnabled,
      categoryPathById: categoryPayload.categoryPathById,
    });
    paperInputs = enriched.inputs;
    contextLabel = enriched.label;
    const initialCitations = registerScopedCitations(enriched.citations);
    recordAgentCitations(artifacts, initialCitations);
    ragErrors.push(...enriched.ragErrors);
    for (const [paperId, context] of enriched.contexts) {
      const canonicalCitations = registerScopedCitations(context.citations);
      contexts.set(paperId, {
        ...context,
        citations: canonicalCitations,
        text: rewriteAgentCitationSourceLabels(context.text, context.citations, canonicalCitations),
      });
      contextModes.set(paperId, 'summary');
    }
  }

  const getPaperContext = async (
    paper: LiteraturePaper,
    input: { mode: 'summary' | 'pdf-text'; query: string; fullText?: boolean },
    contextOptions?: { signal?: AbortSignal },
  ): Promise<AgentPaperContextResult> => {
    const effectiveSignal = contextOptions?.signal ?? signal;
    if (effectiveSignal?.aborted) {
      const error = new Error('Agent run aborted');
      error.name = 'AbortError';
      throw error;
    }

    const current = contexts.get(paper.id);
    const loadedMode = contextModes.get(paper.id);
    const query = input.query || normalizedInstruction;
    const shouldReload = !current || loadedMode !== input.mode || (input.mode === 'pdf-text' && (
      fullTextContexts.has(paper.id) !== Boolean(input.fullText) || contextQueries.get(paper.id) !== query
    ));
    const context = shouldReload
      ? await loadPaperContext(paper, input.mode, query, {
        ragEnabled: input.fullText ? false : ragEnabled,
        signal: effectiveSignal,
      })
      : current;

    if (!context) {
      throw new Error(`Unable to load context for ${paper.title}.`);
    }

    const canonicalCitations = registerScopedCitations(context.citations);
    const canonicalContext = {
      ...context,
      citations: canonicalCitations,
      text: rewriteAgentCitationSourceLabels(context.text, context.citations, canonicalCitations),
    };

    if (shouldReload) {
      contexts.set(paper.id, canonicalContext);
      contextModes.set(paper.id, input.mode);
      contextQueries.set(paper.id, query);
      if (input.fullText) fullTextContexts.add(paper.id);
      else fullTextContexts.delete(paper.id);
    }

    recordAgentCitations(artifacts, canonicalCitations);
    if (canonicalContext.ragError?.trim() && !ragErrors.includes(canonicalContext.ragError.trim())) {
      ragErrors.push(canonicalContext.ragError.trim());
    }

    return canonicalContext;
  };

  const tools = createLibraryAgentTools({
    papers: allLibraryPapers,
    currentPaperScopeIds,
    searchRag,
    getPaperContext,
    memory: {
      read: async (file) => (await readAgentMemory(file)).content,
      createWritePlan(input) {
        return createAgentMemoryWritePlan(input);
      },
    },
    getFigure: preset.supportsVision
      ? async (paper, input) => {
        const context = await getPaperContext(paper, {
          mode: 'pdf-text',
          query: `Read paper figure ${input.blockId ?? ''} ${input.pageIndex ?? ''}`,
        });
        const figure = context.figures?.find((candidate) =>
          input.blockId
            ? candidate.blockId === input.blockId
            : input.pageIndex !== undefined
              ? candidate.pageIndex === input.pageIndex
              : false,
        );

        if (!figure) return null;
        const prepared = await prepareAgentVisionAttachments({
          supportsVision: true,
          candidates: [{
            id: `${paper.id}:${figure.id}`,
            source: 'tool',
            paperId: paper.id,
            paperTitle: paper.title,
            caption: figure.caption,
            path: figure.path,
            pageIndex: figure.pageIndex,
            blockId: figure.blockId,
            kind: figure.kind,
            score: 0,
          }],
        });
        const attachment = prepared.attachments[0];

        return attachment?.dataUrl ? { ...figure, dataUrl: attachment.dataUrl } : null;
      }
      : undefined,
    createWritePlan(tool, args) {
      const generatedPlan: LibraryAgentGeneratedPlan = {
        tool,
        summary: typeof args.summary === 'string' ? args.summary : `${tool} plan`,
        items: Array.isArray(args.items) ? args.items as LibraryAgentGeneratedItem[] : [],
      };
      const plan = convertGeneratedAgentPlan(tool, papers, generatedPlan);

      // 空计划不代表失败：模型合理判断“无需变更”时返回空 items，交给 UI 审批卡展示。
      return plan;
    },
  });
  let streamedAnswerTurn = 0;
  let streamedAnswer = '';
  let streamedThinkingTurn = 0;
  let streamedThinking = '';
  let finalAnswerFinishReason: string | undefined;
  let memoryContext = { topics: '', synthesis: '' };
  const nonVisionAttachments = (attachments ?? []).filter((attachment) =>
    attachment.kind !== 'image' &&
    attachment.kind !== 'screenshot' &&
    !attachment.mimeType.startsWith('image/'),
  );
  const visionCandidates = [
    ...userAttachmentVisionCandidates(attachments),
    ...[...contexts.values()].flatMap((context) => context.visionCandidates ?? []),
  ];
  let preparedVision = await prepareAgentVisionAttachments({
    candidates: visionCandidates,
    supportsVision: preset.supportsVision === true,
  });

  try {
    const [topics, synthesis] = await Promise.all([
      readAgentMemory('topics'),
      readAgentMemory('synthesis'),
    ]);
    memoryContext = {
      topics: topics.content,
      synthesis: synthesis.content,
    };
  } catch {
    // Missing or unreadable memory must not block ordinary Agent requests.
  }
  const result = await runAgentLoop({
    maxTurns: 8,
    tools,
    mountContext: {
      papersCount: papers.length,
      hasOpenDocument: papers.some((paper) => Boolean(paperPdfPath(paper))),
      ragReady,
      localLibraryMode: true,
    },
    runtimeContext: {
      citations,
    },
    messages: loopResumeMessages?.length
      ? [
        { role: 'system', content: AGENT_CITATION_PROTOCOL },
        ...loopResumeMessages,
        { role: 'user', content: normalizedInstruction, attachments },
      ]
      : buildReActAgentMessages({
        instruction: normalizedInstruction,
        historyMessages,
        responseLanguage,
        papers: paperInputs,
        categories: categoryPayload.categories,
        currentPaperScopeIds,
        paperScopes,
        attachments: [...nonVisionAttachments, ...preparedVision.attachments],
        memoryContext,
      }),
    contextLabel,
    citations,
    ragNotice: buildAgentRagNotice(ragErrors),
    contextCompaction: {
      contextWindow: preset.contextWindow,
      artifacts,
      async compact({ messages: messagesToCompact, artifacts: currentArtifacts }) {
        const summary = await runOpenAiCompatibleAgentChatTurn({
          options: {
            baseUrl: preset.baseUrl,
            apiKey: preset.apiKey.trim(),
            model: preset.model,
            apiMode: preset.apiMode,
            temperature: 0,
            reasoningEffort: 'low',
          },
          messages: [
            {
              role: 'system',
              content: [
                'Summarize the prior PaperQuay Agent conversation using exactly these headings:',
                '## 会话进度摘要',
                '- 目标:',
                '- 已完成:',
                '- 关键决定:',
                '- 引用的论文与页码:',
                '- 下一步:',
                'Do not include hidden reasoning or credentials.',
                AGENT_CITATION_PROTOCOL,
              ].join('\n'),
            },
            {
              role: 'user',
              content: JSON.stringify({
                messages: messagesToCompact.map((message) => ({ role: message.role, content: message.content })),
                artifacts: currentArtifacts,
              }),
            },
          ],
          toolChoice: 'none',
          stream: false,
          signal,
        });

        if (!summary.content.trim()) {
          throw new Error('Compaction model returned no summary.');
        }

        return summary.content;
      },
    },
    signal,
    chatTurn: (turnRequest) => runOpenAiCompatibleAgentChatTurn({
      options: {
        baseUrl: preset.baseUrl,
        apiKey: preset.apiKey.trim(),
        model: preset.model,
        apiMode: preset.apiMode,
        temperature: preset.temperature,
        reasoningEffort: preset.reasoningEffort,
        maxOutputTokens: preset.maxOutputTokens,
      },
      ...turnRequest,
    }),
    onEvent(event) {
      streamHandlers?.onLoopEvent?.(event);

      if (event.kind === 'turn_end') finalAnswerFinishReason = event.finishReason;

      if (event.kind === 'turn_start') {
        streamedAnswerTurn = event.turn;
        streamedThinkingTurn = event.turn;
        streamedAnswer = '';
        streamedThinking = '';
      } else if (event.kind === 'answer_delta') {
        if (streamedAnswerTurn !== event.turn) {
          streamedAnswerTurn = event.turn;
          streamedAnswer = '';
        }
        streamedAnswer += event.text;
        streamHandlers?.onDelta?.(event.text, streamedAnswer, event.turn);
      } else if (event.kind === 'thinking_delta') {
        if (streamedThinkingTurn !== event.turn) {
          streamedThinkingTurn = event.turn;
          streamedThinking = '';
        }
        streamedThinking += event.text;
        streamHandlers?.onThinkingDelta?.(event.text, streamedThinking, event.turn);
      } else if (event.kind === 'tool_call') {
        recordToolPaperIds(artifacts, event.args);
      } else if (event.kind === 'error') {
        streamHandlers?.onError?.(event.message);
      }
    },
    onCheckpoint(checkpoint) {
      streamHandlers?.onRecoveryCheckpoint?.(checkpoint.messages, checkpoint.turn, citations.map((citation) => ({ ...citation })));
    },
  });

  streamHandlers?.onDone?.();
  const ragNotice = buildAgentRagNotice(ragErrors);
  const figureReferences: LibraryAgentFigureReference[] = preparedVision.included
    .filter((candidate) => candidate.source === 'rag' && candidate.paperId && candidate.paperTitle)
    .map((candidate) => ({
      id: candidate.id,
      paperId: candidate.paperId ?? '',
      paperTitle: candidate.paperTitle ?? '',
      caption: candidate.caption,
      path: candidate.path ?? '',
      pageIndex: candidate.pageIndex,
      blockId: candidate.blockId,
      kind: candidate.kind,
    }));
  const visionNotice = preparedVision.notice;

  if (result.kind === 'answer') {
    const deliveryRunState = finalAnswerFinishReason === 'length' || finalAnswerFinishReason === 'max_turns' ? 'budget' : 'completed';
    const shouldInspectDelivery = deliveryRequirement.kind !== 'general'
      || deliveryRequirement.completeness === 'full'
      || Boolean(deliveryRequirement.requiredSections?.length)
      || deliveryRunState !== 'completed';
    return {
      ...result,
      ...await verifyLibraryAgentAnswerCitations({ answer: result.answer, citations, preset, signal, streamHandlers }),
      deliveryQuality: shouldInspectDelivery ? inspectAgentDeliveryQuality({
        markdown: result.answer,
        requirement: deliveryRequirement,
        runState: deliveryRunState,
      }) : undefined,
      citations,
      figures: figureReferences,
      visionNotice,
      ragNotice,
      thinking: result.thinking || streamedThinking || null,
    };
  }

  if (result.kind === 'memory-plan') {
    return {
      ...result,
      citations,
      figures: figureReferences,
      visionNotice,
      ragNotice,
    };
  }

  if (result.kind === 'note-plan') {
    return {
      ...result,
      citations,
      figures: figureReferences,
      visionNotice,
      ragNotice,
    };
  }

  if (result.kind === 'plan') {
    return {
      ...result,
      citations,
      figures: figureReferences,
      visionNotice,
      ragNotice,
    };
  }

  return result;
}
