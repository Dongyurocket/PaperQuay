const fsp = require('node:fs/promises');
const path = require('node:path');
const {
  MINERU_API_BASE,
  cleanString,
  ensureFile,
  fileNameFromPath,
  hashBytes,
  isPdf,
  now,
  parseMineruTokens,
  readRequestJson,
  readZipWithAdm,
  safeFileName,
} = require('./utils.cjs');
const { getPdfPageCount, planPdfSplits, splitPdfFiles } = require('./pdfSplitter.cjs');
const { mergeMineruParseResults } = require('./mineruMerge.cjs');
const { isWithinRoot } = require('./pathPolicy.cjs');

let globalMineruKeyIndex = 0;

function normalizeEndpoint(value) {
  return cleanString(value).replace(/\/+$/, '');
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 169 && parts[1] === 254) ||
    parts[0] === 127
  );
}

/**
 * MinerU 端点白名单：官方云端 + 本机/局域网自建服务。
 *
 * 不再与配置文件的 mineruApiBaseUrl 比对——配置文件是渲染层可写的，
 * 渲染层能同时改「配置端点」和「请求端点」，这个比对挡不住它。这里只允许
 * 云端官方主机与回环/私有地址，阻断把本地 PDF 上传到公网攻击者主机。
 */
function isAllowedMineruEndpoint(value) {
  const raw = normalizeEndpoint(value);
  if (!raw) return true;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;

  const hostname = parsed.hostname.toLowerCase();
  let officialHost = '';
  try {
    officialHost = new URL(MINERU_API_BASE).hostname.toLowerCase();
  } catch {}

  if (officialHost && hostname === officialHost) return true;
  if (hostname === 'localhost' || hostname === '::1' || hostname === '[::1]') return true;
  if (hostname.endsWith('.local')) return true;
  return isPrivateIpv4(hostname);
}

/**
 * 解压目录只能落在 MinerU 缓存根目录内。渲染层传入的 extractDir 通常就是
 * 阅读器按缓存键算出的目录，这里只做包含校验；越界时回退到受控默认目录，
 * 而不是把攻击者指定的路径交给解压器。
 */
function resolveExtractDir(appPaths, requestedExtractDir, fallbackName, pathPolicy) {
  const requested = cleanString(requestedExtractDir);
  if (requested) {
    const absolute = path.resolve(requested);
    // 默认缓存根，或主进程已授权的自定义缓存目录（目录对话框/持久化授权）。
    if (
      isWithinRoot(absolute, appPaths.mineruCacheDir) ||
      (pathPolicy && pathPolicy.isWriteAllowed(absolute))
    ) {
      return absolute;
    }
  }

  return path.join(appPaths.mineruCacheDir, fallbackName);
}

