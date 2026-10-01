/**
 * 引用核对能力（方案第 5.2 节）。
 *
 * 阶段编排：extract -> retrieve -> judge -> report。
 * - extract：从用户指令（或其中引用的上一条回答）抽取最多 8 条可核对主张；抽不出直接说明，不编造。
 * - retrieve：对每条主张复用与 rag_search 相同的检索函数取 topK 8 片段，不新写检索器。
 * - judge：全案唯一允许用模型判断「片段是否支持该句」的地方。输入引用先经 bindAnswerEvidence
 *   编号解析，解析不到（悬挂编号）的主张直接标记 not-in-library，不送模型；模型只允许依据
 *   检索片段判定 supported / partial / not-in-library / contradicted，片段不足时必须是
 *   not-in-library 或 partial，禁止用参数知识补全为 supported。
 *
 * 本能力不创建笔记；rejectedClaimLines 仅是建议，由 UI 决定是否生成 write_memory 审批卡。
 */

import { bindAnswerEvidence, type InputCitation } from './agentAnswerEvidence.ts';
import { formatRejectedClaimLine, type RejectedClaimLine } from './agentMemoryContract.ts';

export type CitationAuditStatus = 'supported' | 'partial' | 'not-in-library' | 'contradicted';

export interface CitationAuditClaimCitation {
  paperId: string;
  paperTitle: string;
  pageIndex: number | null;
  blockId: string | null;
  snippet: string;
}

export interface CitationAuditClaim {
  id: string;
  text: string;
  status: CitationAuditStatus;
  citations: CitationAuditClaimCitation[];
  reason: string;
}

export interface CitationAuditResult {
  claims: CitationAuditClaim[];
  markdown: string;
  /** 仅 not-in-library / contradicted 主张，工作记忆 Rejected claims 行格式；仅建议，不落盘。 */
  rejectedClaimLines: string[];
}

export type CitationAuditStage = 'extract' | 'retrieve' | 'judge' | 'report';

export type CitationAuditEvent =
  | { kind: 'stage_start'; stage: CitationAuditStage; attempt: number }
  | { kind: 'stage_progress'; stage: CitationAuditStage; completed: number; total: number; detail?: string }
  | { kind: 'stage_end'; stage: CitationAuditStage }
  | { kind: 'stage_retry'; stage: CitationAuditStage; attempt: number; error: string };

/** 一条可核对的检索证据片段。pageIndex 为 0 基（与 BoundCitation 一致）。 */
export interface CitationAuditSnippet {
  paperId: string;
  paperTitle: string;
  pageIndex: number | null;
  blockId: string | null;
  snippet: string;
}

export interface CitationAuditJudgeVerdict {
  status: CitationAuditStatus;
  reason: string;
  /** 支撑判定的片段序号（1 基，对应该主张的检索片段列表）。 */
  snippetIndexes?: number[];
}

/** 模型输入输出接口：extract 与 judge 各一次模型调用，均可注入替身以便测试。 */
export interface CitationAuditModelIO {
  extractClaims(input: { instruction: string }): Promise<string[]>;
  judgeClaim(input: { claim: string; snippets: CitationAuditSnippet[] }): Promise<CitationAuditJudgeVerdict>;
}

export interface CitationAuditCallModel {
  (input: { system: string; user: string; signal?: AbortSignal }): Promise<{ content: string }>;
}

export const CITATION_AUDIT_MAX_CLAIMS = 8;
export const CITATION_AUDIT_SNIPPETS_PER_CLAIM = 8;

const AUDIT_STATUSES: ReadonlySet<string> = new Set(['supported', 'partial', 'not-in-library', 'contradicted']);

const AUDIT_STATUS_LABELS: Record<CitationAuditStatus, string> = {
  supported: '支持',
  partial: '部分支持',
  'not-in-library': '库内无证据',
  contradicted: '证据相反',
};

function abortError(): Error {
  const error = new Error('Citation audit cancelled');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw abortError();
  }
}

function truncateText(value: string, maxChars: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '｜').replace(/\s+/g, ' ').trim();
}

