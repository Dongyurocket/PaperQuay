import type { LiteratureAuthor, LiteraturePaper } from '../types/library';

export type BibDialect = 'bibtex' | 'biblatex';

export interface BibtexExportOptions {
  dialect?: BibDialect;
  includeAbstract?: boolean;
  includeKeywords?: boolean;
  /** 强制指定 citation key（批量逐文件导出时保证文件名与条目 key 一致）。 */
  citationKey?: string;
}

const BIBTEX_SPECIAL_CHAR_PATTERN = /[&%$#_{}]/g;

/** 转义 BibTeX 字段值中的特殊字符（不处理已带反斜杠的 LaTeX 命令）。 */
export function escapeBibtexValue(value: string): string {
  return value.replace(BIBTEX_SPECIAL_CHAR_PATTERN, (char) => `\\${char}`);
}

const CITATION_KEY_STOP_WORDS = new Set([
  'a', 'an', 'the', 'on', 'of', 'for', 'and', 'with', 'in', 'to', 'by', 'from', 'at', 'as',
]);

function normalizeAscii(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim();
}

function firstSignificantTitleWord(title: string): string {
  const words = normalizeAscii(title).toLowerCase().split(/\s+/).filter(Boolean);

  for (const word of words) {
    if (!CITATION_KEY_STOP_WORDS.has(word)) {
      return word;
    }
  }

  return words[0] ?? '';
}

function authorFamilyName(author: LiteratureAuthor | undefined): string {
  if (!author) {
    return '';
  }

  const family = author.familyName?.trim();

  if (family) {
    return family;
  }

  const parts = author.name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? '';
}

/**
 * 生成 citation key：第一作者姓 + 年份 + 标题首个实词（如 `chen2026electric`）。
 * 冲突时追加 b/c/... 后缀。
 */
export function buildCitationKey(
  paper: LiteraturePaper,
  usedKeys?: Set<string>,
): string {
  const family = normalizeAscii(authorFamilyName(paper.authors[0])).toLowerCase().replace(/\s+/g, '');
  const year = (paper.year ?? '').trim().replace(/[^0-9]/g, '').slice(0, 4);
  const titleWord = firstSignificantTitleWord(paper.title);

  let base = `${family || 'paper'}${year || ''}${titleWord || 'untitled'}`;

  if (!base) {
    base = `paper${paper.id.replace(/[^a-zA-Z0-9]/g, '')}`;
  }

  if (!usedKeys) {
    return base;
  }

  if (!usedKeys.has(base)) {
    usedKeys.add(base);
    return base;
  }

  const suffixes = 'bcdefghijklmnopqrstuvwxyz';

  for (const suffix of suffixes) {
    const candidate = `${base}${suffix}`;

    if (!usedKeys.has(candidate)) {
      usedKeys.add(candidate);
      return candidate;
    }
  }

  const fallback = `${base}-${paper.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6)}`;
  usedKeys.add(fallback);
  return fallback;
}

const CONFERENCE_PATTERN =
  /conference|proceedings|workshop|symposium|congress|meeting|sig[a-z]+|ieee|acm|cvpr|iccv|eccv|neurips|icml|iclr|acl|emnlp|naacl|aaai|ijcai|kdd|www|chi|uist|interspeech|icassp/i;
const BOOK_PATTERN = /book|monograph|handbook|springer|press\b/i;
const PREPRINT_PATTERN = /arxiv|preprint|biorxiv|medrxiv|ssrn|chemrxiv/i;

/** 由 publication 字段启发式推断 BibTeX entry 类型。 */
export function inferBibtexEntryType(paper: LiteraturePaper): string {
  const publication = (paper.publication ?? '').trim();

  if (publication) {
    if (PREPRINT_PATTERN.test(publication)) {
      return 'misc';
    }

    if (CONFERENCE_PATTERN.test(publication)) {
      return 'inproceedings';
    }

    if (BOOK_PATTERN.test(publication)) {
      return 'book';
    }

    return 'article';
  }

  return paper.doi?.trim() ? 'article' : 'misc';
}

function formatAuthors(authors: LiteratureAuthor[]): string {
  return authors
    .map((author) => {
      const name = author.name.trim();

      if (!name) {
        return '';
      }

      const family = author.familyName?.trim();
      const given = author.givenName?.trim();

      if (family) {
        return given ? `${family}, ${given}` : family;
      }

      const parts = name.split(/\s+/);

      if (parts.length === 1) {
        return name;
      }

      return `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}`;
    })
    .filter(Boolean)
    .join(' and ');
}

/** 生成单篇文献的 BibTeX/BibLaTeX 条目。 */
export function paperToBibtexEntry(
  paper: LiteraturePaper,
  options: BibtexExportOptions = {},
  usedKeys?: Set<string>,
): string {
  const dialect: BibDialect = options.dialect ?? 'bibtex';
  const entryType = inferBibtexEntryType(paper);
  const citationKey = options.citationKey ?? buildCitationKey(paper, usedKeys);
  const fields: Array<[string, string]> = [];

  fields.push(['title', escapeBibtexValue(paper.title.trim())]);

  const authors = formatAuthors(paper.authors);

  if (authors) {
    fields.push(['author', escapeBibtexValue(authors)]);
  }

  const year = (paper.year ?? '').trim().replace(/[^0-9]/g, '').slice(0, 4);

  if (year) {
    fields.push(['year', year]);
  }

  const publication = (paper.publication ?? '').trim();

  if (publication) {
    if (entryType === 'inproceedings') {
      fields.push(['booktitle', escapeBibtexValue(publication)]);
    } else if (entryType === 'article') {
      fields.push(['journal', escapeBibtexValue(publication)]);
    } else if (entryType === 'book') {
      fields.push(['publisher', escapeBibtexValue(publication)]);
    } else {
      fields.push(['howpublished', escapeBibtexValue(publication)]);
    }
  }

  const doi = paper.doi?.trim();

  if (doi) {
    fields.push(['doi', doi]);
  }

  const url = paper.url?.trim();

  if (url) {
    fields.push(['url', url]);
  }

  if (options.includeAbstract !== false && paper.abstractText?.trim()) {
    fields.push(['abstract', escapeBibtexValue(paper.abstractText.trim())]);
  }

  if (options.includeKeywords !== false && paper.keywords.length > 0) {
    fields.push(['keywords', paper.keywords.map((keyword) => escapeBibtexValue(keyword.trim())).filter(Boolean).join(', ')]);
  }

  const titleZh = paper.titleZh?.trim();

  if (titleZh) {
    // BibLaTeX 有规范的 titleaddon 字段；BibTeX 方言放入 note 以兼容旧工具链。
    fields.push([dialect === 'biblatex' ? 'titleaddon' : 'note', escapeBibtexValue(titleZh)]);
  }

  const body = fields.map(([key, value]) => `  ${key} = {${value}}`).join(',\n');

  return `@${entryType}{${citationKey},\n${body}\n}`;
}

/** 批量生成 .bib 文件内容（条目间空行分隔，末尾换行）。 */
export function papersToBibtex(
  papers: LiteraturePaper[],
  options: BibtexExportOptions = {},
): string {
  const usedKeys = new Set<string>();

  return `${papers
    .filter((paper) => paper.title.trim())
    .map((paper) => paperToBibtexEntry(paper, options, usedKeys))
    .join('\n\n')}\n`;
}
