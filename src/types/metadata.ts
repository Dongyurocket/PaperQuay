export interface MetadataLookupRequest {
  doi?: string | null;
  title?: string | null;
  path?: string | null;
}

export interface MetadataLookupResult {
  source: string;
  doi: string | null;
  title: string | null;
  authors: string[];
  year: string | null;
  publication: string | null;
  url: string | null;
  abstractText: string | null;
  /** 以下为 LLM 提取（source === 'llm-extract'）可能额外提供的字段。 */
  keywords?: string[];
  publisher?: string | null;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  issn?: string | null;
  itemType?: string | null;
}

export interface LocalPdfMetadataPreview {
  title: string | null;
  authors: string[];
  year: string | null;
  publication: string | null;
  doi: string | null;
  firstPageText: string | null;
}
