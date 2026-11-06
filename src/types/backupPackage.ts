export type BackupExportPreset = 'migration' | 'daily' | 'custom';
export type BackupCompressionLevel = 'fast' | 'standard' | 'none';

export interface BackupExportOptions {
  preset: BackupExportPreset;
  includeRag: boolean;
  includeDerived: boolean;
  includeVault: boolean;
  includePdfs: boolean;
  includeRendererState: boolean;
  compressionLevel: BackupCompressionLevel;
  selfVerify: boolean;
}

export type BackupEstimateComponent =
  | 'databases'
  | 'pdfs'
  | 'rag'
  | 'derived'
  | 'vault'
  | 'rendererState';

export interface BackupEstimateBreakdownItem {
  entries: number;
  totalBytes: number;
}

export interface BackupExportEstimate {
  entries: number;
  totalBytes: number;
  warnings: Array<string | BackupWarning>;
  breakdown?: Partial<Record<BackupEstimateComponent, BackupEstimateBreakdownItem>>;
}

export interface BackupWarning {
  code: string;
  kind?: string;
  originalName?: string;
  detail?: string;
}

export type BackupDirection = 'export' | 'import' | 'rollback';
export type BackupProgressPhase =
  | 'preflight'
  | 'collecting'
  | 'snapshot'
  | 'writing'
  | 'verifying'
  | 'committing'
  | 'restarting'
  | 'done'
  | 'failed';

export interface BackupProgress {
  direction: BackupDirection;
  phase: BackupProgressPhase;
  completedBytes: number;
  totalBytes: number;
  completedEntries: number;
  totalEntries: number;
  currentLabel: string;
  cancellable?: boolean;
}

export interface BackupExportResult {
  ok: boolean;
  packagePath: string;
  bytes: number;
  entries: number;
  durationMs: number;
  warnings: Array<string | BackupWarning>;
}

export interface BackupManifestSummary {
  createdAt: string;
  app: {
    version: string;
    platform?: string;
    arch?: string;
  };
  counts: Record<string, number>;
  totalBytes: number;
  packageBytes?: number;
  hasRag: boolean;
  hasDerived: boolean;
  hasVault: boolean;
}

export interface BackupImportInspectResult {
  ok: boolean;
  manifestSummary: BackupManifestSummary;
  warnings: Array<string | BackupWarning>;
}

export interface BackupImportTargets {
  libraryStorageDir: string;
  notesVaultDir?: string | null;
}

export interface BackupImportStageResult {
  ok: boolean;
  restoreId: string;
  restartRequired: boolean;
}

export interface BackupHistoryRecord {
  direction: BackupDirection;
  createdAt?: string;
  completedAt?: string;
  path?: string;
  packagePath?: string;
  bytes?: number;
  entries?: number;
  durationMs?: number;
  sourceVersion?: string;
  result?: 'success' | 'failed' | 'cancelled' | string;
  message?: string;
  warnings?: Array<string | BackupWarning>;
}

export interface BackupOldDataDirectory {
  path: string;
  sizeBytes?: number;
  bytes?: number;
  createdAt?: string;
  kind?: 'data' | 'library' | string;
}

export interface BackupStatus {
  pendingRestore: boolean;
  lastExport: BackupHistoryRecord | null;
  lastRestore: BackupHistoryRecord | null;
  oldDataDirs: string[];
  history?: BackupHistoryRecord[];
  oldDataDirDetails?: BackupOldDataDirectory[];
}

export interface BackupRollbackResult {
  ok: boolean;
  restoreId: string;
  restartRequired: boolean;
}

export interface BackupDeleteOldDataResult {
  ok: boolean;
  freedBytes: number;
}

export type BackupRendererState = Record<string, string>;
