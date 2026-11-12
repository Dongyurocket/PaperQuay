import { invoke } from '../platform/electron/core';

export interface LiteratureFileLocation {
  id: string;
  paperId: string;
  role: string;
  path?: string;
  fileName: string | null;
  language?: string | null;
  generationId?: string;
  evidenceId?: string;
  locatorStatus?: string;
  pageIndex?: number;
  printedPage?: string | null;
  sourceVersion?: string;
  isCurrentGeneration?: boolean;
  status: 'available' | 'missing' | 'not-generated' | 'remote-only' | string;
  targetKind: 'file' | 'directory' | null;
  versionStatus: string;
}

export async function listLiteratureFileLocations(paperId: string, evidenceId?: string): Promise<LiteratureFileLocation[]> {
  return invoke('list_literature_file_locations', { paperId, evidenceId });
}

export async function revealLiteratureFileLocation(paperId: string, locationId: string, evidenceId?: string): Promise<void> {
  await invoke('reveal_literature_file_location', { paperId, locationId, evidenceId });
}