/** 把检索片段整形成 bindAnswerEvidence 的编号解析输入（编号为片段顺序 1..n）。 */
function snippetsToInputCitations(snippets: CitationAuditSnippet[]): InputCitation[] {
  return snippets.map((snippet, index) => ({
    label: String(index + 1),
    paperId: snippet.paperId,
    paperTitle: snippet.paperTitle,
    pageIndex: snippet.pageIndex,
    blockId: snippet.blockId,
    previewText: snippet.snippet,
  }));
}

function snippetToClaimCitation(snippet: CitationAuditSnippet): CitationAuditClaimCitation {
  return {
    paperId: snippet.paperId,
    paperTitle: snippet.paperTitle,
    pageIndex: snippet.pageIndex,
    blockId: snippet.blockId,
    snippet: snippet.snippet,
  };
}

function sharesSpecificFact(left: string, right: string): boolean {
  const numbers: string[] = left.match(/\d+(?:\.\d+)?/g) ?? [];
  const rightNumbers: string[] = right.match(/\d+(?:\.\d+)?/g) ?? [];
  if (numbers.length === 0 || !numbers.some((number) => rightNumbers.includes(number))) {
    return false;
  }
  const leftTerms = left.match(/[\p{Script=Han}]{4,}/gu) ?? [];
  const rightTerms = right.match(/[\p{Script=Han}]{4,}/gu) ?? [];
  return leftTerms.some((term) => rightTerms.some((other) => {
    for (let index = 0; index <= term.length - 4; index += 1) {
      if (other.includes(term.slice(index, index + 4))) return true;
    }
    return false;
  }));
}

/**
 * 从模型输出解析主张列表：去项目符号/编号、过滤过短行、去重、截到上限。
 * 模型没抽出实质主张时返回空数组——上游据此直接说明，不编造主张。
 */
export function sanitizeExtractedClaims(
  rawClaims: string[],
  maxClaims: number = CITATION_AUDIT_MAX_CLAIMS,
  sourceText?: string,
): string[] {
  const seen = new Set<string>();
  const claims: string[] = [];
  const normalizedSource = sourceText?.replace(/\s+/g, ' ').toLocaleLowerCase();

  for (const raw of Array.isArray(rawClaims) ? rawClaims : []) {
    const text = String(raw ?? '')
      .replace(/^\s*(?:[-*+•]|\d+[.、)）])\s*/, '')
      .trim();

    // 短于 8 字的行不足以构成可核对主张
    if (text.length < 8 || seen.has(text) ||
      (normalizedSource !== undefined && !normalizedSource.includes(text.replace(/\s+/g, ' ').toLocaleLowerCase()))) {
      continue;
    }

    seen.add(text);
    claims.push(text);

    if (claims.length >= Math.max(1, Math.trunc(maxClaims))) {
      break;
    }
  }

  return claims;
}

/** 归一化 judge 输出：状态只能是四值之一；拿不准或输出非法一律回落为 partial。 */
export function normalizeAuditVerdict(verdict: CitationAuditJudgeVerdict | null | undefined): CitationAuditJudgeVerdict {
  if (!verdict || !AUDIT_STATUSES.has(String(verdict.status))) {
    return { status: 'partial', reason: '模型判定输出无法解析，按部分支持处理（拿不准用 partial）。' };
  }

  const reason = typeof verdict.reason === 'string' && verdict.reason.trim()
    ? verdict.reason.trim()
    : '模型未给出判定理由。';
  const snippetIndexes = Array.isArray(verdict.snippetIndexes)
    ? verdict.snippetIndexes.filter((index) => Number.isInteger(index) && index > 0)
    : undefined;

  return {
    status: verdict.status as CitationAuditStatus,
    reason,
    ...(snippetIndexes && snippetIndexes.length > 0 ? { snippetIndexes } : {}),
  };
}

