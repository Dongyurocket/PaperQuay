import { readReaderConfigFile } from './readerConfig';
import type { ReaderSecrets, ReaderSettings } from '../types/reader';

export interface EmbeddingConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  dimensions: number | null;
  timeoutSeconds: number;
}

function readStorageJson<T>(key: string): Partial<T> {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as Partial<T> : {};
  } catch {
    return {};
  }
}

export async function loadEmbeddingConfig(): Promise<EmbeddingConfig | null> {
  let persisted: { settings?: Partial<ReaderSettings>; secrets?: Partial<ReaderSecrets> } | null = null;
  try {
    persisted = await readReaderConfigFile();
  } catch {
    persisted = null;
  }
  const settings = { ...persisted?.settings, ...readStorageJson<ReaderSettings>('paper-reader-settings-v3') };
  const secrets = { ...persisted?.secrets, ...readStorageJson<ReaderSecrets>('paper-reader-secrets-v1') };
  const apiKey = secrets.embeddingApiKey?.trim();
  const baseUrl = settings.embeddingBaseUrl?.trim();
  const model = settings.embeddingModel?.trim();
  if (!apiKey || !baseUrl || !model) return null;
  return {
    apiKey,
    baseUrl,
    model,
    dimensions: typeof settings.embeddingDimensions === 'number' && Number.isFinite(settings.embeddingDimensions)
      ? settings.embeddingDimensions : null,
    timeoutSeconds: typeof settings.embeddingRequestTimeoutSeconds === 'number' && Number.isFinite(settings.embeddingRequestTimeoutSeconds)
      ? settings.embeddingRequestTimeoutSeconds : 180,
  };
}
