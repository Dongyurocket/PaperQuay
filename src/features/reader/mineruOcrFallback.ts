import {
  runMineruCloudParse,
  type MineruCloudParseOptions,
  type MineruCloudParseResult,
} from '../../services/desktop';
import { parseMineruPages } from '../../services/mineru';

export interface MineruParseWithFallbackResult {
  result: MineruCloudParseResult;
  jsonText: string;
  blockCount: number;
  usedOcr: boolean;
}

/** 当前唯一的结构识别引擎标签。缓存契约统一为 MinerU。 */
export const PARSE_ENGINE_LABEL = 'MinerU';

/** 缺少 MinerU 凭据时返回提示文案，否则返回 null。 */
export function getMissingMineruCredentialMessage(mineruApiToken: string): string | null {
  return mineruApiToken.trim() ? null : '缺少 MinerU API Token';
}

/** 阅读器、文献库与批量任务共用的 MinerU 云端请求参数。 */
export interface MineruParseRequest {
  reparse?: boolean;
  documentKey?: string;
  pdfPath: string;
  extractDir?: string;
  mineruApiToken: string;
  mineruApiBaseUrl?: string;
  timeoutSecs?: number;
  pollIntervalSecs?: number;
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
 * 按统一 MinerU 参数执行一次结构识别。
 *
 * 保留「空结果 / 结构不可用 → 切 OCR 重试」的兜底，这是唯一的解析与 OCR 降级入口。
 */
export async function runDocumentParseWithFallback(
  request: MineruParseRequest,
  onRetry?: () => void,
): Promise<MineruParseWithFallbackResult> {
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