function maskToken(token) {
  if (!token || token.length < 8) return '***';
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

/**
 * 单个具体的 PDF 文件的 MinerU 云端解析生命周期（申请、上传、轮询、下载解压）
 */
async function runSingleMineruParse({
  pdfPath,
  fileName,
  dataId,
  tokens,
  apiBaseUrl,
  options,
  extractDir,
}) {
  const uploadUrlEndpoint = `${apiBaseUrl}/file-urls/batch?enable_formula=${options.enableFormula !== false}&enable_table=${options.enableTable !== false}&language=${encodeURIComponent(options.language || 'ch')}`;

  // 轮询调度（Round-Robin）选择初始 key，并支持故障切换
  const startKeyIndex = globalMineruKeyIndex % tokens.length;
  globalMineruKeyIndex = (globalMineruKeyIndex + 1) % 1000000;

  let activeToken = null;
  let batchId = null;
  let uploadUrl = null;
  const keyAttemptErrors = [];

  for (let attempt = 0; attempt < tokens.length; attempt++) {
    const candidateToken = tokens[(startKeyIndex + attempt) % tokens.length];
    try {
      const uploadEnvelope = await readRequestJson(await fetch(uploadUrlEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${candidateToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          files: [{ name: fileName, data_id: dataId }],
          model_version: options.modelVersion || 'vlm',
          is_ocr: options.isOcr === true,
        }),
      }), 'MinerU upload URL');

      if (uploadEnvelope.code !== 0) {
        const errMsg = uploadEnvelope.msg || uploadEnvelope.message || 'MinerU upload URL failed';
        throw new Error(errMsg);
      }

      const curBatchId = uploadEnvelope.data?.batch_id;
      const curUploadUrl = uploadEnvelope.data?.file_urls?.[0];
      if (!curBatchId || !curUploadUrl) {
        throw new Error('MinerU did not return an upload URL');
      }

      activeToken = candidateToken;
      batchId = curBatchId;
      uploadUrl = curUploadUrl;
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      keyAttemptErrors.push(`Key[${maskToken(candidateToken)}]: ${message}`);
      if (attempt + 1 < tokens.length) {
        continue;
      }
      break;
    }
  }

  if (!activeToken || !batchId || !uploadUrl) {
    if (tokens.length > 1) {
      throw new Error(`全部 ${tokens.length} 个 MinerU Key 均调用失败（已尝试轮询与故障重试）：\n${keyAttemptErrors.join('\n')}`);
    }
    throw new Error(keyAttemptErrors[0] || 'MinerU upload URL failed');
  }

  const putResponse = await fetch(uploadUrl, { method: 'PUT', body: await fsp.readFile(pdfPath) });
  if (!putResponse.ok) throw new Error(`MinerU PDF upload failed: HTTP ${putResponse.status}`);

  const timeoutAt = Date.now() + (options.timeoutSecs ?? 900) * 1000;
  const intervalMs = Math.max(1, options.pollIntervalSecs ?? 5) * 1000;
  let finalResult = null;

  while (Date.now() < timeoutAt) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const statusEnvelope = await readRequestJson(await fetch(`${apiBaseUrl}/extract-results/batch/${batchId}`, {
      headers: { Authorization: `Bearer ${activeToken}`, Accept: '*/*' },
    }), 'MinerU status');

    if (statusEnvelope.code !== 0) {
      throw new Error(statusEnvelope.msg || statusEnvelope.message || 'MinerU status failed');
    }

    const results = Array.isArray(statusEnvelope.data?.extract_result)
      ? statusEnvelope.data.extract_result
      : [statusEnvelope.data?.extract_result].filter(Boolean);
    const current = results.find((item) => item.data_id === dataId || item.file_name === fileName) ?? results[0];
    if (!current) continue;

    if (current.state === 'done') {
      finalResult = current;
      break;
    }

    if (current.state === 'failed') {
      const rawErrMsg = current.err_msg || 'MinerU parse failed';
      if (
        rawErrMsg.toLowerCase().includes('200 pages') ||
        rawErrMsg.toLowerCase().includes('exceeds limit') ||
        rawErrMsg.includes('200')
      ) {
        throw new Error(
          `MinerU 解析失败：PDF 页数超出 MinerU 云端单次 200 页限制（服务端提示: ${rawErrMsg}）。建议：请使用 PDF 工具将文档按 100~150 页拆分为分卷后再试；或在设置中配置本地部署的 MinerU 服务以解除页数限制。`,
        );
      }
      throw new Error(rawErrMsg);
    }
  }

  if (!finalResult?.full_zip_url) {
    throw new Error(`MinerU parse timed out or missed full_zip_url: ${batchId}`);
  }

  const zipResponse = await fetch(finalResult.full_zip_url);
  if (!zipResponse.ok) throw new Error(`MinerU zip download failed: HTTP ${zipResponse.status}`);

  const extracted = await readZipWithAdm(Buffer.from(await zipResponse.arrayBuffer()), extractDir);

  return {
    batchId,
    dataId,
    fileName,
    state: finalResult.state,
    fullZipUrl: finalResult.full_zip_url,
    usedToken: maskToken(activeToken),
    ...extracted,
  };
}

