/**
 * Explainable checks for Agent delivery quality.
 *
 * These checks validate the shape and evidence boundaries of a response. They
 * never rewrite markdown, remove citations, or claim that an academic answer
 * is factually correct. Semantic support remains the responsibility of the
 * user-triggered citation audit.
 */

export type DeliveryTaskKind = 'survey' | 'engineering' | 'general';
export type DeliveryRunState = 'completed' | 'partial' | 'failed' | 'cancelled' | 'budget' | 'timeout' | 'invalid-output';
export type DeliveryQualityState = 'complete' | 'partial' | 'failed';
export type DeliveryIssueSeverity = 'error' | 'warning' | 'info';
export type EvidenceBoundaryKind = 'direct-evidence' | 'background' | 'method-transfer' | 'inference';

export interface DeliveryRequirement {
  kind?: DeliveryTaskKind;
  /** Explicit requested headings. Matching ignores Markdown heading markers. */
  requiredSections?: string[];
  /** A full report cannot be satisfied by a follow-up offer or outline. */
  completeness?: 'full' | 'partial' | 'unspecified';
  /** Optional source counts from a coverage ledger. */
  candidateCount?: number;
  pendingCount?: number;
  /** Explicit user numbering such as 1.x is retained instead of treated as a placeholder. */
  allowPlaceholderNumbering?: boolean;
  engineeringTopic?: 'hot-jet';
}

export interface DeliveryQualityIssue {
  code:
    | 'empty-answer'
    | 'missing-section'
    | 'unfinished-content'
    | 'internal-protocol-leak'
    | 'incomplete-run'
    | 'engineering-structure-gap'
    | 'missing-conditionality'
    | 'unbounded-research-gap'
    | 'missing-evidence-boundary'
    | 'coverage-gap';
  severity: DeliveryIssueSeverity;
  message: string;
  section?: string;
}

export interface EvidenceBoundarySummary {
  directEvidence: number;
  background: number;
  methodTransfer: number;
  inference: number;
  unlabeled: number;
}

export interface DeliveryQualityResult {
  state: DeliveryQualityState;
  issues: DeliveryQualityIssue[];
  headings: string[];
  missingSections: string[];
  evidenceBoundary: EvidenceBoundarySummary;
  preservedCitationCount: number;
  hasInternalProtocolLeak: boolean;
}

const INTERNAL_PROTOCOL_PATTERNS: readonly RegExp[] = [
  /#agent-binding-[\w-]+/i,
  /evidence(?:Token|_token)|citation(?:Registry|_registry)/i,
  /\b(?:paper|category)_[a-z0-9][a-z0-9_-]*\b/i,
];

const UNFINISHED_PATTERNS: readonly RegExp[] = [
  /(?:^|\n)\s*(?:TODO|TBD|FIXME)\b/i,
  /[\[【<（(]\s*(?:TODO|TBD|待补(?:充|信息|参数|确认)?)[\]】>）)]/i,
  /(?:后续|之后)(?:再|可再)?(?:扩写|补充|完善)/,
  /可以再扩写/,
  /(?:can|could)\s+(?:expand|write\s+the\s+full|complete\s+it)\s+(?:this\s+)?(?:later|next)/i,
];

const STRONG_GAP_PATTERNS: readonly RegExp[] = [
  /(?:该领域|这一领域|相关研究|文献中).{0,24}(?:不存在|没有任何|尚无|完全没有|首次|唯一)/u,
  /(?:不存在|没有任何|尚无|完全没有).{0,18}(?:研究|文献|方法|证据)/u,
];

