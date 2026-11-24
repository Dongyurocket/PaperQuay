'use strict';

/**
 * Single source of truth for OpenAI-compatible embedding settings.
 *
 * Shared by the notes indexer (main process), the MCP service, and the
 * renderer RAG client so the embedding model key used to compare an index
 * with the configured model is identical everywhere.
 */

const DEFAULT_EMBEDDING_TIMEOUT_SECONDS = 60;
const MIN_EMBEDDING_TIMEOUT_SECONDS = 5;
const MAX_EMBEDDING_TIMEOUT_SECONDS = 600;
const DEFAULT_EMBEDDING_BATCH_SIZE = 24;
const MIN_EMBEDDING_BATCH_SIZE = 1;
const MAX_EMBEDDING_BATCH_SIZE = 100;

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** Normalize a user-entered base URL to the `<origin>/<version>` form. */
function normalizeEmbeddingBaseUrl(baseUrl) {
  const trimmed = cleanString(baseUrl);

  if (!trimmed) {
    return '';
  }

  const normalized = trimmed
    .replace(/\/embeddings\/?$/i, '')
    .replace(/\/+$/, '');

  if (/\/v\d+$/i.test(normalized)) {
    return normalized;
  }

  return `${normalized}/v1`;
}

function clampEmbeddingDimensions(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function clampEmbeddingTimeoutSeconds(value, fallback = DEFAULT_EMBEDDING_TIMEOUT_SECONDS) {
  const numeric = Number(value);
  const fallbackNumber = Number(fallback);
  const resolved = Number.isFinite(numeric) && numeric > 0
    ? numeric
    : (Number.isFinite(fallbackNumber) && fallbackNumber > 0
      ? fallbackNumber
      : DEFAULT_EMBEDDING_TIMEOUT_SECONDS);
  return Math.max(MIN_EMBEDDING_TIMEOUT_SECONDS, Math.min(MAX_EMBEDDING_TIMEOUT_SECONDS, Math.round(resolved)));
}

function clampEmbeddingBatchSize(value, fallback = DEFAULT_EMBEDDING_BATCH_SIZE) {
  const numeric = Number(value);
  const fallbackNumber = Number(fallback);
  const resolved = Number.isFinite(numeric) && numeric > 0
    ? numeric
    : (Number.isFinite(fallbackNumber) && fallbackNumber > 0
      ? fallbackNumber
      : DEFAULT_EMBEDDING_BATCH_SIZE);
  return Math.max(MIN_EMBEDDING_BATCH_SIZE, Math.min(MAX_EMBEDDING_BATCH_SIZE, Math.round(resolved)));
}

/**
 * Stable key stored in `rag_indexes.embedding_model_key`; changing any part of
 * the effective embedding configuration must invalidate previous vectors.
 */
function buildEmbeddingModelKey(config) {
  const baseUrl = normalizeEmbeddingBaseUrl(config?.baseUrl);
  const model = cleanString(config?.model);
  const dimensions = clampEmbeddingDimensions(config?.dimensions);
  return `${baseUrl}::${model}::${dimensions ?? 'default'}`;
}

/**
 * Resolve the effective embedding configuration from a reader config document
 * (`{ settings, secrets }`). `secrets` must already be decrypted by the caller.
 *
 * - `requireApiKey` defaults to true (notes/renderer behavior).
 * - `timeoutSeconds` overrides settings when provided; otherwise
 *   `settings.embeddingRequestTimeoutSeconds` is used with `defaultTimeoutSeconds`.
 */
function resolveEmbeddingConfigFromDocument(document, options = {}) {
  const settings = document?.settings && typeof document.settings === 'object' ? document.settings : {};
  const secrets = document?.secrets && typeof document.secrets === 'object' ? document.secrets : {};

  const baseUrl = normalizeEmbeddingBaseUrl(settings.embeddingBaseUrl);
  const model = cleanString(settings.embeddingModel);
  const apiKey = cleanString(secrets.embeddingApiKey);

  if (!baseUrl || !model) {
    return null;
  }

  const requireApiKey = options.requireApiKey !== false;
  if (requireApiKey && !apiKey) {
    return null;
  }

  const defaultTimeoutSeconds = options.defaultTimeoutSeconds ?? DEFAULT_EMBEDDING_TIMEOUT_SECONDS;
  const timeoutSeconds = options.timeoutSeconds !== undefined
    ? clampEmbeddingTimeoutSeconds(options.timeoutSeconds, defaultTimeoutSeconds)
    : clampEmbeddingTimeoutSeconds(settings.embeddingRequestTimeoutSeconds, defaultTimeoutSeconds);

  return {
    baseUrl,
    model,
    dimensions: clampEmbeddingDimensions(settings.embeddingDimensions),
    apiKey,
    timeoutSeconds,
  };
}

module.exports = {
  DEFAULT_EMBEDDING_TIMEOUT_SECONDS,
  MIN_EMBEDDING_TIMEOUT_SECONDS,
  MAX_EMBEDDING_TIMEOUT_SECONDS,
  DEFAULT_EMBEDDING_BATCH_SIZE,
  MIN_EMBEDDING_BATCH_SIZE,
  MAX_EMBEDDING_BATCH_SIZE,
  normalizeEmbeddingBaseUrl,
  buildEmbeddingModelKey,
  resolveEmbeddingConfigFromDocument,
  clampEmbeddingDimensions,
  clampEmbeddingTimeoutSeconds,
  clampEmbeddingBatchSize,
};
