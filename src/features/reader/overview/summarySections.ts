import type { PaperSummary } from '../../../types/reader';

export type SummarySectionKey =
  | 'overview'
  | 'background'
  | 'problem'
  | 'approach'
  | 'experiment'
  | 'findings'
  | 'conclusion'
  | 'limitations';

export interface SummarySection {
  key: SummarySectionKey;
  content: string;
  /** Findings remain separate items so the panel can render a real list and count them. */
  items?: string[];
}

const SECTION_ALIASES: Record<SummarySectionKey, readonly string[]> = {
  overview: ['overview', 'summary', 'abstract', 'paper overview', '概览', '论文概览', '摘要', '概要', '总览'],
  background: ['background', 'research background', '背景', '研究背景'],
  problem: ['problem', 'research problem', 'research question', 'research questions', '问题', '研究问题'],
  approach: ['approach', 'method', 'methods', 'methodology', '方法', '研究方法', '技术方法'],
  experiment: ['experiment', 'experiments', 'experiment setup', 'experimental setup', '实验', '实验设置', '实验设计'],
  findings: ['findings', 'key findings', 'results', '主要发现', '关键发现', '发现', '实验结果', '研究结果'],
  conclusion: ['conclusion', 'conclusions', '结论', '研究结论'],
  limitations: ['limitation', 'limitations', 'limitations and future work', '局限', '局限性', '研究局限', '局限与展望'],
};

const SECTION_KEYS = Object.keys(SECTION_ALIASES) as SummarySectionKey[];
type SectionContents = Partial<Record<SummarySectionKey, string>>;