const NEGATED_GAP_CONTEXT = /(?:不(?:能|可|应)(?:据此|直接|简单)?(?:断言|认定|推断|说明|证明|表明|得出|声称)|无法(?:据此)?(?:断言|认定|推断|说明|证明|得出)|不足以(?:断言|认定|推断|说明|证明|表明)|不等于|并非|不是|不意味着|并不意味着|没有(?:足够|充分)?证据(?:说明|证明|表明|支持)|缺乏证据(?:说明|证明|表明|支持)).{0,40}$/u;
const LOCAL_GAP_SCOPE = /本(?:篇|文|轮|次)(?:论文|文献|研究|检索)?|本研究|这篇(?:论文|文献)|该(?:篇论文|论文|文献)|当前(?:检索|证据|文献|样本)(?:范围)?|所(?:检索|纳入|阅读)的?文献|已(?:检索|纳入|阅读)的?文献|检索范围(?:内|中)|样本(?:内|中)|(?:本库|文库)(?:范围)?(?:内|中)/u;

function hasUnboundedResearchGap(markdown: string): boolean {
  // Judge each assertion in its local context. A disclaimer about field-wide
  // absence must not trigger a warning, or excuse a later positive assertion.
  const statements = markdown.split(/[。！？!?；;\n]|[，,]\s*(?:但(?:是)?|然而|不过|相反|因此|所以)/u);
  for (const statement of statements) {
    for (const pattern of STRONG_GAP_PATTERNS) {
      for (const match of statement.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))) {
        const wordOffset = match[0].search(/不存在|没有任何|尚无|完全没有|首次|唯一/u);
        const prefix = statement.slice(0, (match.index ?? 0) + Math.max(0, wordOffset));
        const commaIndex = Math.max(prefix.lastIndexOf('，'), prefix.lastIndexOf(','));
        const clausePrefix = prefix.slice(commaIndex + 1);
        if (NEGATED_GAP_CONTEXT.test(clausePrefix)) continue;
        const hasCausalFieldClaim = /(?:说明|证明|因此|表明|由此|可见|意味着|推断).{0,20}(?:该领域|这一领域|相关研究)/u.test(clausePrefix);
        if (LOCAL_GAP_SCOPE.test(clausePrefix) && !hasCausalFieldClaim) continue;
        const priorClause = prefix.slice(0, commaIndex).trim();
        if (commaIndex >= 0 && LOCAL_GAP_SCOPE.test(priorClause) && /(?:范围内|范围中|检索内|检索中|文献中|而言|所见)[“”"'\s]*$/u.test(priorClause)) continue;
        return true;
      }
    }
  }
  return false;
}

const ENGINEERING_LABELS: ReadonlyArray<{ key: string; pattern: RegExp }> = [
  { key: '边界位置', pattern: /边界(?:位置|条件)?|入口|出口|远场|壁面|声学|boundary|inlet|outlet|far[- ]field|wall|acoustic/iu },
  { key: '边界类型', pattern: /边界类型|速度入口|压力(?:入口|出口)|总压|总温|无滑移|滑移|绝热|等温|无反射|boundary\s+type|velocity\s+inlet|pressure\s+(?:inlet|outlet)|stagnation|no[- ]slip|adiabatic|isothermal|non[- ]reflect/iu },
  { key: '变量和单位', pattern: /变量|参数|单位|速度|压力|温度|密度|马赫|能量|variable|parameter|unit|velocity|pressure|temperature|density|mach|energy/iu },
  { key: '单位或无量纲说明', pattern: /单位|无量纲|\bm\s*\/\s*s\b|\b(?:Pa|kPa|MPa|kelvin|Kelvins|units?|dimensionless)\b|温度.{0,10}\bK\b|temperature.{0,20}\bK\b|kg\s*\/\s*m/iu },
  { key: '已知和未知值', pattern: /已知|未知|待补|缺少|需要提供|known|unknown|missing|need.{0,12}provide/iu },
  { key: '适用前提', pattern: /前提|假设|适用条件|可压缩|亚音速|超音速|总量|assumption|condition|compressib|subsonic|supersonic|stagnation/iu },
  { key: '证据依据', pattern: /证据|文献|原文|推断|背景|evidence|literature|source|inference|background/iu },
  { key: '验证项', pattern: /验证|检查|监测|收敛|敏感性|validation|verify|monitor|convergence|sensitivity/iu },
];

