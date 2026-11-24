const fs = require('node:fs');
const path = require('node:path');
const { cleanString } = require('./utils.cjs');

/**
 * 主进程的文件访问边界。
 *
 * 渲染进程不是可信主体：任意脚本（XSS / 恶意依赖）都能调用 preload 暴露的
 * IPC。这里把「哪些路径可以读、哪些可以写」收敛到主进程的统一策略：
 *   - 读：应用数据目录、文库/译版/MinerU 缓存等已知根目录，以及由主进程
 *     文件对话框返回的路径（自动登记）；
 *   - 写：只允许上述根目录、对话框返回的保存路径，以及文库附件所在目录下
 *     的 `.pdf`（批注版导出）。
 * 所有写入与协议读取都在 resolve + realpath 之后做包含校验，拒绝设备路径
 * 与 NTFS 备用数据流。
 */

const WRITABLE_EXTENSIONS_IN_ATTACHMENT_DIRS = new Set(['.pdf']);

/**
 * 只读授权状态的原因码。设置页据此区分「应用默认目录」「dataDir 内的配置目录」
 * 「目录对话框授权」「已登记附件目录」与「已配置但缺少授权」，从而提示用户重新选择目录。
 */
const AUTHORIZATION_REASONS = Object.freeze({
  DEFAULT: 'default',
  CONFIGURED: 'configured',
  DIALOG_APPROVED: 'dialog-approved',
  KNOWN_ATTACHMENT: 'known-attachment',
  MISSING_APPROVAL: 'missing-approval',
  MISSING: 'missing',
  UNSAFE: 'unsafe',
});

function comparablePath(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isWithinRoot(absolutePath, root) {
  const comparableAbsolute = comparablePath(absolutePath);
  const comparableRoot = comparablePath(root);
  const rootWithSep = comparableRoot.endsWith(path.sep) ? comparableRoot : `${comparableRoot}${path.sep}`;
  return comparableAbsolute === comparableRoot || comparableAbsolute.startsWith(rootWithSep);
}

function isUncPath(filePath) {
  const raw = String(filePath ?? '');
  return /^\\\\[^\\]/.test(raw) || /^\/\/[^/]/.test(raw);
}

function hasWindowsDevicePrefix(filePath) {
  const raw = String(filePath ?? '');
  return /^\\\\[?.]\\/.test(raw);
}

function hasAlternateDataStream(filePath) {
  if (process.platform !== 'win32') return false;
  const raw = String(filePath ?? '');
  const withoutDrive = /^[a-zA-Z]:/.test(raw) ? raw.slice(2) : raw;
  return withoutDrive.includes(':');
}

function hasUnsafePathSyntax(filePath) {
  const raw = String(filePath ?? '');
  if (!raw || raw.includes('\0')) return true;
  if (hasWindowsDevicePrefix(raw)) return true;
  if (hasAlternateDataStream(raw)) return true;
  return false;
}

function safeRealpathSync(filePath) {
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(filePath) : fs.realpathSync(filePath);
  } catch {
    return null;
  }
}

