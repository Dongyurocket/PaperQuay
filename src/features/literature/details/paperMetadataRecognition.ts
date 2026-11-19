import type { LiteraturePaper, UpdatePaperRequest } from '../../../types/library.ts';
import type { MetadataLookupResult } from '../../../types/metadata.ts';
import { metadataUpdateForPaper } from '../literatureLibraryUtils.ts';

export interface PaperMetadataDifference {
  key: Exclude<keyof UpdatePaperRequest, 'paperId' | 'expectedUpdatedAt'>;
  label: string;
  current: unknown;
  next: unknown;
  checked: boolean;
}

const FIELD_LABELS: Partial<Record<PaperMetadataDifference['key'], string>> = {
  title: '标题',
  year: '年份',
  publication: '期刊 / 会议',
  doi: 'DOI',
  url: 'URL',
  abstractText: '摘要',
  publisher: '出版社',
  volume: '卷号',
  issue: '期号',
  pages: '页码',
  issn: 'ISSN',
  language: '论文语言',
  authors: '作者',
  authorDetails: '作者详情',
  keywords: '关键词',
};

export function buildManualMetadataUpdateRequest(
  paper: LiteraturePaper,
  metadata: MetadataLookupResult | null,
  draft: { title: string; doi: string },
): UpdatePaperRequest | null {
  const request = metadata ? metadataUpdateForPaper(paper, metadata) : null;
  const output: UpdatePaperRequest = {
    paperId: paper.id,
    expectedUpdatedAt: paper.updatedAt,
    ...(request ?? {}),
  };
  output.paperId = paper.id;
  output.expectedUpdatedAt = paper.updatedAt;

  const manualTitle = draft.title.trim();
  const manualDoi = draft.doi.trim();
  if (manualTitle && manualTitle !== paper.title.trim()) output.title = manualTitle;
  if (manualDoi && manualDoi !== (paper.doi ?? '').trim()) output.doi = manualDoi;

  return Object.keys(output).some((key) => key !== 'paperId' && key !== 'expectedUpdatedAt') ? output : null;
}

function currentValue(paper: LiteraturePaper, key: PaperMetadataDifference['key']): unknown {
  if (key === 'authors') return paper.authors.map((author) => author.name);
  if (key === 'authorDetails') return paper.authors.map(({ name, givenName, familyName, affiliation, orcid }) => ({ name, givenName, familyName, affiliation, orcid }));
  return paper[key as keyof LiteraturePaper];
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export function buildPaperMetadataDifferences(
  paper: LiteraturePaper,
  request: UpdatePaperRequest,
): PaperMetadataDifference[] {
  return (Object.keys(request) as Array<keyof UpdatePaperRequest>)
    .filter((key): key is PaperMetadataDifference['key'] => key !== 'paperId' && request[key] !== undefined)
    .filter((key) => !sameValue(currentValue(paper, key), request[key]))
    .map((key) => ({
      key,
      label: FIELD_LABELS[key] ?? key,
      current: currentValue(paper, key),
      next: request[key],
      checked: true,
    }));
}

export function mergeSelectedPaperMetadata(
  paperId: string,
  request: UpdatePaperRequest,
  selectedKeys: Array<PaperMetadataDifference['key']>,
): UpdatePaperRequest | null {
  if (selectedKeys.length === 0) return null;
  const selected = new Set(selectedKeys);
  const merged: UpdatePaperRequest = { paperId };
  if (request.expectedUpdatedAt !== undefined) merged.expectedUpdatedAt = request.expectedUpdatedAt;
  for (const key of selected) {
    const value = request[key];
    if (value !== undefined) Object.assign(merged, { [key]: value });
  }
  return merged;
}