const HOT_JET_LABELS: ReadonlyArray<{ key: string; pattern: RegExp }> = [
  { key: '可压缩性及流动状态', pattern: /可压缩|亚音速|超音速|马赫|compressib|subsonic|supersonic|mach/iu },
  { key: '能量和热条件', pattern: /能量(?:方程)?|温度|总温|热通量|energy|temperature|thermal|heat\s*flux/iu },
  { key: '入口速度或总量条件', pattern: /入口.{0,16}(?:速度|总压|总温|总量)|(?:速度|总压|总温).{0,16}入口|inlet.{0,30}(?:velocity|stagnation|total)/iu },
  { key: '远场和出口', pattern: /远场|出口|far[- ]field|outlet/iu },
  { key: '壁面', pattern: /壁面|wall/iu },
  { key: '声学设置', pattern: /声学|噪声|FW.?H|acoustic|noise/iu },
];

function requestedSectionHeadings(instruction: string): string[] {
  const headings = extractHeadings(instruction);
  const appendRange = (match: RegExpMatchArray): void => {
    const first = Number(match[2]);
    const last = Number(match[3]);
    if (last < first || last - first > 20) return;
    for (let index = first; index <= last; index += 1) {
      const number = `${match[1]}.${index}`;
      if (!headings.some((heading) => headingNumber(heading) === number)) headings.push(number);
    }
  };
  // A relationship word makes the list explicit even without a colon. Keep
  // its order before collecting other mentions of the same numbered sections.
  const sectionList = /(?:章节|小节|sections?|headings?)\s*(?:(?:包括|为|是|如下|includes?|are)\s*[:：]?|[:：])\s*([^\n。！？]+)/i.exec(instruction)?.[1];
  if (sectionList) {
    for (const section of sectionList.split(/[、，,；;]/)) {
      const title = section.replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, '').trim();
      const range = /^(\d+)\.(\d+)\s*(?:[~～—–-]|至|到)\s*(?:\1\.)?(\d+)$/.exec(title);
      if (range) appendRange(range);
      else if (title && title.length <= 80) headings.push(title);
    }
  }
  const numberedHeadingPatterns = [
    /(?:^|[\n，,；;：:、]|(?:撰写|补充|完成|扩写|写|include|write)\s*)\s*(\d+(?:\.(?:\d+|x)){1,3})\s+([^\n，,；;。！？]+)/gi,
    // Unspaced Chinese titles also occur in direct writing requests. Require
    // the writing verb here so ordinary values such as Mach 1.2 stay prose.
    /(?:撰写|补充|完成|扩写|写)\s*(\d+(?:\.(?:\d+|x)){1,3})(?=\p{Script=Han})([^\n，,；;。！？]+)/giu,
  ];
  for (const pattern of numberedHeadingPatterns) {
    for (const match of instruction.matchAll(pattern)) {
      const title = match[2]?.replace(/(?:等章节|各章节|章节|部分)(?:的)?(?:完整(?:版|正文)?|正式正文|正文|内容|段落)?.*$/u, '').trim();
      if (title) headings.push(`${match[1]} ${title}`);
    }
  }
  const requestedRanges = [...instruction.matchAll(/(\d+)\.(\d+)\s*(?:[~～—–-]|至|到)\s*(?:\1\.)?(\d+)/g)];
  for (const match of requestedRanges) {
    const start = match.index ?? 0;
    const before = instruction.slice(0, start);
    const after = instruction.slice(start + match[0].length);
    // Ranges in an explicit list were handled above. Elsewhere require a
    // writing/section label and a section ending, not a physical unit.
    if (!/(?:撰写|补充|扩写|完成|写|仅|只|章节|小节|sections?|write|expand)\s*(?:第\s*)?$/i.test(before)
      || !/^\s*(?:的\s*)?(?:章|节|部分|完整|正式正文|正文|综述|调研|报告|内容|full|complete|sections?|[，,。；;、]|$)/i.test(after)) continue;
    appendRange(match);
  }
  // A narrowed follow-up may name only a section number. Do not interpret
  // unrelated decimal values (for example Mach 1.2) as requested chapters.
  for (const match of instruction.matchAll(/(?:写|补充|扩写|完成|仅|只|章节|小节|sections?|write|expand)\s*(\d+(?:\.(?:\d+|x)){1,3})(?=\s*(?:章|节|部分|[，,。；;、]|$))/gi)) {
    if (!headings.some((heading) => headingNumber(heading) === match[1])) headings.push(match[1]);
  }
  return unique(headings.map((heading) => {
    const number = headingNumber(heading);
    if (!number) return heading;
    const title = heading.slice(number.length).replace(/^[.)：:]\s*/u, '').trim();
    return title ? `${number} ${title}` : number;
  }));
}