function createPathPolicy({
  appPaths,
  store,
  approvedReadPaths = new Set(),
  approvedWritePaths = new Set(),
}) {
  // 通过文件对话框打开过的目录：允许把批注版 `.pdf` 写回同目录。
  // 只放开 .pdf，不放开任意扩展名，避免变成通用写权限。
  const approvedSiblingPdfWriteDirs = new Set();
  // 对话框授权必须跨重启保留，否则自定义 MinerU/译版目录每次启动都要重选。
  // 它由主进程独占写入；渲染层即使能写 dataDir 也不能改写它（见 isWriteAllowed）。
  const approvalsFilePath = path.join(appPaths.dataDir, '.paperquay-approved-roots.json');
  loadPersistedApprovals();

  function loadPersistedApprovals() {
    try {
      const raw = JSON.parse(fs.readFileSync(approvalsFilePath, 'utf8'));
      for (const entry of Array.isArray(raw?.readRoots) ? raw.readRoots : []) {
        if (typeof entry === 'string' && entry) approvedReadPaths.add(entry);
      }
      for (const entry of Array.isArray(raw?.writeRoots) ? raw.writeRoots : []) {
        if (typeof entry === 'string' && entry) approvedWritePaths.add(entry);
      }
    } catch {
      // 首次运行或文件损坏：从空授权开始。
    }
  }

  function persistApprovals() {
    try {
      fs.mkdirSync(path.dirname(approvalsFilePath), { recursive: true });
      const temporaryPath = `${approvalsFilePath}.${process.pid}.tmp`;
      fs.writeFileSync(
        temporaryPath,
        JSON.stringify({
          version: 1,
          readRoots: [...approvedReadPaths].slice(-200),
          writeRoots: [...approvedWritePaths].slice(-200),
        }),
        'utf8',
      );
      fs.renameSync(temporaryPath, approvalsFilePath);
    } catch (error) {
      console.warn('[paperquay] Failed to persist approved paths.', error);
    }
  }

  function isProtectedMainFile(absolutePath) {
    return comparablePath(absolutePath) === comparablePath(approvalsFilePath);
  }

  function loadSettings() {
    try {
      return (typeof store?.loadSettings === 'function' ? store.loadSettings() : null) ?? {};
    } catch {
      return {};
    }
  }

  function expandRoots(values) {
    const roots = [];

    for (const value of values) {
      const root = cleanString(value);
      if (!root) continue;
      roots.push(root);
      // 配置的目录可能是符号链接/junction；realpath 也要作为根参与比较。
      const real = safeRealpathSync(root);
      if (real) roots.push(real);
    }

    return roots;
  }

  /**
   * 信任根只能来自应用路径、主进程写过的文库设置（storageDir）
   * 与主进程对话框授权。不要直接信任渲染层可写的配置文件：否则一次
   * write_text_file 就能把 C:\ 变成许可根。
   *
   * translatedPdfDir 不在这里信任：自定义译版目录必须和 MinerU 自定义目录
   * 一样经目录对话框授权，否则 path_authorization_status 会报 missing-approval
   * 而实际读写仍放行（B1 复核发现的策略/状态矛盾）。默认译版目录位于
   * storageDir 或 dataDir 内，仍由上面的根覆盖。
   */
  function readRoots() {
    const settings = loadSettings();
    return expandRoots([
      appPaths.dataDir,
      appPaths.mineruCacheDir,
      appPaths.remotePdfDownloadDir,
      settings.storageDir,
      ...approvedReadPaths,
    ]);
  }

  function writeRoots() {
    const settings = loadSettings();
    return expandRoots([
      appPaths.dataDir,
      // 默认 MinerU 缓存目录由主进程决定，始终可写；自定义目录只能来自对话框授权。
      appPaths.mineruCacheDir,
      settings.storageDir,
      ...approvedWritePaths,
    ]);
  }

  function isKnownAttachmentLocation(absolutePath) {
    return typeof store?.isKnownAttachmentLocation === 'function'
      ? store.isKnownAttachmentLocation(absolutePath)
      : false;
  }

  function isKnownAttachmentDirectory(directoryPath) {
    return typeof store?.isKnownAttachmentDirectory === 'function'
      ? store.isKnownAttachmentDirectory(directoryPath)
      : false;
  }

  function resolveForCheck(filePath) {
    const raw = cleanString(filePath);
    // UNC 在 realpath 之前拒绝，避免授权查询/读写检查触发 SMB 探测。
    if (!raw || hasUnsafePathSyntax(raw) || isUncPath(raw)) {
      return null;
    }
    const absolute = path.resolve(raw);
    // realpath 只能用于真实存在的路径；写入目标可能尚未创建，此时沿父目录
    // 向上找到最近一个存在的祖先再拼回后缀，避免 approved\link\newdir\file
    // 这类中间目录不存在时按字面路径放行、随后 mkdir 跟随 junction 写出去。
    const real = safeRealpathSync(absolute);
    if (real) {
      return real;
    }
    const suffix = [path.basename(absolute)];
    let ancestor = path.dirname(absolute);
    while (true) {
      const realAncestor = safeRealpathSync(ancestor);
      if (realAncestor) {
        return path.join(realAncestor, ...suffix);
      }
      const parent = path.dirname(ancestor);
      if (parent === ancestor) {
        return absolute;
      }
      suffix.unshift(path.basename(ancestor));
      ancestor = parent;
    }
  }

  function isReadAllowed(filePath) {
    const absolute = resolveForCheck(filePath);
    if (!absolute || isProtectedMainFile(absolute)) return false;
    if (readRoots().some((root) => isWithinRoot(absolute, root))) return true;
    // 附件本身、以及附件所在目录下的派生文件（MinerU JSON、批注版 PDF）。
    if (isKnownAttachmentLocation(absolute)) return true;
    // 目录列表读取：仅允许包含已知附件的目录。
    return isKnownAttachmentDirectory(absolute);
  }

  function isWriteAllowed(filePath) {
    const absolute = resolveForCheck(filePath);
    if (!absolute || isProtectedMainFile(absolute)) return false;
    if (writeRoots().some((root) => isWithinRoot(absolute, root))) return true;
    const extension = path.extname(absolute).toLowerCase();
    if (
      WRITABLE_EXTENSIONS_IN_ATTACHMENT_DIRS.has(extension) &&
      (
        isKnownAttachmentDirectory(path.dirname(absolute)) ||
        approvedSiblingPdfWriteDirs.has(comparablePath(path.dirname(absolute)))
      )
    ) {
      return true;
    }
    return false;
  }

  function assertReadAllowed(filePath) {
    if (!isReadAllowed(filePath)) {
      throw new Error(`Reading this path is not allowed: ${cleanString(filePath) || '(empty)'}`);
    }
  }

  function assertWriteAllowed(filePath) {
    if (!isWriteAllowed(filePath)) {
      throw new Error(`Writing to this path is not allowed: ${cleanString(filePath) || '(empty)'}`);
    }
  }

  /** 只读查询：路径是否位于渲染层可见的对话框授权记录内。 */
  function isApprovedPath(filePath, mode = 'write') {
    const absolute = resolveForCheck(filePath);
    if (!absolute) return false;
    const approvedPaths = mode === 'read' ? approvedReadPaths : approvedWritePaths;
    for (const root of approvedPaths) {
      if (isWithinRoot(absolute, root)) return true;
    }
    return false;
  }

  /**
   * 只读授权状态（不授予任何权限）：
   *   - default：应用默认路径（主进程决定，始终可用）；
   *   - dialog-approved：目录对话框授权（持久化或本会话）；
   *   - configured：位于主进程信任根（如 dataDir）内的配置路径；
   *   - missing-approval：已配置但没有任何授权记录，需要用户重新选择；
   *   - missing：未配置；
   *   - unsafe：空路径或设备/ADS 等不安全语法。
   */
  function getAuthorizationStatus(filePath, {
    mode = 'write',
    defaultPaths = [],
    trustedRoots = [],
  } = {}) {
    const raw = cleanString(filePath);
    if (!raw) {
      return { path: '', exists: false, authorized: false, reason: AUTHORIZATION_REASONS.MISSING };
    }

    const absolute = resolveForCheck(raw);
    if (!absolute) {
      return {
        path: raw,
        exists: false,
        authorized: false,
        reason: AUTHORIZATION_REASONS.UNSAFE,
      };
    }

    // 默认 MinerU 缓存根始终可用，调用方不必重复传入。
    const builtinDefaults = appPaths.mineruCacheDir ? [appPaths.mineruCacheDir] : [];
    const isDefault = [...builtinDefaults, ...expandRoots(defaultPaths)]
      .some((root) => isWithinRoot(absolute, root));
    const isApproved = isApprovedPath(absolute, mode);
    const isTrusted = expandRoots(trustedRoots).some((root) => isWithinRoot(absolute, root));
    // 已登记附件所在目录/文件按既有策略可读写（批注版与译版 PDF 的落点）。
    // 状态必须反映这一点，否则会出现「报 missing-approval、实际可读写」的矛盾。
    // 写模式下必须探测写权限：只读祖先授权不应把未授权的目录报成可写。
    const isAttachmentKnown = !(isDefault || isApproved || isTrusted)
      && (mode === 'write'
        ? isWriteAllowed(absolute) || isWriteAllowed(path.join(absolute, 'probe.pdf'))
        : isReadAllowed(raw));
    const authorized = isDefault || isApproved || isTrusted || isAttachmentKnown;
    const reason = isDefault
      ? AUTHORIZATION_REASONS.DEFAULT
      : isApproved
        ? AUTHORIZATION_REASONS.DIALOG_APPROVED
        : isTrusted
          ? AUTHORIZATION_REASONS.CONFIGURED
          : isAttachmentKnown
            ? AUTHORIZATION_REASONS.KNOWN_ATTACHMENT
            : AUTHORIZATION_REASONS.MISSING_APPROVAL;

    // 未授权路径不返回 realpath：状态命令不能成为渲染层的路径规范化探针。
    return {
      path: authorized ? absolute : path.resolve(raw),
      exists: authorized ? fs.existsSync(absolute) : false,
      authorized,
      reason,
    };
  }

  function isPdfPathAllowed(filePath) {
    const raw = cleanString(filePath);
    if (!raw || path.extname(raw).toLowerCase() !== '.pdf') return false;
    if (isUncPath(raw) || hasUnsafePathSyntax(raw)) return false;
    return isReadAllowed(raw);
  }

  /** 文件对话框返回的选择：文件本身与所在目录都登记为可读。 */
  function approveReadPath(filePath) {
    approveReadPaths([filePath]);
  }

  /**
   * 目录对话框返回的选择：只登记目录自身，不把父目录加入读根。
   * 目录本身已经覆盖其全部子路径；再登记父目录会把同级的整棵树一起放开。
   * 目录读写仍分别由 approveReadDirectory / approveWritePath 决定。
   */
  function approveReadDirectory(directoryPath) {
    const raw = cleanString(directoryPath);
    if (!raw) return;
    const absolute = safeRealpathSync(path.resolve(raw)) ?? path.resolve(raw);
    if (approvedReadPaths.has(absolute)) return;
    approvedReadPaths.add(absolute);
    persistApprovals();
  }

  /** 批量登记，避免 Zotero 列表等场景逐条落盘。 */
  function approveReadPaths(filePaths) {
    let changed = false;

    for (const filePath of Array.isArray(filePaths) ? filePaths : []) {
      const raw = cleanString(filePath);
      if (!raw) continue;
      const absolute = safeRealpathSync(path.resolve(raw)) ?? path.resolve(raw);
      const directory = safeRealpathSync(path.dirname(absolute)) ?? path.dirname(absolute);
      if (!approvedReadPaths.has(absolute)) {
        approvedReadPaths.add(absolute);
        changed = true;
      }
      if (!approvedReadPaths.has(directory)) {
        approvedReadPaths.add(directory);
        changed = true;
      }
      approvedSiblingPdfWriteDirs.add(comparablePath(directory));
    }

    if (changed) persistApprovals();
  }

  function approveWritePath(filePath) {
    const raw = cleanString(filePath);
    if (!raw) return;
    const absolute = path.resolve(raw);
    const resolved = safeRealpathSync(absolute) ?? absolute;
    if (approvedWritePaths.has(resolved)) return;
    approvedWritePaths.add(resolved);
    persistApprovals();
  }

  return {
    approveReadDirectory,
    approveReadPath,
    approveReadPaths,
    approveWritePath,
    assertReadAllowed,
    assertWriteAllowed,
    getAuthorizationStatus,
    isApprovedPath,
    isPdfPathAllowed,
    isReadAllowed,
    isWriteAllowed,
    readRoots,
    writeRoots,
  };
}

module.exports = {
  AUTHORIZATION_REASONS,
  createPathPolicy,
  hasAlternateDataStream,
  hasUnsafePathSyntax,
  hasWindowsDevicePrefix,
  isUncPath,
  isWithinRoot,
};
