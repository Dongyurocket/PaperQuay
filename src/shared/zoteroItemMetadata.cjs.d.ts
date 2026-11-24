export interface ZoteroItemMetadataSource {
  itemKey?: string | null;
  attachmentKey?: string | null;
  localPdfPath?: string | null;
  title?: string | null;
  creators?: string | null;
  year?: string | null;
  itemType?: string | null;
  language?: string | null;
  extra?: string | null;
  authors?: Array<{
    name?: string | null;
    givenName?: string | null;
    familyName?: string | null;
    affiliation?: string | null;
    orcid?: string | null;
  }> | null;
  attachmentFilename?: string | null;
}

export interface ZoteroItemMetadata {
  title: string;
  authors: string[];
  year: string | null;
  publication: null;
  doi: null;
  itemType?: string;
  authorDetails?: Array<{
    name: string;
    givenName: string | null;
    familyName: string | null;
    affiliation: string | null;
    orcid: string | null;
  }>;
  language?: string;
  citationKey?: string;
}

export function buildZoteroItemMetadata(item: ZoteroItemMetadataSource): ZoteroItemMetadata;
export function zoteroItemIdentity(item: ZoteroItemMetadataSource | null | undefined): string;
export function splitAuthors(value: string | null | undefined): string[];
export function normalizeItemType(rawType: string | null | undefined): string;
export function canonicalizeBcp47Language(value: string | null | undefined): string | null;
export function isValidCitationKey(value: string | null | undefined): boolean;
export function normalizeOrcid(value: string | null | undefined): string | null;
