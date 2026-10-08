import type { NotePageKind } from '../types/notes';

export type AnswerEvidenceStatus = 'supported' | 'partial' | 'not-in-library';

export interface BoundCitation {
  label: string;
  paperId: string;
  paperTitle: string;
  pageIndex: number | null;
  blockId: string | null;
  snippet: string;
}

export interface AnswerEvidenceClaim {
  text: string;
  status: AnswerEvidenceStatus;
  citations: BoundCitation[];
  reason: 'snippet-overlap' | 'cited-without-overlap' | 'no-citation-in-run' | 'dangling-citation' | 'citation-mismatch';
}

export interface InputCitation {
  /** Stable canonical citation id; enables [[cite:<id>]] tokens from the model. */
  id?: string;
  label: string;
  paperId: string;
  paperTitle: string;
  pageIndex?: number | null;
  blockId?: string | null;
  previewText?: string;
}

export interface NoteDraftForEvidence {
  title?: string;
  content: string;
  pageKind?: NotePageKind | string;
}

/**
 * 提取主张中的有效词汇（长度 >= 2 的不重复中文片段，或长度 >= 4 的英文单词）。
 */
function extractOverlapTokens(text: string): string[] {
  const tokens = new Set<string>();

  // 1. 英文单词（长度 >= 4，转小写）
  const englishWords = text.match(/[A-Za-z]{4,}/g);
  if (englishWords) {
    for (const word of englishWords) {
      tokens.add(word.toLowerCase());
    }
  }

  // 2. 中文片段（长度 >= 2 的连续片段）
  const chineseBlocks = text.match(/[\u4e00-\u9fa5]+/g);
  if (chineseBlocks) {
    for (const block of chineseBlocks) {
      if (block.length === 2 || block.length === 3) {
        tokens.add(block);
      } else if (block.length >= 4) {
        // 拆分成 2-3 字的独立/半步进子片段，避免过度碎化
        for (let i = 0; i <= block.length - 2; i += 2) {
          const slice = block.slice(i, i + 2);
          if (slice.length >= 2) {
            tokens.add(slice);
          }
        }
        if (block.length % 2 !== 0) {
          tokens.add(block.slice(-2));
        }
      }
    }
  }

  return Array.from(tokens);
}

/**
 * 计算 tokens 在目标文本中的重叠命中数。
 */
function countTokenMatches(tokens: string[], targetText: string): number {
  if (!targetText || tokens.length === 0) {
    return 0;
  }
  const lowerTarget = targetText.toLowerCase();
  let matches = 0;
  for (const token of tokens) {
    if (lowerTarget.includes(token)) {
      matches += 1;
    }
  }
  return matches;
}

/**
 * 规范化引用编号标签，去除方括号以便比较。
 */
function normalizeCitationLabel(label: string): string {
  return label.replace(/[\[\]]/g, '').trim();
}

function hasExplicitCitationMetadataMismatch(
  sentence: string,
  boundCitations: BoundCitation[],
  availableCitations: InputCitation[],
): boolean {
  if (boundCitations.length === 0) return false;

  const boundPaperIds = new Set(boundCitations.map((citation) => citation.paperId));
  const namesAnotherAvailablePaper = availableCitations.some((citation) =>
    !boundPaperIds.has(citation.paperId) &&
    citation.paperTitle.trim().length >= 4 &&
    sentence.includes(citation.paperTitle.trim()),
  );
  if (namesAnotherAvailablePaper) return true;

  const mentionedPages = Array.from(sentence.matchAll(/(?:第\s*(\d+)\s*页|\bp\.?\s*(\d+)\b|\bpage\s*(\d+)\b)/gi))
    .map((match) => Number(match[1] ?? match[2] ?? match[3]))
    .filter((page) => Number.isFinite(page) && page > 0);
  if (mentionedPages.length === 0) return false;

  return boundCitations.some((citation) =>
    citation.pageIndex !== null && !mentionedPages.includes(citation.pageIndex + 1),
  );
}

/**
 * 纯字符串回答证据绑定（100% 同步纯函数，零模型调用）。
 */