/** Extract only explicit delivery requirements, using history for continuation requests. */
export function deriveAgentDeliveryRequirement(input: {
  instruction: string;
  historyMessages?: readonly { role: string; content: string }[];
  defaultKind?: DeliveryTaskKind;
}): DeliveryRequirement {
  const instruction = input.instruction.trim();
  const currentSections = requestedSectionHeadings(instruction);
  const isContinuation = /继续|完整(?:版|正文)?|扩写|前面|如上|continue|full\s+version|expand|same\s+(?:task|topic)/i.test(instruction);
  const isNarrowing = /(?:只|仅)(?:写|要|需要|回答|限|补充|扩写|讨论|处理)|\b(?:only|just)\b/i.test(instruction);
  const priorRequest = isContinuation && !isNarrowing && currentSections.length === 0
    ? [...(input.historyMessages ?? [])].reverse().find((message) =>
      message.role === 'user' && /章节|综述|调研|研究背景|研究现状|文献回顾|边界条件|热喷流|仿真|survey|review|section|boundary|simulation/i.test(message.content),
    )?.content ?? ''
    : '';
  const effectiveInstruction = `${priorRequest}\n${instruction}`;
  const kind: DeliveryTaskKind = /边界条件|热喷流|热射流|(?:计算|仿真).{0,12}(?:设置|方案|参数)|CFD|boundary\s+conditions?|hot\s+jets?|simulation\s+(?:setup|conditions?)/i.test(effectiveInstruction)
    ? 'engineering'
    : currentSections.length > 0 || /综述|调研|章节|研究背景|研究现状|文献回顾|学术正文|survey|literature\s+review|manuscript|sections?/i.test(effectiveInstruction)
      ? 'survey'
      : input.defaultKind ?? 'general';
  const completeness = /完整版|完整正文|完整.{0,6}(?:综述|调研|报告|章节|段落)|正式段落|full\s+(?:version|report|survey|text|literature\s+review)|complete\s+(?:report|survey|review)|comprehensive\s+(?:review|survey)/i.test(instruction)
    ? 'full'
    : /大纲|提纲|outline|(?:先|仅|只).{0,6}(?:简述|概述|摘要)|brief\s+(?:summary|outline)/i.test(instruction)
      ? 'partial'
      : /完整|full\s+version|comprehensive/i.test(priorRequest)
        ? 'full'
        : 'unspecified';
  return {
    kind,
    completeness,
    requiredSections: currentSections.length > 0 ? currentSections : requestedSectionHeadings(priorRequest),
    allowPlaceholderNumbering: /\b\d+\.x\b/i.test(effectiveInstruction),
    ...(kind === 'engineering' && /热喷流|热射流|hot\s+jet/i.test(effectiveInstruction) ? { engineeringTopic: 'hot-jet' as const } : {}),
  };
}

