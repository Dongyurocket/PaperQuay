import type { LibrarySettings, LiteraturePaper } from '../../types/library';

export const LIBRARY_SETTINGS_UPDATED_EVENT = 'paperquay:library-settings-updated';
export const ZOTERO_IMPORT_REQUEST_EVENT = 'paperquay:zotero-import-request';
export const LIBRARY_METADATA_ENRICH_REQUEST_EVENT = 'paperquay:library-metadata-enrich-request';
export const NATIVE_PAPER_UPDATED_EVENT = 'paperquay:native-paper-updated';

export interface LibrarySettingsUpdatedEventDetail {
  settings: LibrarySettings;
  source?: string;
}

export interface ZoteroImportRequestEventDetail {
  dataDir?: string;
  source?: string;
}

export function emitLibrarySettingsUpdated(settings: LibrarySettings, source?: string) {
  window.dispatchEvent(
    new CustomEvent<LibrarySettingsUpdatedEventDetail>(LIBRARY_SETTINGS_UPDATED_EVENT, {
      detail: { settings, source },
    }),
  );
}

export function emitZoteroImportRequest(dataDir?: string, source?: string) {
  window.dispatchEvent(
    new CustomEvent<ZoteroImportRequestEventDetail>(ZOTERO_IMPORT_REQUEST_EVENT, {
      detail: { dataDir, source },
    }),
  );
}

export function emitLibraryMetadataEnrichRequest() {
  window.dispatchEvent(new CustomEvent(LIBRARY_METADATA_ENRICH_REQUEST_EVENT));
}

export interface NativePaperUpdatedEventDetail {
  paper: LiteraturePaper;
}

/** 文献附件或元数据在某一侧（文献库/阅读器）变更后广播，另一侧据此增量刷新本地状态。 */
export function emitNativePaperUpdated(paper: LiteraturePaper) {
  window.dispatchEvent(
    new CustomEvent<NativePaperUpdatedEventDetail>(NATIVE_PAPER_UPDATED_EVENT, {
      detail: { paper },
    }),
  );
}
