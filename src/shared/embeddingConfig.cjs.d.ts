export interface EmbeddingConfigDocument {
  settings?: {
    embeddingBaseUrl?: string | null;
    embeddingModel?: string | null;
    embeddingDimensions?: number | string | null;
    embeddingRequestTimeoutSeconds?: number | null;
  };
  secrets?: {
    embeddingApiKey?: string | null;
  };
}

export interface ResolvedEmbeddingConfig {
  baseUrl: string;
  model: string;
  dimensions: number | null;
  apiKey: string;
  timeoutSeconds: number;
}

export interface ResolveEmbeddingConfigOptions {
  timeoutSeconds?: number;
  requireApiKey?: boolean;
  defaultTimeoutSeconds?: number;
}

export const DEFAULT_EMBEDDING_TIMEOUT_SECONDS: number;
export const MIN_EMBEDDING_TIMEOUT_SECONDS: number;
export const MAX_EMBEDDING_TIMEOUT_SECONDS: number;
export const DEFAULT_EMBEDDING_BATCH_SIZE: number;
export const MIN_EMBEDDING_BATCH_SIZE: number;
export const MAX_EMBEDDING_BATCH_SIZE: number;

export function normalizeEmbeddingBaseUrl(baseUrl: string | null | undefined): string;
export function buildEmbeddingModelKey(config: {
  baseUrl?: string | null;
  model?: string | null;
  dimensions?: number | null;
}): string;
export function resolveEmbeddingConfigFromDocument(
  document: EmbeddingConfigDocument | null | undefined,
  options?: ResolveEmbeddingConfigOptions,
): ResolvedEmbeddingConfig | null;
export function clampEmbeddingDimensions(value: unknown): number | null;
export function clampEmbeddingTimeoutSeconds(value: unknown, fallback?: number): number;
export function clampEmbeddingBatchSize(value: unknown, fallback?: number): number;