/** 结构化展示表：主张、状态、页码、理由（状态用文字，不只靠颜色）。 */
export function buildCitationAuditMarkdown(claims: CitationAuditClaim[]): string {
  if (claims.length === 0) {
    return [
      '## 引用核对结果',
      '',
      '未能从指令中抽取出可用文献库核对的实质主张。请把需要核对的句子直接写进指令（或引用上一条回答），再运行引用核对。',
    ].join('\n');
  }

  const counts: Record<CitationAuditStatus, number> = {
    supported: 0,
    partial: 0,
    'not-in-library': 0,
    contradicted: 0,
  };
  for (const claim of claims) {
    counts[claim.status] += 1;
  }

  const lines: string[] = [
    '## 引用核对结果',
    '',
    `共 ${claims.length} 条主张：支持 ${counts.supported} · 部分支持 ${counts.partial} · 库内无证据 ${counts['not-in-library']} · 证据相反 ${counts.contradicted}。`,
    '',
    '| # | 主张 | 状态 | 页码 | 理由 |',
    '| --- | --- | --- | --- | --- |',
  ];

  claims.forEach((claim, index) => {
    const pageLabels = [...new Set(
      claim.citations.map((citation) => {
        const page = citation.pageIndex === null || citation.pageIndex === undefined
          ? '全文'
          : `p.${citation.pageIndex + 1}`;
        return `《${citation.paperTitle}》${page}`;
      }),
    )].slice(0, 3).join('；');

    lines.push(
      `| ${index + 1} | ${escapeTableCell(truncateText(claim.text, 120))} | ${AUDIT_STATUS_LABELS[claim.status]} | ${escapeTableCell(pageLabels) || '—'} | ${escapeTableCell(truncateText(claim.reason, 120))} |`,
    );
  });

  return lines.join('\n');
}

/**
 * 引用核对能力入口。
 * 产出 { kind: 'audit', audit }；失败（模型/检索异常）向上抛出，由调用方决定降级。
 */