function createMineruCommands(context) {
  const { appPaths, pathPolicy } = context;

  return {
    async run_mineru_cloud_parse({ options }) {
      const rawTokens = options.apiTokens || options.apiToken;
      const tokens = parseMineruTokens(rawTokens);
      if (tokens.length === 0) throw new Error('MinerU API Token cannot be empty');
      const apiBaseUrl = normalizeEndpoint(options.apiBaseUrl) || MINERU_API_BASE;

      // 只允许官方云端或本机/局域网 MinerU；否则渲染层可以把任意本地
      // 文件上传到公网攻击者主机。
      if (!isAllowedMineruEndpoint(apiBaseUrl)) {
        throw new Error(`MinerU API endpoint is not allowed: ${apiBaseUrl}`);
      }

      const pdfPath = options.pdfPath;
      if (!isPdf(pdfPath)) {
        throw new Error('Only PDF files can be parsed by MinerU');
      }
      // 只接受文库附件、缓存或用户通过文件对话框选过的 PDF。
      pathPolicy.assertReadAllowed(pdfPath);
      await ensureFile(pdfPath);

      const fileName = fileNameFromPath(pdfPath);
      const dataId = `paper_reader_${now()}`;
      const fallbackExtractName = `${safeFileName(path.basename(fileName, '.pdf'))}-${hashBytes(Buffer.from(dataId)).slice(0, 8)}`;

      // 1. 读取页数，判断是否需要自动拆分
      let totalPageCount = 0;
      try {
        totalPageCount = await getPdfPageCount(pdfPath);
      } catch (err) {
        console.warn(`[MinerU] Failed to read page count for ${fileName}:`, err);
      }

      // 未超限（<= 200 页）或读取失败，走原生单卷解析
      if (totalPageCount <= 200) {
        const singleExtractDir = resolveExtractDir(
          appPaths,
          options.extractDir,
          fallbackExtractName,
          pathPolicy,
        );
        return await runSingleMineruParse({
          pdfPath,
          fileName,
          dataId,
          tokens,
          apiBaseUrl,
          options,
          extractDir: singleExtractDir,
        });
      }

      // 2. 超限（> 200 页）：自动按每卷 150 页切片拆分
      const splitPlans = planPdfSplits(totalPageCount, 150);
      const splitWorkDir = path.join(
        appPaths.mineruCacheDir,
        '.split-tmp',
        `${path.basename(fileName, '.pdf')}-${now()}`,
      );

      let splitPdfResults = [];
      try {
        splitPdfResults = await splitPdfFiles(pdfPath, splitPlans, splitWorkDir);
      } catch (splitErr) {
        console.warn(`[MinerU] Failed to split PDF for ${fileName}, falling back to direct parse:`, splitErr);
        const singleExtractDir = resolveExtractDir(
          appPaths,
          options.extractDir,
          fallbackExtractName,
          pathPolicy,
        );
        return await runSingleMineruParse({
          pdfPath,
          fileName,
          dataId,
          tokens,
          apiBaseUrl,
          options,
          extractDir: singleExtractDir,
        });
      }

      // 3. 逐卷执行解析（依托全局游标轮流使用各个 Key，并支持故障切换）
      const partResults = [];
      try {
        for (const part of splitPdfResults) {
          const partExtractDir = path.join(splitWorkDir, `extracted_part_${part.partIndex + 1}`);
          const partParsed = await runSingleMineruParse({
            pdfPath: part.path,
            fileName: path.basename(part.path),
            dataId: `paper_reader_part_${part.partIndex + 1}_${now()}`,
            tokens,
            apiBaseUrl,
            options,
            extractDir: partExtractDir,
          });

          partResults.push({
            partIndex: part.partIndex,
            startPage: part.startPage,
            endPage: part.endPage,
            pageOffset: part.pageOffset,
            pageCount: part.pageCount,
            extracted: partParsed,
          });
        }
      } finally {
        // 清理临时切片的 PDF 文件
        for (const part of splitPdfResults) {
          await fsp.unlink(part.path).catch(() => {});
        }
      }

      // 4. 产物合并（统一 content_list.json、middle.json、full.md 与 images）
      const finalExtractDir = resolveExtractDir(
        appPaths,
        options.extractDir,
        fallbackExtractName,
        pathPolicy,
      );

      const merged = await mergeMineruParseResults(partResults, finalExtractDir);

      // 5. 清理临时解压目录
      await fsp.rm(splitWorkDir, { recursive: true, force: true }).catch(() => {});

      const usedTokens = Array.from(
        new Set(partResults.map((p) => p.extracted.usedToken).filter(Boolean)),
      ).join(', ');

      return {
        batchId: partResults.map((p) => p.extracted.batchId).join(','),
        dataId,
        fileName,
        state: 'done',
        fullZipUrl: partResults[0]?.extracted.fullZipUrl || '',
        usedToken: usedTokens,
        isSplitMerged: true,
        splitPartCount: partResults.length,
        totalPageCount,
        ...merged,
      };
    },
  };
}

module.exports = { createMineruCommands, isAllowedMineruEndpoint, resolveExtractDir };
