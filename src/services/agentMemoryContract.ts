/**
 * 工作记忆契约（方案第 6 节）。
 *
 * L2 `L2-topics.md` 与 L3 `L3-synthesis.md` 是工作记忆：只记录当前任务、
 * 未决问题和已被否定的主张；文献结论、概念定义和跨篇综述一律写入笔记。
 *
 * 本模块为纯函数：不碰 IPC、不读文件，便于 node --test 单测。
 */

export interface RejectedClaimLine {
  text: string;
  status: 'not-in-library' | 'contradicted' | 'user-rejected';
  reason: string;
  source: string;
}

/** L2/L3 工作记忆的写入上限（字符）。trace 的 8MB 上限不变。 */
export const WORKING_MEMORY_MAX_CHARS = 4_000;
/** 系统提示注入时 L2/L3 正文各最多截取字符数。 */
export const WORKING_MEMORY_INJECT_CHARS = 1_200;
/** 注入超长工作记忆时追加的提示行。 */
export const WORKING_MEMORY_OVER_LIMIT_HINT = '工作记忆超过上限，文献结论应写入笔记';
/** 始终注入的工作记忆政策句。 */
export const WORKING_MEMORY_POLICY_LINE =
  '工作记忆政策：工作记忆只记录当前任务、未决问题和已被否定的主张；' +
  '文献结论、概念定义和跨篇综述必须写入对应 pageKind 的笔记（write_notes）并等待审批，不要用 write_memory 保存。';

const REJECTED_CLAIM_STATUSES: ReadonlySet<string> = new Set([
  'not-in-library',
  'contradicted',
  'user-rejected',
]);