export async function runCitationAuditCapability(input: {
  instruction: string;
  /** 仅当用户明确指代上一条回答时，由调用方提供最近一条真实回答。 */
  priorAssistantAnswer?: string;
  model: CitationAuditModelIO;
  retrieve: (claim: string) => Promise<CitationAuditSnippet[]>;
  signal?: AbortSignal;
  onEvent?: (event: CitationAuditEvent) => void;
  maxClaims?: number;
}): Promise<{ kind: 'audit'; audit: CitationAuditResult }> {
  const emit = (event: CitationAuditEvent) => input.onEvent?.(event);
  const maxClaims = Math.max(1, Math.min(CITATION_AUDIT_MAX_CLAIMS, Math.trunc(input.maxClaims ?? CITATION_AUDIT_MAX_CLAIMS)));

  throwIfAborted(input.signal);

  // ---- extract ----
  emit({ kind: 'stage_start', stage: 'extract', attempt: 1 });
  const refersToPriorAnswer = /上一条(?:回答|回复)|上条(?:回答|回复)|刚才(?:的)?(?:回答|回复)|前一条(?:回答|回复)|previous\s+(?:answer|reply)/i.test(input.instruction);
  const claimSource = refersToPriorAnswer && input.priorAssistantAnswer?.trim()
    ? input.priorAssistantAnswer.trim()
    : input.instruction;
  const rawClaims = await input.model.extractClaims({ instruction: claimSource });
  throwIfAborted(input.signal);
  const claimTexts = sanitizeExtractedClaims(rawClaims, maxClaims, claimSource);
  emit({ kind: 'stage_end', stage: 'extract' });

  if (claimTexts.length === 0) {
    emit({ kind: 'stage_start', stage: 'report', attempt: 1 });
    emit({ kind: 'stage_progress', stage: 'report', completed: 1, total: 1, detail: '没有可核对主张' });
    emit({ kind: 'stage_end', stage: 'report' });
    return {
      kind: 'audit',
      audit: {
        claims: [],
        markdown: buildCitationAuditMarkdown([]),
        rejectedClaimLines: [],
      },
    };
  }

  // ---- retrieve：复用与 rag_search 相同的检索函数，每条主张 topK 8 ----
  emit({ kind: 'stage_start', stage: 'retrieve', attempt: 1 });
  const snippetsByClaim: CitationAuditSnippet[][] = [];
  for (const [index, claimText] of claimTexts.entries()) {
    throwIfAborted(input.signal);
    const snippets = (await input.retrieve(claimText)).slice(0, CITATION_AUDIT_SNIPPETS_PER_CLAIM);
    snippetsByClaim.push(snippets);
    emit({
      kind: 'stage_progress',
      stage: 'retrieve',
      completed: index + 1,
      total: claimTexts.length,
      detail: truncateText(claimText, 40),
    });
  }
  emit({ kind: 'stage_end', stage: 'retrieve' });

  // ---- judge：编号解析先过滤，解析不到的主张直接 not-in-library，不送模型 ----
  emit({ kind: 'stage_start', stage: 'judge', attempt: 1 });
  const claims: CitationAuditClaim[] = [];

  for (const [index, claimText] of claimTexts.entries()) {
    throwIfAborted(input.signal);
    let snippets = snippetsByClaim[index] ?? [];
    if (snippets.length === 0) {
      const relatedIndex = claimTexts.findIndex((other, otherIndex) =>
        otherIndex !== index && snippetsByClaim[otherIndex]?.length && sharesSpecificFact(claimText, other));
      if (relatedIndex >= 0) snippets = snippetsByClaim[relatedIndex];
    }
    const claimId = `claim-${index + 1}`;

    if (snippets.length === 0) {
      // 没有检索片段的主张绝不能是 supported（方案验收红线）。
      claims.push({
        id: claimId,
        text: claimText,
        status: 'not-in-library',
        citations: [],
        reason: '库内未检索到相关片段，无法核对（未送模型判定）。',
      });
      emit({ kind: 'stage_progress', stage: 'judge', completed: index + 1, total: claimTexts.length, detail: truncateText(claimText, 40) });
      continue;
    }

    const bound = bindAnswerEvidence({
      answer: claimText,
      citations: snippetsToInputCitations(snippets),
    });
    const hasDanglingCitation = bound.claims.some((claim) => claim.reason === 'dangling-citation');

    if (hasDanglingCitation) {
      claims.push({
        id: claimId,
        text: claimText,
        status: 'not-in-library',
        citations: [],
        reason: '主张携带的 [n] 编号无法解析到本次检索片段（悬挂引用），未送模型判定。',
      });
      emit({ kind: 'stage_progress', stage: 'judge', completed: index + 1, total: claimTexts.length, detail: truncateText(claimText, 40) });
      continue;
    }

    let verdict: CitationAuditJudgeVerdict;
    try {
      verdict = normalizeAuditVerdict(await input.model.judgeClaim({ claim: claimText, snippets }));
    } catch (error) {
      if (input.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw abortError();
      }
      // judge 单条失败按 partial 处理，不中断其余主张（拿不准用 partial）。
      verdict = {
        status: 'partial',
        reason: `模型判定调用失败，按部分支持处理：${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const citedSnippets = verdict.snippetIndexes?.length
      ? verdict.snippetIndexes
        .map((snippetIndex) => snippets[snippetIndex - 1])
        .filter((snippet): snippet is CitationAuditSnippet => Boolean(snippet))
      : [];
    if ((verdict.status === 'supported' || verdict.status === 'contradicted') && citedSnippets.length === 0) {
      verdict = { status: 'partial', reason: '判定未指定可核对的证据片段，不能确认支持或相反。' };
    }

    claims.push({
      id: claimId,
      text: claimText,
      status: verdict.status,
      citations: verdict.status === 'not-in-library' ? [] : citedSnippets.map(snippetToClaimCitation),
      reason: verdict.reason,
    });
    emit({ kind: 'stage_progress', stage: 'judge', completed: index + 1, total: claimTexts.length, detail: truncateText(claimText, 40) });
  }
  emit({ kind: 'stage_end', stage: 'judge' });

  // report 是确定性的展示阶段，不调用模型；单独发出阶段事件让 UI 与运行记录完整反映四阶段生命周期。
  emit({ kind: 'stage_start', stage: 'report', attempt: 1 });
  emit({ kind: 'stage_progress', stage: 'report', completed: 0, total: 1, detail: '正在生成核对报告' });

  // rejectedClaimLines 只收录 not-in-library 与 contradicted，格式遵循工作记忆契约。
  const rejectedClaimLines = claims
    .filter((claim): claim is CitationAuditClaim & { status: 'not-in-library' | 'contradicted' } =>
      claim.status === 'not-in-library' || claim.status === 'contradicted')
    .map((claim) => formatRejectedClaimLine({
      text: claim.text,
      status: claim.status,
      reason: claim.reason,
      source: 'citation-audit',
    } satisfies RejectedClaimLine));

  emit({ kind: 'stage_progress', stage: 'report', completed: 1, total: 1, detail: '核对报告已生成' });
  emit({ kind: 'stage_end', stage: 'report' });

  return {
    kind: 'audit',
    audit: {
      claims,
      markdown: buildCitationAuditMarkdown(claims),
      rejectedClaimLines,
    },
  };
}

// ---------------------------------------------------------------------------
// 模型适配器：用真实 callModel 构建 extract / judge 的模型调用。
// ---------------------------------------------------------------------------

const EXTRACT_CLAIMS_SYSTEM_PROMPT = [
  '你是文献引用核对的主张抽取器。从用户给出的文本中抽取最多 8 条「可核对主张」：可以用文献库证据判定真伪的事实性陈述句。',
  '规则：',
  '- 每行输出一条主张，不要编号以外的任何内容，不要解释；',
  '- 问题、命令、寒暄、纯观点偏好不算可核对主张；',
  '- 保留主张中已有的 [n] 引用编号；',
  '- 必须逐字摘取用户文本中的连续原句，不要改写、解释或补充；',
  '- 如果文本中没有可核对的实质主张，输出空（不要编造主张）。',
].join('\n');

const JUDGE_SYSTEM_PROMPT = [
  '你是文献引用核对器。只允许依据用户消息中给出的检索片段判断主张的证据状态，严禁使用你自己的参数知识补全证据。',
  '状态只允许四个值：',
  '- supported：检索片段明确且完整地支持该主张；',
  '- partial：片段只支持主张的一部分，或表述不够直接；拿不准时必须用 partial；',
  '- not-in-library：片段与主张无关，或不足以支持该主张；',
  '- contradicted：片段明确与主张相反（仅在确定相反时使用）。',
  '硬性约束：片段不足以支持时，状态必须是 not-in-library 或 partial，禁止把状态判为 supported。',
  '只输出一个 JSON 对象：{"status": "supported|partial|not-in-library|contradicted", "reason": "一句话理由", "snippetIndexes": [支撑判定的片段序号]}',
].join('\n');

/** 从模型输出中提取第一个 JSON 对象并解析。 */
function parseJsonObjectFromModelOutput(raw: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const candidate = fenced ? fenced[1] : (/\{[\s\S]*\}/.exec(raw)?.[0] ?? '');

  if (!candidate.trim()) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(candidate);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/** 用真实模型调用构建 CitationAuditModelIO（judge 提示词严格约束四状态）。 */
export function createCitationAuditModelIO(callModel: CitationAuditCallModel): CitationAuditModelIO {
  return {
    async extractClaims({ instruction }) {
      const response = await callModel({ system: EXTRACT_CLAIMS_SYSTEM_PROMPT, user: instruction });
      return response.content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    },

    async judgeClaim({ claim, snippets }) {
      const snippetText = snippets
        .map((snippet, index) => {
          const pageLabel = snippet.pageIndex === null || snippet.pageIndex === undefined
            ? '全文'
            : `第 ${snippet.pageIndex + 1} 页`;
          return `[${index + 1}] 《${snippet.paperTitle}》${pageLabel}\n${truncateText(snippet.snippet, 600)}`;
        })
        .join('\n\n');
      const response = await callModel({
        system: JUDGE_SYSTEM_PROMPT,
        user: `主张：${claim}\n\n检索片段：\n${snippetText}`,
      });
      const parsed = parseJsonObjectFromModelOutput(response.content);

      if (!parsed) {
        return normalizeAuditVerdict(null);
      }

      return normalizeAuditVerdict({
        status: parsed.status as CitationAuditStatus,
        reason: typeof parsed.reason === 'string' ? parsed.reason : '',
        snippetIndexes: Array.isArray(parsed.snippetIndexes)
          ? parsed.snippetIndexes.filter((index): index is number => Number.isInteger(index))
          : undefined,
      });
    },
  };
}
