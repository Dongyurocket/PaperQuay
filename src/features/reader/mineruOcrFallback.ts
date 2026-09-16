import {
  runMineruCloudParse,
  runPaddleOcrCloudParse,
  type MineruCloudParseOptions,
  type MineruCloudParseResult,
  type PaddleOcrCloudParseOptions,
} from '../../services/desktop';
import { parseMineruPages } from '../../services/mineru';
import type { DocumentParseProvider } from '../../types/reader';

export interface MineruParseWithFallbackResult {
  result: MineruCloudParseResult;
  jsonText: string;
  blockCount: number;
  usedOcr: boolean;
}

/**
 * 一次结构识别请求。两个引擎共用该结构，差异只体现在凭据与 base URL，
 * 调用方（阅读器 / 文献库 / 批量任务）不需要区分 provider。
 */
export interface DocumentParseRequest {
  reparse?: boolean;
  documentKey?: string;
  provider: DocumentParseProvider;
  pdfPath: string;
  extractDir?: string;
  mineruApiToken: string;
  mineruApiBaseUrl?: string;
  paddleOcrApiToken: string;
  paddleOcrApiBaseUrl?: string;
  timeoutSecs?: number;
  pollIntervalSecs?: number;
}

export function getParseProviderLabel(provider: DocumentParseProvider): string {
  return provider === 'paddleocr-vl' ? 'PaddleOCR-VL' : 'MinerU';
}

/** 当前 provider 缺少必填凭据时返回提示文案，否则返回 null。 */
export function getMissingParseCredentialMessage(
  request: Pick<DocumentParseRequest, 'provider' | 'mineruApiToken' | 'paddleOcrApiToken'>,
): string | null {
  if (request.provider === 'paddleocr-vl') {
    return request.paddleOcrApiToken.trim() ? null : '缺少 PaddleOCR-VL API Token';
  }

  return request.mineruApiToken.trim() ? null : '缺少 MinerU API Token';
}

function getMineruJsonText(result: MineruCloudParseResult): string {
  return result.contentJsonText ?? result.middleJsonText ?? '';
}

function countParsedBlocks(jsonText: string): number {
  return parseMineruPages(jsonText).reduce((count, page) => count + page.length, 0);
}

function createEmptyResultError() {
  return new Error('MinerU returned an empty structured result.');
}

function shouldRetryWithOcr(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');

  if (!message.trim()) {
    return true;
  }

  return !/(api\s*token|authorization|unauthori[sz]ed|forbidden|http\s*(?:401|403)|upload url|upload failed|zip download|timed?\s*out|timeout|200\s*pages?|exceeds?\s*limit|200\s*页|页数超出)/i.test(
    message,
  );
}

async function runAttempt(
  options: MineruCloudParseOptions,
  usedOcr: boolean,
): Promise<MineruParseWithFallbackResult> {
  const result = await runMineruCloudParse({
    ...options,
    isOcr: usedOcr,
  });
  const jsonText = getMineruJsonText(result);

  if (!jsonText.trim()) {
    throw createEmptyResultError();
  }

  const blockCount = countParsedBlocks(jsonText);

  if (blockCount <= 0) {
    throw createEmptyResultError();
  }

  return {
    result,
    jsonText,
    blockCount,
    usedOcr,
  };
}

export async function runMineruCloudParseWithOcrFallback(
  options: MineruCloudParseOptions,
  onRetry?: () => void,
): Promise<MineruParseWithFallbackResult> {
  try {
    return await runAttempt(options, options.isOcr === true);
  } catch (firstError) {
    if (options.isOcr === true || !shouldRetryWithOcr(firstError)) {
      throw firstError;
    }

    onRetry?.();
    return runAttempt(options, true);
  }
}

/**
 * 按 provider 分发一次结构识别。
 *
 * PaddleOCR-VL 没有 MinerU 的 isOcr 二次重试语义（云端本身就是 OCR/VL 链路），
 * 因此只在 MinerU 分支保留「空结果 → 切 OCR 重试」的兜底。
 */
export async function runDocumentParseWithFallback(
  request: DocumentParseRequest,
  onRetry?: () => void,
): Promise<MineruParseWithFallbackResult> {
  if (request.provider === 'paddleocr-vl') {
    const options: PaddleOcrCloudParseOptions = {
      documentKey: request.documentKey,
      reparse: request.reparse,
      apiToken: request.paddleOcrApiToken.trim(),
      apiBaseUrl: request.paddleOcrApiBaseUrl,
      pdfPath: request.pdfPath,
      extractDir: request.extractDir,
      timeoutSecs: request.timeoutSecs,
      pollIntervalSecs: request.pollIntervalSecs,
    };

    const result = await runPaddleOcrCloudParse(options);
    const jsonText = getMineruJsonText(result);

    if (!jsonText.trim()) {
      throw createEmptyResultError();
    }

    const blockCount = countParsedBlocks(jsonText);

    if (blockCount <= 0) {
      throw createEmptyResultError();
    }

    return { result, jsonText, blockCount, usedOcr: false };
  }

  return runMineruCloudParseWithOcrFallback(
    {
      apiToken: request.mineruApiToken.trim(),
      apiBaseUrl: request.mineruApiBaseUrl,
      pdfPath: request.pdfPath,
      extractDir: request.extractDir,
      language: 'ch',
      modelVersion: 'vlm',
      enableFormula: true,
      enableTable: true,
      isOcr: false,
      timeoutSecs: request.timeoutSecs ?? 900,
      pollIntervalSecs: request.pollIntervalSecs ?? 5,
    },
    onRetry,
  );
}