/** The same explicit requirements guide generation and the explainable check. */
export function buildAgentDeliveryQualityPrompt(requirement: DeliveryRequirement): string {
  const rules = [
    'Deliver the requested answer itself. Distinguish direct full-text evidence, background, method transfer, and your inference. Missing retrieval results mean this run did not find evidence; do not claim a field-wide absence without stating search scope, keywords, date range, and counterexample checks.',
    'Keep factual numbers, units, comparisons, causal claims, and applicability conditions tied to the supplied evidence. Never invent missing values or present metadata, abstracts, or graph relations as full-text experimental results.',
  ];
  if (requirement.requiredSections?.length) rules.push(`Include these explicitly requested sections and retain their numbering: ${requirement.requiredSections.join('; ')}.`);
  if (requirement.completeness === 'full') rules.push('The user requested a full deliverable: write finished paragraphs for the requested sections, not only an outline or a promise to expand later. If evidence or budget prevents completion, identify completed and pending work and label the delivery partial.');
  if (!requirement.allowPlaceholderNumbering) rules.push('Do not insert placeholder chapter numbers such as 1.x, TODO, or TBD.');
  if (requirement.kind === 'engineering') rules.push('For engineering answers, state boundary locations and types, variables with units, known and unknown values, applicability assumptions, evidence, and verification steps. Give conditional options when values or flow regime are unknown.');
  if (requirement.engineeringTopic === 'hot-jet') rules.push('For a hot jet, separately discuss compressibility and subsonic/supersonic regime, the energy equation and thermal conditions, inlet velocity versus total conditions, far-field/outlet, walls, and acoustic settings. Do not combine regimes into a universal parameter table.');
  return rules.join('\n');
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeHeading(value: string): string {
  return value
    .replace(/^#{1,6}\s*/, '')
    .replace(/^\d+(?:\.(?:\d+|x))*[.)]?\s*/i, '')
    .replace(/[：:。]+$/u, '')
    .trim()
    .toLocaleLowerCase();
}

function headingNumber(value: string): string | undefined {
  return /^(\d+(?:\.(?:\d+|x))*)(?:[.)]?\s+|[：:]|(?=\p{Script=Han})|$)/iu.exec(value.trim())?.[1]?.toLocaleLowerCase();
}

function markdownHeadingPositions(markdown: string): Array<{ title: string; depth: number; start: number; end: number }> {
  const headings: Array<{ title: string; depth: number; start: number; end: number }> = [];
  let fence: { marker: string; length: number } | undefined;
  let offset = 0;
  for (const originalLine of markdown.split('\n')) {
    const line = originalLine.replace(/\r$/, '');
    const marker = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      if (!fence) fence = { marker: marker[1][0], length: marker[1].length };
      else if (marker[1][0] === fence.marker && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
    } else if (!fence) {
      const heading = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (heading) headings.push({ title: heading[2].trim(), depth: heading[1].length, start: offset, end: offset + originalLine.length });
    }
    offset += originalLine.length + 1;
  }
  return headings;
}

function extractHeadings(markdown: string): string[] {
  return unique(markdownHeadingPositions(markdown).map((heading) => heading.title));
}

function headingMatches(actual: string, requested: string): boolean {
  const requestedNumber = headingNumber(requested);
  if (requestedNumber && headingNumber(actual) !== requestedNumber) return false;
  if (requestedNumber && requested.trim() === requestedNumber) {
    return true;
  }
  const left = normalizeHeading(actual);
  const right = normalizeHeading(requested);
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
}

function inspectMarkdownCompletion(markdown: string): { unclosed: boolean; prose: string } {
  let fence: { marker: string; length: number } | undefined;
  let unclosedCitation = false;
  const proseLines: string[] = [];
  let mathMarkers = 0;
  for (const line of markdown.split(/\r?\n/)) {
    const marker = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      if (!fence) fence = { marker: marker[1][0], length: marker[1].length };
      else if (marker[1][0] === fence.marker && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      continue;
    }
    if (fence) continue;
    mathMarkers += [...line.matchAll(/(?<!\\)\$\$/g)].length;
    if (/\[\[cite:[^\]]*$/.test(line)) unclosedCitation = true;
    if (!/^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|\||>|\$\$|[-*_]{3,}\s*$)/.test(line)) proseLines.push(line);
  }
  return { unclosed: Boolean(fence) || mathMarkers % 2 !== 0 || unclosedCitation, prose: proseLines.join('\n').trim() };
}

