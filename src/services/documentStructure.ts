import { invoke } from '../platform/electron/core.ts';

export interface PersistedDocumentUnit {
  unitId: string;
  parentUnitId: string | null;
  unitKind: string;
  ordinal: number;
  title: string | null;
  physicalStart: number;
  physicalEnd: number;
  printedStart: string | null;
  printedEnd: string | null;
  unitRevision: string;
}

export interface PersistedDocumentPage {
  physicalPage: number;
  printedPage: string | null;
  unitId: string | null;
  mappingRevision: string;
}

export interface PersistedDocumentStructure {
  generationId: string;
  sourceVersion: string;
  units: PersistedDocumentUnit[];
  pages: PersistedDocumentPage[];
}

export function getPersistedDocumentStructure(sourceId: string, pdfPath?: string): Promise<PersistedDocumentStructure | null> {
  const id = sourceId.trim();
  if (!id) return Promise.resolve(null);
  return invoke<PersistedDocumentStructure | null>('knowledge_document_structure_get', {
    sourceId: id,
    ...(pdfPath?.trim() ? { pdfPath: pdfPath.trim() } : {}),
  });
}