export function bindAnswerEvidence(input: {
  answer: string;
  citations: InputCitation[];
}): { claims: AnswerEvidenceClaim[]; counts: Record<AnswerEvidenceStatus, number> } {
  const claims: AnswerEvidenceClaim[] = [];
  const counts: Record<AnswerEvidenceStatus, number> = {
    supported: 0,
    partial: 0,
    'not-in-library': 0,
  };

  // Canonical structured tokens [[cite:<id>]] resolve to numeric labels before
  // any sentence processing; unknown ids are left intact and treated as dangling.
  const citationIdToLabel = new Map<string, string>();
  for (const citation of input.citations ?? []) {
    if (citation.id && citation.label) {
      citationIdToLabel.set(citation.id, normalizeCitationLabel(citation.label));
    }
  }
  const answer = input.answer.replace(/\[\[cite:([^\]]+)\]\]/gi, (match, rawId: string) => {
    const label = citationIdToLabel.get(rawId.trim());
    return label ? `[${label}]` : match;
  });

  if (!answer) {
    return { claims, counts };
  }

  // 1. 切句预处理：去除代码块
  const withoutCodeBlocks = answer.replace(/```[\s\S]*?```/g, '');

  // 按行初步拆分，滤掉 Markdown 标题行、空行
  const lines = withoutCodeBlocks.split(/\r?\n/);
  const candidateTexts: string[] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;
    // 忽略 Markdown 标题行 (# ...)
    if (/^#{1,6}\s+/.test(trimmedLine)) continue;

    // 分号连接的从句通常共用句末引用，不能在引用之前拆开。
    const rawSegments = trimmedLine.split(/(?<=[。！？!?])|(?<=\.\s+)|(?<=\.$)/);
    for (const seg of rawSegments) {
      const trimmedSeg = seg.trim();
      if (!trimmedSeg) continue;
      // A citation placed after sentence punctuation still belongs to that sentence.
      if (/^(?:\[\[([^\]]+)\]\]|\[\d+\])+$/.test(trimmedSeg) && candidateTexts.length > 0) {
        candidateTexts[candidateTexts.length - 1] += ` ${trimmedSeg}`;
      } else {
        candidateTexts.push(trimmedSeg);
      }
    }
  }

  // 2. 句子过滤。保留句末引用，避免长句截断时丢失来源。
  const processedSentences: string[] = [];
  for (const raw of candidateTexts) {
    const contentWithoutCitations = raw.replace(/\[\d+\]/g, '').trim();

    // 忽略只含引用编号的行
    if (contentWithoutCitations.length === 0) {
      continue;
    }
    // 忽略纯问句
    if (contentWithoutCitations.endsWith('?') || contentWithoutCitations.endsWith('？')) {
      continue;
    }
    // 忽略短于 12 字符的短句
    if (contentWithoutCitations.length < 12) {
      continue;
    }

    processedSentences.push(raw);
  }

  // 构建可用引用索引
  const availableCitations = input.citations ?? [];
  const citationsByLabel = new Map<string, InputCitation[]>();
  for (const cit of availableCitations) {
    const label = normalizeCitationLabel(cit.label);
    if (!label) continue;
    const matches = citationsByLabel.get(label) ?? [];
    matches.push(cit);
    citationsByLabel.set(label, matches);
  }
  const citationByLabel = new Map<string, InputCitation>();
  for (const [label, matches] of citationsByLabel) {
    if (matches.length === 1) citationByLabel.set(label, matches[0]);
  }

  // 3. 对每条主张做编号与文献匹配，以及重叠判定
  for (const sentence of processedSentences) {
    // 解析 [n] 编号
    const citationLabelMatches = Array.from(sentence.matchAll(/\[(\d+)\]/g));
    const matchedCitationLabels = citationLabelMatches.map((m) => m[1]);

    // 模型常以“标题前缀, p.N”标页码；仅在标题前缀唯一且该页确在当次引用中时绑定。
    const pageReferences = Array.from(sentence.matchAll(/\[([^\[\]]{8,}?),\s*p\.(\d+)(?:\s*,\s*p\.(\d+))*\]/gi));
    const matchedByPage: InputCitation[] = [];
    for (const reference of pageReferences) {
      const titlePrefix = reference[1].trim().toLocaleLowerCase();
      const paperIds = [...new Set(availableCitations
        .filter((citation) => citation.paperTitle.toLocaleLowerCase().startsWith(titlePrefix))
        .map((citation) => citation.paperId))];
      if (paperIds.length !== 1) continue;
      const pages = [...reference[0].matchAll(/p\.(\d+)/gi)].map((match) => Number(match[1]) - 1);
      matchedByPage.push(...availableCitations.filter((citation) =>
        citation.paperId === paperIds[0] && citation.pageIndex != null && pages.includes(citation.pageIndex)));
    }
    const uniquePaperIds = [...new Set(availableCitations.map((citation) => citation.paperId))];
    if (uniquePaperIds.length === 1) {
      for (const reference of sentence.matchAll(/\[p\.(\d+)\]/gi)) {
        const pageIndex = Number(reference[1]) - 1;
        matchedByPage.push(...availableCitations.filter((citation) => citation.pageIndex === pageIndex));
      }
    }

    // 检查论文标题精确匹配（只有唯一精确匹配时才可解析）
    const matchedByTitle: InputCitation[] = [];
    for (const cit of availableCitations) {
      const cleanTitle = cit.paperTitle?.trim();
      if (cleanTitle && cleanTitle.length >= 4 && sentence.includes(cleanTitle)) {
        if (!matchedByTitle.some((item) => item.paperId === cit.paperId)) {
          matchedByTitle.push(cit);
        }
      }
    }

    const boundCitations: BoundCitation[] = [];
    let hasDanglingCitation = false;

    if (matchedCitationLabels.length > 0) {
      for (const label of matchedCitationLabels) {
        const found = citationByLabel.get(label);
        if (found) {
          if (!boundCitations.some((b) => b.label === found.label && b.paperId === found.paperId)) {
            boundCitations.push({
              label: found.label,
              paperId: found.paperId,
              paperTitle: found.paperTitle,
              pageIndex: found.pageIndex ?? null,
              blockId: found.blockId ?? null,
              snippet: found.previewText ?? '',
            });
          }
        } else {
          hasDanglingCitation = true;
        }
      }
    } else if (matchedByPage.length > 0) {
      for (const found of matchedByPage) {
        if (boundCitations.some((citation) => citation.label === found.label && citation.paperId === found.paperId)) continue;
        boundCitations.push({
          label: found.label,
          paperId: found.paperId,
          paperTitle: found.paperTitle,
          pageIndex: found.pageIndex ?? null,
          blockId: found.blockId ?? null,
          snippet: found.previewText ?? '',
        });
      }
    } else if (matchedByTitle.length === 1) {
      // 唯一精确匹配
      const found = matchedByTitle[0];
      boundCitations.push({
        label: found.label,
        paperId: found.paperId,
        paperTitle: found.paperTitle,
        pageIndex: found.pageIndex ?? null,
        blockId: found.blockId ?? null,
        snippet: found.previewText ?? '',
      });
    }

    // 状态与原因判定
    let status: AnswerEvidenceStatus;
    let reason: AnswerEvidenceClaim['reason'];

    if (boundCitations.length === 0) {
      status = 'not-in-library';
      reason = hasDanglingCitation ? 'dangling-citation' : 'no-citation-in-run';
    } else if (hasExplicitCitationMetadataMismatch(sentence, boundCitations, availableCitations)) {
      status = 'partial';
      reason = 'citation-mismatch';
    } else {
      // 提取主张中的关键词并在引用片段中计算重叠
      const claimText = sentence.replace(/\[\[[^\]]+\]\]|\[[^\[\]]*p\.\d+[^\[\]]*\]|\[\d+\]/gi, '')
        .replace(/《[^》]+》\s*p\.\d+(?:\s*[-–]\s*\d+)?/gi, '');
      const claimTokens = extractOverlapTokens(claimText);
      const claimNumbers: string[] = claimText.match(/\d+(?:\.\d+)?/g) ?? [];
      let maxOverlap = 0;

      for (const cit of boundCitations) {
        const snippetNumbers: string[] = cit.snippet.match(/\d+(?:\.\d+)?/g) ?? [];
        if (claimNumbers.some((number) => !snippetNumbers.includes(number))) continue;
        const count = countTokenMatches(claimTokens, cit.snippet);
        if (count > maxOverlap) {
          maxOverlap = count;
        }
      }

      // 判定阈值：至少两个中文片段或英文词出现在对应 previewText 中
      if (maxOverlap >= 2) {
        status = 'supported';
        reason = 'snippet-overlap';
      } else {
        status = 'partial';
        reason = 'cited-without-overlap';
      }
    }

    counts[status] += 1;
    claims.push({
      text: sentence.length > 240 ? `${sentence.slice(0, 240)}…` : sentence,
      status,
      citations: boundCitations,
      reason,
    });
  }

  return { claims, counts };
}