function requestedSectionBody(markdown: string, requested: string): string | undefined {
  const headings = markdownHeadingPositions(markdown);
  const matched = headings.find((heading) => headingMatches(heading.title, requested));
  if (!matched) return undefined;
  const next = headings.find((heading) => heading.start > matched.start && heading.depth <= matched.depth);
  return markdown.slice(matched.end, next?.start ?? markdown.length);
}

function countCitationTokens(markdown: string): number {
  return [...markdown.matchAll(/\[\[cite:[^\]]+\]\]|\[\d+\]/g)].length;
}

function classifyEvidenceBoundary(markdown: string): EvidenceBoundarySummary {
  const summary: EvidenceBoundarySummary = {
    directEvidence: 0,
    background: 0,
    methodTransfer: 0,
    inference: 0,
    unlabeled: 0,
  };
  const lines = markdown.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (/直接证据|原文支持|实验结果|正文证据|direct evidence/i.test(line)) summary.directEvidence += 1;
    else if (/背景|一般原则|background/i.test(line)) summary.background += 1;
    else if (/方法迁移|迁移|transfer|adapted method/i.test(line)) summary.methodTransfer += 1;
    else if (/我的推断|推断|推测|建议|可能|inference|hypothes/i.test(line)) summary.inference += 1;
    else if (!/^#{1,6}\s/.test(line) && !/^[-*]\s*$/.test(line)) summary.unlabeled += 1;
  }
  return summary;
}

function issue(
  code: DeliveryQualityIssue['code'],
  severity: DeliveryIssueSeverity,
  message: string,
  section?: string,
): DeliveryQualityIssue {
  return section ? { code, severity, message, section } : { code, severity, message };
}

