/**
 * MinerU 缓存路径构造（渲染层与 MCP 共用的唯一实现）。
 *
 * 历史问题：阅读器用 `native-library:<paperId>` 的哈希命名缓存目录，而 MCP
 * 用裸 `paperId` 的哈希查找，导致 `read_paper_figure` 对当前阅读器解析的论文
 * 永远返回 found:false。这里把目录名与候选 JSON 列表收敛到一份实现，
 * 两边都从这里取，测试也通过这里的构造器写入缓存。
 */

function getPathSeparator(pathValue) {
  return pathValue.includes('\\') ? '\\' : '/';
}

function joinPath(basePath, ...segments) {
  const separator = getPathSeparator(basePath);
  const normalizedBase = basePath.replace(/[\\/]+$/, '');
  return [normalizedBase, ...segments.filter(Boolean)].join(separator);
}

function sanitizePathSegment(value) {
  const trimmed = String(value ?? '').trim().toLowerCase();
  if (!trimmed) return 'document';

  return trimmed
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'document';
}

function hashString(value) {
  let hash = 2166136261;
  const text = String(value ?? '');

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function buildCachePaths(rootDir, directoryName) {
  const directory = joinPath(rootDir, directoryName);

  return {
    directory,
    manifestPath: joinPath(directory, 'paper_reader_manifest.json'),
    contentJsonPath: joinPath(directory, 'content_list_v2.json'),
    contentListJsonPath: joinPath(directory, 'content_list.json'),
    middleJsonPath: joinPath(directory, 'middle.json'),
    markdownPath: joinPath(directory, 'full.md'),
    translationsDir: joinPath(directory, 'translations'),
    summariesDir: joinPath(directory, 'summaries'),
  };
}

function stableDocumentKey(item) {
  return item?.workspaceId || item?.itemKey || item?.localPdfPath || item?.title || 'document';
}

function buildMineruCachePaths(rootDir, item) {
  return buildCachePaths(rootDir, `document-${hashString(stableDocumentKey(item))}`);
}

function buildTitleMineruCachePaths(rootDir, item) {
  return buildCachePaths(rootDir, `${sanitizePathSegment(item?.title)}-${hashString(item?.workspaceId)}`);
}

function buildLegacyMineruCachePaths(rootDir, item) {
  return buildCachePaths(rootDir, `${sanitizePathSegment(item?.title)}-${hashString(item?.itemKey)}`);
}

function getMineruJsonPathCandidates(cachePaths) {
  return [
    cachePaths.contentJsonPath,
    cachePaths.contentListJsonPath,
    cachePaths.middleJsonPath,
  ];
}

function buildMineruCachePathCandidates(rootDir, item) {
  const candidates = [
    buildMineruCachePaths(rootDir, item),
    buildTitleMineruCachePaths(rootDir, item),
    buildLegacyMineruCachePaths(rootDir, item),
  ];
  const seenDirectories = new Set();

  return candidates.filter((candidate) => {
    if (seenDirectories.has(candidate.directory)) return false;
    seenDirectories.add(candidate.directory);
    return true;
  });
}

module.exports = {
  buildCachePaths,
  buildLegacyMineruCachePaths,
  buildMineruCachePathCandidates,
  buildMineruCachePaths,
  buildTitleMineruCachePaths,
  getMineruJsonPathCandidates,
  getPathSeparator,
  hashString,
  joinPath,
  sanitizePathSegment,
  stableDocumentKey,
};
