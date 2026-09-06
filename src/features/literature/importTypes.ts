import type { LiteratureItemType } from '../../types/library';

export interface ImportDraftItem {
  path: string;
  title: string;
  authors: string;
  year: string;
  publication: string;
  doi: string;
  url: string;
  abstractText: string;
  categoryId: string;
  itemType?: LiteratureItemType;
  publisher?: string;
  institution?: string;
  reportNumber?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  isbn?: string;
  issn?: string;
}
