import type { LiteratureItemType, LiteraturePaper } from '../../types/library';

export interface MetadataFilterField {
  key: string;
  labels: [string, string];
  itemTypes: LiteratureItemType[] | null;
}

export const METADATA_FILTER_FIELDS: MetadataFilterField[] = [
  { key: 'title', labels: ['标题', 'Title'], itemTypes: null },
  { key: 'authors', labels: ['作者', 'Authors'], itemTypes: null },
  { key: 'year', labels: ['年份', 'Year'], itemTypes: null },
  { key: 'abstractText', labels: ['摘要', 'Abstract'], itemTypes: null },
  { key: 'keywords', labels: ['关键词', 'Keywords'], itemTypes: null },
  { key: 'url', labels: ['URL', 'URL'], itemTypes: null },
  { key: 'doi', labels: ['DOI', 'DOI'], itemTypes: ['journalArticle', 'conferencePaper', 'preprint'] },
  { key: 'publication', labels: ['刊物／会议', 'Publication / venue'], itemTypes: ['journalArticle', 'conferencePaper', 'bookSection', 'preprint'] },
  { key: 'publisher', labels: ['出版者', 'Publisher'], itemTypes: ['journalArticle', 'conferencePaper', 'book', 'bookSection', 'report'] },
  { key: 'institution', labels: ['机构', 'Institution'], itemTypes: ['thesis', 'report'] },
  { key: 'reportNumber', labels: ['报告号', 'Report number'], itemTypes: ['report'] },
  { key: 'volume', labels: ['卷号', 'Volume'], itemTypes: ['journalArticle'] },
  { key: 'issue', labels: ['期号', 'Issue'], itemTypes: ['journalArticle'] },
  { key: 'pages', labels: ['页码', 'Pages'], itemTypes: ['journalArticle', 'conferencePaper', 'bookSection'] },
  { key: 'isbn', labels: ['ISBN', 'ISBN'], itemTypes: ['book', 'bookSection', 'conferencePaper'] },
  { key: 'issn', labels: ['ISSN', 'ISSN'], itemTypes: ['journalArticle'] },
];

export function applicableMetadataFilterFields(itemType: LiteratureItemType | null = null): MetadataFilterField[] {
  return METADATA_FILTER_FIELDS.filter((field) => !itemType || !field.itemTypes || field.itemTypes.includes(itemType));
}

export function paperHasMissingMetadataField(paper: LiteraturePaper, field: string): boolean {
  const definition = METADATA_FILTER_FIELDS.find((candidate) => candidate.key === field);
  if (!definition) return false;
  const itemType = paper.itemType || 'journalArticle';
  if (definition.itemTypes && !definition.itemTypes.includes(itemType)) return false;
  if (field === 'authors') return !paper.authors.some((author) => author.name.trim());
  if (field === 'keywords') return !paper.keywords.some((keyword) => keyword.trim());
  const value = paper[field as keyof LiteraturePaper];
  return typeof value !== 'string' || value.trim() === '';
}