function oneLine(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** Markdown 行内字段安全化：`|` 是行格式的字段分隔符，正文中改写为全角。 */
function fieldText(value: unknown): string {
  return oneLine(value).replace(/\|/g, '｜');
}

/** 已记录被否定主张的标准行格式。 */
export function formatRejectedClaimLine(claim: RejectedClaimLine): string {
  return `- [${claim.status}] ${fieldText(claim.text)} | reason: ${fieldText(claim.reason)} | source: ${fieldText(claim.source)}`;
}

/**
 * 格式化为标准工作记忆 Markdown 结构。
 * L2：Current task / Open questions / Rejected claims；L3 只保留 Progress 与 Next step。
 */
export function formatWorkingMemory(input: {
  file: 'topics' | 'synthesis';
  updatedOn: string;
  currentTask: string;
  openQuestions: string[];
  rejectedClaims: RejectedClaimLine[];
  progress?: string;
  nextStep?: string;
}): string {
  const parts: string[] = ['# Working memory', `Updated: ${oneLine(input.updatedOn)}`, ''];

  if (input.file === 'synthesis') {
    parts.push('## Progress', '', String(input.progress ?? '').trim(), '', '## Next step', '', String(input.nextStep ?? '').trim());
  } else {
    parts.push(
      '## Current task',
      '',
      String(input.currentTask ?? '').trim(),
      '',
      '## Open questions',
      '',
      ...(Array.isArray(input.openQuestions) ? input.openQuestions : [])
        .map((question) => oneLine(question))
        .filter(Boolean)
        .map((question) => `- ${question}`),
      '',
      '## Rejected claims',
      '',
      ...(Array.isArray(input.rejectedClaims) ? input.rejectedClaims : []).map(formatRejectedClaimLine),
    );
  }

  return `${parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/**
 * 从 Markdown 正文解析已记录的被否定主张（只读 ## Rejected claims 段）。
 * 手工编辑过、不符合行格式的条目以空 reason/source 兜底保留，绝不丢失。
 */
export function parseRejectedClaims(content: string): RejectedClaimLine[] {
  const text = String(content ?? '');
  const sectionMatch = /^##\s+Rejected claims\s*$/m.exec(text);

  if (!sectionMatch || sectionMatch.index === undefined) {
    return [];
  }

  const sectionStart = sectionMatch.index + sectionMatch[0].length;
  const rest = text.slice(sectionStart);
  const nextHeading = /^##\s+/m.exec(rest);
  const section = nextHeading && nextHeading.index !== undefined ? rest.slice(0, nextHeading.index) : rest;
  const claims: RejectedClaimLine[] = [];

  for (const line of section.split(/\r?\n/)) {
    const lineMatch = /^[-*]\s+\[([^\]]+)\]\s+(.+)$/.exec(line.trim());

    if (!lineMatch) {
      continue;
    }

    const status = lineMatch[1].trim();

    if (!REJECTED_CLAIM_STATUSES.has(status)) {
      continue;
    }

    const tail = lineMatch[2];
    const fields = /^(.*?)\s*\|\s*reason:\s*(.*?)\s*\|\s*source:\s*(.*)$/.exec(tail);

    claims.push(
      fields
        ? {
          text: fields[1].trim(),
          status: status as RejectedClaimLine['status'],
          reason: fields[2].trim(),
          source: fields[3].trim(),
        }
        : {
          text: tail.trim(),
          status: status as RejectedClaimLine['status'],
          reason: '',
          source: '',
        },
    );
  }

  return claims;
}

/**
 * 去重合并被否定主张：保留既有否定项，新项追加在 ## Rejected claims 段尾。
 *
 * 4_000 字符硬限制：逐条试加，加入后会超限的新项丢弃并计入 droppedBecauseFull，
 * 绝不静默删除历史否定项；## Current task 等其他段落保持原样。
 */
export function mergeRejectedClaims(
  existing: string,
  incoming: RejectedClaimLine[],
  maxChars: number = WORKING_MEMORY_MAX_CHARS,
): { content: string; added: number; droppedBecauseFull: number } {
  const base = String(existing ?? '');
  const limit = Math.max(0, Math.trunc(maxChars));
  const knownKeys = new Set(parseRejectedClaims(base).map((claim) => oneLine(claim.text)));
  const incomingLines: string[] = [];

  for (const claim of Array.isArray(incoming) ? incoming : []) {
    const key = oneLine(claim?.text);

    if (!key || knownKeys.has(key) || !REJECTED_CLAIM_STATUSES.has(claim?.status)) {
      continue;
    }

    knownKeys.add(key);
    incomingLines.push(formatRejectedClaimLine(claim));
  }

  let content = base;
  let added = 0;
  let droppedBecauseFull = 0;

  for (const line of incomingLines) {
    const candidate = appendRejectedClaimLine(content, line);

    if (candidate.length > limit) {
      droppedBecauseFull += 1;
      continue;
    }

    content = candidate;
    added += 1;
  }

  return { content, added, droppedBecauseFull };
}

/** 把一行否定主张追加到 ## Rejected claims 段尾；没有该段时在文末补段。 */
function appendRejectedClaimLine(content: string, line: string): string {
  const sectionMatch = /^##\s+Rejected claims\s*$/m.exec(content);

  if (!sectionMatch || sectionMatch.index === undefined) {
    const head = content.trimEnd();
    return `${head}${head ? '\n\n' : ''}## Rejected claims\n\n${line}\n`;
  }

  const sectionStart = sectionMatch.index + sectionMatch[0].length;
  const rest = content.slice(sectionStart);
  const nextHeading = /^##\s+/m.exec(rest);
  const sectionEnd = nextHeading && nextHeading.index !== undefined
    ? sectionStart + nextHeading.index
    : content.length;
  const sectionBody = content.slice(sectionStart, sectionEnd);
  const nextSectionBody = `${sectionBody.trimEnd()}\n${line}\n`;

  return `${content.slice(0, sectionStart)}${nextSectionBody}${content.slice(sectionEnd)}`;
}

/**
 * 构建系统提示中的工作记忆注入块。
 *
 * - 政策句始终在；
 * - L2/L3 正文仅在文件非空时附加，各截 maxChars（默认 1_200）字符；
 * - 本地文件超过上限时只截断注入、不落盘改写，并追加超限提示行。
 */
export function buildWorkingMemoryInjection(input: {
  topics?: string;
  synthesis?: string;
  maxChars?: number;
}): string {
  const maxChars = Math.max(1, Math.trunc(input.maxChars ?? WORKING_MEMORY_INJECT_CHARS));
  const sections: string[] = ['[Local Agent memory]', WORKING_MEMORY_POLICY_LINE];

  for (const [label, raw] of [
    ['L2 topics', input.topics],
    ['L3 synthesis', input.synthesis],
  ] as const) {
    const content = String(raw ?? '');

    if (!content.trim()) {
      continue;
    }

    if (content.length > maxChars) {
      sections.push(`${label}:`, `${content.slice(0, maxChars)}\n${WORKING_MEMORY_OVER_LIMIT_HINT}`);
    } else {
      sections.push(`${label}:`, content);
    }
  }

  return sections.join('\n');
}