/**
 * 笔记草稿证据门禁断言纯函数。
 * 门禁规则：
 * - excerpt 和 synthesis：若包含任何 partial 或 not-in-library 实质句，立即抛出错误；
 * - qa：not-in-library 拒绝；partial 仅当该句包含「我的推断」时放行；且「证据位置」段中的编号必须能解析到当次引用；
 * - concept、paper-card：not-in-library 拒绝；partial 仅当该句包含「我的推断」时放行；
 * - index、log、overview：直接放行。
 */
export function assertEvidenceForNoteDraft(
  draft: NoteDraftForEvidence,
  citations: InputCitation[],
): void {
  const pageKind = draft.pageKind;

  // index, log, overview 无需门禁检查，直接放行
  if (pageKind === 'index' || pageKind === 'log' || pageKind === 'overview') {
    return;
  }

  // “证据位置”是定位元数据，不是需要证据重叠的事实句；先从 QA 正文判定中剥离，
  // 但保留下面的编号存在性检查，避免悬空引用进入笔记。
  const evidenceLocationSectionMatch = pageKind === 'qa'
    ? draft.content.match(/(?:证据位置|Evidence Location)[\s\S]*?(?=(?:\n#{1,6}\s+|$))/)
    : null;
  const claimText = evidenceLocationSectionMatch
    ? draft.content.replace(evidenceLocationSectionMatch[0], '')
    : draft.content;
  const { claims } = bindAnswerEvidence({
    answer: claimText,
    citations,
  });

  // 如果是 excerpt 或 synthesis：所有实质句必须全为 supported
  if (pageKind === 'excerpt' || pageKind === 'synthesis') {
    for (const claim of claims) {
      if (claim.status !== 'supported') {
        throw new Error(
          `写入笔记草稿被门禁拦截（pageKind="${pageKind}"）：包含未充分支持的实质句 [${claim.status}, ${claim.reason}]："${claim.text}"。`
        );
      }
    }
    return;
  }

  // 如果是 qa
  if (pageKind === 'qa') {
    // 检查「证据位置」段中的编号是否均能解析到当次引用
    if (evidenceLocationSectionMatch) {
      const sectionText = evidenceLocationSectionMatch[0];
      const numbers = Array.from(sectionText.matchAll(/\[(\d+)\]/g)).map((m) => m[1]);
      const availableLabels = new Set((citations ?? []).map((c) => normalizeCitationLabel(c.label)));
      for (const num of numbers) {
        if (!availableLabels.has(num)) {
          throw new Error(
            `写入笔记草稿被门禁拦截（pageKind="qa"）：「证据位置」段中包含悬空或未在当次检索中的引用编号 [${num}]。`
          );
        }
      }
    }

    for (const claim of claims) {
      if (claim.status === 'not-in-library') {
        throw new Error(
          `写入笔记草稿被门禁拦截（pageKind="qa"）：包含库内无支撑的实质陈述句 [not-in-library, ${claim.reason}]："${claim.text}"。`
        );
      }
      if (claim.status === 'partial') {
        if (!claim.text.includes('我的推断')) {
          throw new Error(
            `写入笔记草稿被门禁拦截（pageKind="qa"）：部分支持的陈述必须明确标注「我的推断」："${claim.text}"。`
          );
        }
      }
    }
    return;
  }

  // 如果是 concept 或 paper-card
  if (pageKind === 'concept' || pageKind === 'paper-card') {
    for (const claim of claims) {
      if (claim.status === 'not-in-library') {
        throw new Error(
          `写入笔记草稿被门禁拦截（pageKind="${pageKind}"）：包含库内无支撑的实质陈述句 [not-in-library, ${claim.reason}]："${claim.text}"。`
        );
      }
      if (claim.status === 'partial') {
        if (!claim.text.includes('我的推断')) {
          throw new Error(
            `写入笔记草稿被门禁拦截（pageKind="${pageKind}"）：部分支持的陈述必须明确标注「我的推断」："${claim.text}"。`
          );
        }
      }
    }
    return;
  }
}