/** Inspect a generated answer without changing the answer or its citations. */
export function inspectAgentDeliveryQuality(input: {
  markdown: string;
  requirement?: DeliveryRequirement;
  runState?: DeliveryRunState;
}): DeliveryQualityResult {
  const markdown = cleanText(input.markdown);
  const requirement = input.requirement ?? {};
  const headings = extractHeadings(markdown);
  const issues: DeliveryQualityIssue[] = [];
  const missingSections = (requirement.requiredSections ?? []).filter((requested) =>
    !headings.some((actual) => headingMatches(actual, requested)),
  );
  const protocolInspectionText = markdown.replace(/\[\[cite:[^\]\r\n]+\]\]/g, '');
  const hasInternalProtocolLeak = INTERNAL_PROTOCOL_PATTERNS.some((pattern) => pattern.test(protocolInspectionText));
  const boundary = classifyEvidenceBoundary(markdown);
  const completion = inspectMarkdownCompletion(markdown);

  if (!markdown) issues.push(issue('empty-answer', 'error', '回答为空，无法满足交付要求。'));
  for (const section of missingSections) {
    issues.push(issue('missing-section', 'error', `缺少用户要求的章节「${section}」。`, section));
  }
  if (UNFINISHED_PATTERNS.some((pattern) => pattern.test(markdown))) {
    issues.push(issue('unfinished-content', requirement.completeness === 'full' ? 'error' : 'warning', '回答包含待补内容或后续扩写承诺。'));
  }
  if (completion.unclosed) {
    issues.push(issue('unfinished-content', 'error', '回答包含未闭合的代码块、块公式或引用标记。'));
  }
  if (requirement.completeness === 'full' && markdown) {
    if (!completion.prose) {
      issues.push(issue('unfinished-content', 'error', '完整版仅包含标题、大纲或表格，缺少正式段落。'));
    } else {
      for (const section of requirement.requiredSections ?? []) {
        const body = requestedSectionBody(markdown, section);
        if (body !== undefined && !inspectMarkdownCompletion(body).prose) {
          issues.push(issue('unfinished-content', 'error', `章节「${section}」缺少正式段落。`, section));
        }
      }
    }
  }
  if (!requirement.allowPlaceholderNumbering && headings.some((heading) => /^\d+\.x\b/i.test(heading))) {
    issues.push(issue('unfinished-content', 'error', '回答含未约定的占位章节编号；用户明确指定的编号应保留。'));
  }
  if (hasInternalProtocolLeak) {
    issues.push(issue('internal-protocol-leak', 'error', '回答泄漏了内部文献或分类标识、引用协议或绑定地址；原始引用应由渲染层消费。'));
  }

  const incompleteRun = input.runState && input.runState !== 'completed';
  if (incompleteRun) {
    const severity: DeliveryIssueSeverity = input.runState === 'invalid-output' || input.runState === 'failed' ? 'error' : 'warning';
    issues.push(issue('incomplete-run', severity, `运行状态为 ${input.runState}，不能宣称完整交付。`));
  }

  if (requirement.candidateCount !== undefined && requirement.pendingCount !== undefined && requirement.pendingCount > 0) {
    issues.push(issue('coverage-gap', requirement.completeness === 'full' ? 'error' : 'warning',
      `仍有 ${requirement.pendingCount} 篇候选文献待处理（候选总数 ${requirement.candidateCount}）。`));
  }

  if (requirement.kind === 'engineering') {
    const labels = requirement.engineeringTopic === 'hot-jet' ? [...ENGINEERING_LABELS, ...HOT_JET_LABELS] : ENGINEERING_LABELS;
    const missingLabels = labels.filter(({ pattern }) => !pattern.test(markdown)).map(({ key }) => key);
    if (missingLabels.length > 0) {
      issues.push(issue('engineering-structure-gap', 'warning', `工程回答未明确覆盖：${missingLabels.join('、')}。`));
    }
    const hasRecommendation = /(?:应|建议|设置|采用|使用|取值|配置)|recommend|should|\bset\b|\buse\b/iu.test(markdown);
    const hasCondition = /(?:如果|当|在.{0,12}时|取决于|仅当|若|需先明确|适用|假设|给定工况|未知)|\bif\b|\bwhen\b|depends|applicable|assum|given.{0,12}(?:regime|condition)|unknown/iu.test(markdown);
    if (hasRecommendation && !hasCondition) {
      issues.push(issue('missing-conditionality', 'warning', '工程建议缺少适用条件或待补参数，不能作为万能参数表述。'));
    }
  }

  if (hasUnboundedResearchGap(markdown)) {
    issues.push(issue('unbounded-research-gap', 'warning', '研究空白表述过强，应限定为本轮检索范围并说明检索边界。'));
  }
  const hasEvidenceLabels = boundary.directEvidence + boundary.background + boundary.methodTransfer + boundary.inference > 0;
  if (requirement.kind === 'survey' && markdown && !hasEvidenceLabels) {
    issues.push(issue('missing-evidence-boundary', 'warning', '综述未明确区分直接证据、背景、方法迁移和推断。'));
  }

  const hasUnresolvedIssue = issues.some((item) => item.severity === 'error' || item.severity === 'warning');
  const state: DeliveryQualityState = !markdown || input.runState === 'invalid-output' || input.runState === 'failed'
    ? 'failed'
    : hasUnresolvedIssue
      ? 'partial'
      : input.runState && input.runState !== 'completed'
        ? 'partial'
        : 'complete';

  return {
    state,
    issues,
    headings,
    missingSections,
    evidenceBoundary: boundary,
    preservedCitationCount: countCitationTokens(markdown),
    hasInternalProtocolLeak,
  };
}