function cleanHeading(text: string): string {
  return text
    .replace(/[*_`]/g, '')
    .replace(/^\s*(?:\d+[.)、．]|[一二三四五六七八九十]+[、．.])\s*/, '')
    .replace(/[：:]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function headingKey(text: string): SummarySectionKey | undefined {
  const heading = cleanHeading(text);
  const exact = SECTION_KEYS.find((key) => SECTION_ALIASES[key].includes(heading));
  if (exact) return exact;

  // Accept bilingual labels such as “研究背景 / Background” and “方法（Approach）”.
  const parts = heading.split(/\s*[/|（()）]\s*/).filter(Boolean);
  if (parts.length < 2) return undefined;
  return SECTION_KEYS.find((key) => parts.every((part) => SECTION_ALIASES[key].includes(part)));
}

function readHeading(line: string): { key: SummarySectionKey; rest: string } | null {
  if (/^\s/.test(line)) return null;
  const text = line.replace(/^#{1,6}\s+/, '').replace(/\s+#+\s*$/, '').trim();
  const key = headingKey(text);
  if (key) return { key, rest: '' };

  const colon = text.search(/[：:]/);
  if (colon < 0) return null;
  const label = text.slice(0, colon);
  const inlineKey = headingKey(label);
  if (!inlineKey) return null;
  // A bold label can put its colon inside or outside the closing delimiter.
  const opening = label.match(/^(\*\*|__)/)?.[1];
  let rest = text.slice(colon + 1).trim();
  if (opening && !label.endsWith(opening) && rest.startsWith(opening)) {
    rest = rest.slice(opening.length).trim();
  }
  return { key: inlineKey, rest };
}

function parseMarkdown(text: string, fallback: SummarySectionKey): SectionContents {
  const contents: SectionContents = {};
  let currentKey = fallback;
  let lines: string[] = [];
  let fence: { marker: string; length: number } | null = null;
  const source = text.replace(/\r\n?/g, '\n').trim().split('\n');

  const flush = () => {
    const content = lines.join('\n').trim();
    if (content) {
      contents[currentKey] = [contents[currentKey], content].filter(Boolean).join('\n\n');
    }
    lines = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const line = source[index];
    const delimiter = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (delimiter) {
      if (!fence) {
        fence = { marker: delimiter[1][0], length: delimiter[1].length };
      } else if (
        delimiter[1][0] === fence.marker &&
        delimiter[1].length >= fence.length &&
        !delimiter[2].trim()
      ) {
        fence = null;
      }
      lines.push(line);
      continue;
    }
    if (fence) {
      lines.push(line);
      continue;
    }

    const heading = readHeading(line);
    if (heading) {
      flush();
      currentKey = heading.key;
      if (heading.rest) lines.push(heading.rest);
      if (/^\s*(?:=+|-+)\s*$/.test(source[index + 1] ?? '')) index += 1;
    } else {
      lines.push(line);
    }
  }
  flush();
  return contents;
}

function findingItems(content: string): string[] {
  const lines = content.split('\n');
  const marker = /^([ \t]*)(?:[-+*•](?:[ \t]+|$)|\d+[.)](?:[ \t]+|$))(.*)$/;
  let fence: { marker: string; length: number } | null = null;
  const matches = lines.map((line) => {
    const delimiter = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (delimiter) {
      if (!fence) {
        fence = { marker: delimiter[1][0], length: delimiter[1].length };
      } else if (delimiter[1][0] === fence.marker && delimiter[1].length >= fence.length && !delimiter[2].trim()) {
        fence = null;
      }
      return null;
    }
    return fence ? null : line.match(marker);
  });
  const indents = matches.flatMap((match) => {
    return match ? [match[1].length] : [];
  });
  if (!indents.length) return content.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);

  const indent = Math.min(...indents);
  const items: string[] = [];
  let current: string[] = [];
  const flush = () => {
    const item = current.join('\n').trim();
    if (item) items.push(item);
    current = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = matches[index];
    if (match && match[1].length === indent) {
      flush();
      current.push(match[2]);
    } else {
      // Remove the outer list's indentation, preserving nested Markdown within the finding.
      current.push(line.replace(new RegExp(`^\\s{1,${indent + 2}}`), ''));
    }
  }
  flush();
  return items;
}

function findingsMarkdown(items: string[]): string {
  return items.map((item) => `- ${item.replace(/\n/g, '\n  ')}`).join('\n');
}

/** Parse both generated JSON summaries and older Markdown cache content without UI dependencies. */
export function parseSummarySections(summary: PaperSummary | string | null | undefined): SummarySection[] {
  if (!summary) return [];
  let structuredFindings: string[] = [];
  const contents = parseMarkdown(
    typeof summary === 'string' ? summary : summary.overview?.trim() || summary.abstract || '',
    'overview',
  );

  if (typeof summary !== 'string') {
    if (!contents.overview && summary.abstract?.trim()) {
      const abstract = parseMarkdown(summary.abstract, 'overview');
      for (const key of SECTION_KEYS) {
        if (!contents[key] && abstract[key]) contents[key] = abstract[key];
      }
    }
    const fields = {
      background: summary.background,
      problem: summary.researchProblem,
      approach: summary.approach,
      experiment: summary.experimentSetup,
      conclusion: summary.conclusions,
      limitations: summary.limitations,
    };
    for (const [key, text] of Object.entries(fields) as [SummarySectionKey, string][]) {
      if (!text?.trim()) continue;
      const parsed = parseMarkdown(text, key);
      for (const parsedKey of SECTION_KEYS) {
        // Explicit structured fields take precedence over the same section in legacy Markdown.
        if (parsed[parsedKey] && (parsedKey === key || !contents[parsedKey])) {
          contents[parsedKey] = parsed[parsedKey];
        }
      }
    }
    structuredFindings = (summary.keyFindings ?? [])
      .map((item) => item.trim().replace(/^(?:[-+*•](?:\s+|$)|\d+[.)](?:\s+|$))/, '').trim())
      .filter(Boolean);
    if (structuredFindings.length) contents.findings = findingsMarkdown(structuredFindings);
  }

  return SECTION_KEYS.flatMap<SummarySection>((key) => {
    const content = contents[key]?.trim();
    if (!content) return [];
    if (key !== 'findings') return [{ key, content }];
    const items = structuredFindings.length ? structuredFindings : findingItems(content);
    return items.length ? [{ key, content: findingsMarkdown(items), items }] : [];
  });
}

export interface SummaryPanelStateInput {
  hasContent: boolean;
  loading: boolean;
  hasBlocks: boolean;
  aiConfigured: boolean;
}

export function resolveSummaryPanelState({ hasContent, loading, hasBlocks, aiConfigured }: SummaryPanelStateInput): {
  status: 'content' | 'loading' | 'unconfigured' | 'missing-source' | 'ready';
  canGenerate: boolean;
} {
  return {
    status: hasContent ? 'content' : loading ? 'loading' : !aiConfigured ? 'unconfigured' : !hasBlocks ? 'missing-source' : 'ready',
    canGenerate: !loading && aiConfigured && hasBlocks,
  };
}
