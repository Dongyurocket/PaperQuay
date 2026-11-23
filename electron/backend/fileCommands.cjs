const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { BrowserWindow, clipboard, dialog, shell } = require('electron');
const {
  cleanString,
  ensureFile,
  pathExists,
  safeFileName,
  now,
} = require('./utils.cjs');

const MINERU_CACHE_MARKER_FILE = '.paperquay-mineru-cache.json';
const MINERU_OUTPUT_FILE_NAMES = new Set([
  'content_list_v2.json',
  'content_list.json',
  'middle.json',
  'full.md',
]);

function comparablePath(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

const RETRIABLE_WRITE_ERROR_CODES = new Set([
  'EBUSY',
  'EACCES',
  'EPERM',
  'ENOTEMPTY',
  'EMFILE',
  'ENFILE',
]);

function isRetriableWriteError(error) {
  return Boolean(error?.code && RETRIABLE_WRITE_ERROR_CODES.has(error.code));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isSamePath(left, right) {
  return comparablePath(left) === comparablePath(right);
}

function isPathInside(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function directoryExists(directory) {
  try {
    const stat = await fsp.stat(directory);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(filePath) {
  try {
    const stat = await fsp.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function hasMineruCacheArtifact(directory) {
  const artifactNames = [
    'paper_reader_manifest.json',
    'content_list_v2.json',
    'content_list.json',
    'middle.json',
    'full.md',
  ];

  for (const artifactName of artifactNames) {
    if (await fileExists(path.join(directory, artifactName))) {
      return true;
    }
  }

  return (
    await directoryExists(path.join(directory, 'translations')) ||
    await directoryExists(path.join(directory, 'summaries'))
  );
}

async function listPaperQuayMineruCacheEntries(rootDir) {
  try {
    const entries = await fsp.readdir(rootDir, { withFileTypes: true });
    const cacheEntries = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const entryPath = path.join(rootDir, entry.name);
      const looksStandard = entry.name.startsWith('document-');

      if (looksStandard || await hasMineruCacheArtifact(entryPath)) {
        cacheEntries.push({ name: entry.name, path: entryPath });
      }
    }

    return cacheEntries;
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return [];
    throw error;
  }
}

async function hasLooseMineruOutputFiles(directory) {
  try {
    const entries = await fsp.readdir(directory, { withFileTypes: true });

    return entries.some((entry) => (
      entry.isFile() && MINERU_OUTPUT_FILE_NAMES.has(entry.name.toLowerCase())
    ));
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return false;
    throw error;
  }
}

function isWithinRoot(absolutePath, root) {
  const comparableAbsolute = comparablePath(absolutePath);
  const comparableRoot = comparablePath(root);
  const rootWithSep = comparableRoot.endsWith(path.sep) ? comparableRoot : `${comparableRoot}${path.sep}`;
  return comparableAbsolute === comparableRoot || comparableAbsolute.startsWith(rootWithSep);
}

function createFileCommands(context) {
  const { appPaths, approvedWritePaths, store } = context;
  const { createPathPolicy } = require('./pathPolicy.cjs');
  // 生产环境由 backend 注入与协议处理器共用的策略；测试可省略，按同样规则自建。
  const pathPolicy = context.pathPolicy ?? createPathPolicy({
    appPaths,
    store,
    approvedReadPaths: context.approvedReadPaths ?? new Set(),
    approvedWritePaths,
  });
  // 测试可注入 shell；运行时使用 Electron 的 shell。
  const shellApi = context.shell ?? shell;
  // 自定义 MinerU 缓存目录由目录对话框授权并持久化；不再直接信任
  // 渲染层可写的配置文件（否则一次 write_text_file 就能把它改成 C:\）。

  async function writeTextFileAtomically(filePath, content) {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    const text = String(content ?? '');
    let lastError = null;

    // Windows 上杀软、云同步或另一个进程短暂持有目标文件时，rename 会抛
    // EPERM/EBUSY/EACCES。缓存写入失败不应该直接丢掉整篇译文，这里做短重试。
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const temporaryPath = `${filePath}.tmp-${process.pid}-${now()}-${attempt}-${Math.random().toString(16).slice(2)}`;

      try {
        await fsp.writeFile(temporaryPath, text, 'utf8');
        await fsp.rename(temporaryPath, filePath);
        return;
      } catch (error) {
        lastError = error;
        await fsp.rm(temporaryPath, { force: true }).catch(() => undefined);

        if (!isRetriableWriteError(error)) {
          break;
        }

        // 只读属性会让 rename 在 Windows 上稳定返回 EPERM，缓存文件可以安全清除。
        await fsp.chmod(filePath, 0o666).catch(() => undefined);
        await delay(40 * (attempt + 1));
      }
    }

    // 原子替换失败但文件本身可写时，退化为直接覆盖；缓存文件不是事务性数据，
    // 保留可用译文比坚持原子性更重要。
    if (isRetriableWriteError(lastError)) {
      try {
        await fsp.writeFile(filePath, text, 'utf8');
        return;
      } catch (error) {
        lastError = error;
      }
    }

    const code = lastError?.code ? `${lastError.code}: ` : '';
    const message = lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown error');
    const wrapped = new Error(`写入文本文件失败: ${filePath}: ${code}${message}`);
    wrapped.code = lastError?.code;
    wrapped.cause = lastError;
    throw wrapped;
  }

  function assertWriteAllowed(filePath) {
    pathPolicy.assertWriteAllowed(filePath);
  }

  /**
   * 「在文件夹中显示」允许的范围：应用数据、文库存储、译版目录、MinerU 缓存、
   * 远程下载目录、已批准的写入路径，以及文库附件（原始/存储路径）所在目录。
   * 只做定位，不执行文件；范围外路径一律拒绝。
   */
  function isRevealAllowed(absolutePath) {
    const library = typeof store?.load === 'function' ? store.load() ?? {} : {};
    const settings = library.settings ?? {};
    const roots = [
      appPaths.dataDir,
      settings.storageDir || (appPaths.dataDir ? path.join(appPaths.dataDir, 'paperquay-data') : ''),
      settings.translatedPdfDir,
      appPaths.mineruCacheDir,
      appPaths.remotePdfDownloadDir,
      ...approvedWritePaths,
    ];

    for (const paper of Array.isArray(library.papers) ? library.papers : []) {
      for (const attachment of Array.isArray(paper?.attachments) ? paper.attachments : []) {
        for (const attachmentPath of [attachment?.originalPath, attachment?.storedPath]) {
          const cleaned = cleanString(attachmentPath);
          if (cleaned) roots.push(path.dirname(path.resolve(cleaned)));
        }
      }
    }

    return roots
      .map((root) => cleanString(root))
      .filter(Boolean)
      .some((root) => isWithinRoot(absolutePath, path.resolve(root)));
  }

  async function selectFiles(properties, filters, event) {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, { properties, filters });
    if (result.canceled) return null;

    // 主进程对话框是用户授权读写的唯一入口：返回的路径与所在目录在这里
    // 登记，渲染层不再持有自行批准任意路径的能力。
    pathPolicy.approveReadPaths(result.filePaths);
    return result.filePaths;
  }

  return {
    async get_app_default_paths() {
      await fsp.mkdir(appPaths.mineruCacheDir, { recursive: true });
      await fsp.mkdir(appPaths.remotePdfDownloadDir, { recursive: true });

      return {
        executableDir: appPaths.dataDir,
        configPath: appPaths.configPath,
        mineruCacheDir: appPaths.mineruCacheDir,
        remotePdfDownloadDir: appPaths.remotePdfDownloadDir,
      };
    },

    async select_pdf_file(_args, event) {
      const paths = await selectFiles(['openFile'], [{ name: 'PDF', extensions: ['pdf'] }], event);
      return paths?.[0] ?? null;
    },

    async select_json_file(_args, event) {
      const paths = await selectFiles(['openFile'], [{ name: 'JSON', extensions: ['json'] }], event);
      return paths?.[0] ?? null;
    },

    async select_attachment_files({ kind }, event) {
      const filters =
        kind === 'image'
          ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'] }]
          : [{ name: 'Attachments', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'txt', 'md', 'json', 'csv', 'yaml', 'yml', 'xml', 'html', 'pdf'] }];
      return (await selectFiles(['openFile', 'multiSelections'], filters, event)) ?? [];
    },

    async capture_system_screenshot() {
      await fsp.mkdir(appPaths.screenshotDir, { recursive: true });
      const outputPath = path.join(appPaths.screenshotDir, `system-screenshot-${now()}.png`);

      if (process.platform !== 'win32') {
        return null;
      }

      const previousImage = clipboard.readImage().toPNG();
      spawn('cmd', ['/C', 'start', '', 'ms-screenclip:'], { windowsHide: true, detached: true });

      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const image = clipboard.readImage();

        if (!image.isEmpty()) {
          const bytes = image.toPNG();
          if (!Buffer.from(bytes).equals(Buffer.from(previousImage))) {
            await fsp.writeFile(outputPath, bytes);
            const stat = await fsp.stat(outputPath);
            return {
              path: outputPath,
              name: path.basename(outputPath),
              mimeType: 'image/png',
              size: stat.size,
            };
          }
        }
      }

      return null;
    },

    async open_external_url({ url }) {
      const trimmed = cleanString(url);
      if (!/^https?:\/\//i.test(trimmed)) {
        throw new Error('Only http and https URLs can be opened');
      }
      await shell.openExternal(trimmed);
    },

    async select_directory({ title }, event) {
      const win = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showOpenDialog(win, { title, properties: ['openDirectory'] });
      if (result.canceled || !result.filePaths[0]) return null;
      const selected = result.filePaths[0];
      // 目录选择通常用于缓存、导出或备份目标：读写都由这次用户选择授权。
      pathPolicy.approveReadPath(selected);
      pathPolicy.approveWritePath(selected);
      return selected;
    },

    async prepare_mineru_cache_dir({ directory, previousDirectory }) {
      const targetDir = cleanString(directory);
      if (!targetDir) throw new Error('MinerU cache directory cannot be empty');

      const resolvedTargetDir = path.resolve(targetDir);
      // 只接受目录对话框返回、或配置中已登记的缓存目录，拒绝渲染层任意指定。
      pathPolicy.assertWriteAllowed(resolvedTargetDir);
      const existedBefore = await directoryExists(resolvedTargetDir);
      await fsp.mkdir(resolvedTargetDir, { recursive: true });
      pathPolicy.assertWriteAllowed(resolvedTargetDir);
      pathPolicy.approveReadPath(resolvedTargetDir);
      pathPolicy.approveWritePath(resolvedTargetDir);

      const looseOutputFilesIgnored = await hasLooseMineruOutputFiles(resolvedTargetDir);
      const previousDir = cleanString(previousDirectory);
      let migratedCount = 0;
      let skippedCount = 0;
      const errors = [];

      if (previousDir) {
        const resolvedPreviousDir = path.resolve(previousDir);

        if (!isSamePath(resolvedPreviousDir, resolvedTargetDir) && await directoryExists(resolvedPreviousDir)) {
          const cacheEntries = await listPaperQuayMineruCacheEntries(resolvedPreviousDir);

          for (const entry of cacheEntries) {
            const resolvedSource = path.resolve(entry.path);

            if (
              isSamePath(resolvedSource, resolvedTargetDir) ||
              isPathInside(resolvedTargetDir, resolvedSource)
            ) {
              skippedCount += 1;
              continue;
            }

            const destination = path.join(resolvedTargetDir, entry.name);

            try {
              if (await directoryExists(destination)) {
                skippedCount += 1;
                continue;
              }

              await fsp.cp(entry.path, destination, {
                recursive: true,
                force: false,
                errorOnExist: false,
              });
              migratedCount += 1;
            } catch (error) {
              errors.push({
                name: entry.name,
                message: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }
      }

      const markerPath = path.join(resolvedTargetDir, MINERU_CACHE_MARKER_FILE);
      const cacheEntries = await listPaperQuayMineruCacheEntries(resolvedTargetDir);
      const marker = {
        version: 1,
        product: 'PaperQuay',
        kind: 'mineru-cache-root',
        updatedAt: new Date().toISOString(),
      };

      await fsp.writeFile(markerPath, JSON.stringify(marker, null, 2), 'utf8');

      return {
        directory: resolvedTargetDir,
        created: !existedBefore,
        markerPath,
        entryCount: cacheEntries.length,
        migratedCount,
        skippedCount,
        looseOutputFilesIgnored,
        errors,
      };
    },

    async list_directory_files({ directory, extensionFilter }) {
      pathPolicy.assertReadAllowed(directory);
      try {
        const entries = await fsp.readdir(directory, { withFileTypes: true });
        const extension = cleanString(extensionFilter).replace(/^\./, '').toLowerCase();
        const output = [];

        for (const entry of entries) {
          if (!entry.isFile()) continue;
          const filePath = path.join(directory, entry.name);
          if (extension && path.extname(filePath).slice(1).toLowerCase() !== extension) continue;
          const stat = await fsp.stat(filePath);
          output.push({ path: filePath, name: entry.name, size: stat.size, modifiedAtMs: stat.mtimeMs });
        }

        return output.sort((left, right) => right.modifiedAtMs - left.modifiedAtMs || left.name.localeCompare(right.name));
      } catch (error) {
        if (error?.code === 'ENOENT') return [];
        throw error;
      }
    },

    async select_save_pdf_path({ suggestedFileName, initialDirectory }, event) {
      const win = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showSaveDialog(win, {
        defaultPath: path.join(initialDirectory || appPaths.remotePdfDownloadDir, safeFileName(suggestedFileName)),
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });

      if (result.canceled || !result.filePath) return null;

      pathPolicy.approveWritePath(result.filePath);
      pathPolicy.approveReadPath(result.filePath);
      return result.filePath;
    },

    async select_save_file_path({ suggestedFileName, initialDirectory, filterName, extensions }, event) {
      const win = BrowserWindow.fromWebContents(event.sender);
      const safeExtensions = Array.isArray(extensions)
        ? extensions.map((ext) => cleanString(ext).replace(/^\./, '')).filter(Boolean)
        : [];
      const result = await dialog.showSaveDialog(win, {
        defaultPath: path.join(initialDirectory || appPaths.remotePdfDownloadDir, safeFileName(suggestedFileName)),
        filters: safeExtensions.length > 0
          ? [{ name: cleanString(filterName) || 'Files', extensions: safeExtensions }]
          : undefined,
      });

      if (result.canceled || !result.filePath) return null;

      pathPolicy.approveWritePath(result.filePath);
      pathPolicy.approveReadPath(result.filePath);
      return result.filePath;
    },

    async path_exists({ path: filePath }) {
      return pathPolicy.isReadAllowed(filePath) ? pathExists(filePath) : false;
    },

    // 批量路径存在性检查：供文献库 MinerU 状态检查等场景单次 IPC 完成，
    // 避免每篇文献多次 IPC 往返形成启动期洪水。
    // 注意：pathExists 是 async 函数，必须等待全部结果后再返回；
    // 直接返回 Promise 数组无法通过 Electron IPC 结构化克隆，
    // 渲染层 invoke 会永久悬挂，调用方界面停留在“检测中”。
    async paths_exist({ paths }) {
      if (!Array.isArray(paths)) {
        throw new Error('paths must be an array of paths');
      }

      return Promise.all(
        paths
          .slice(0, 10000)
          .map((candidate) => (
            typeof candidate === 'string' && candidate && pathPolicy.isReadAllowed(candidate)
              ? pathExists(candidate)
              : false
          )),
      );
    },

    // 在系统文件管理器中定位文件或打开目录；只接受文库相关目录内的路径。
    async reveal_path({ path: targetPath }) {
      const trimmed = cleanString(targetPath);
      if (!trimmed) throw new Error('Path cannot be empty');

      const absolutePath = path.resolve(trimmed);
      if (!isRevealAllowed(absolutePath)) {
        throw new Error(`Revealing this path is not allowed: ${trimmed}`);
      }

      let stat;
      try {
        stat = await fsp.stat(absolutePath);
      } catch (error) {
        if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
          return { ok: false, reason: 'missing' };
        }
        throw error;
      }

      if (stat.isDirectory()) {
        const message = await shellApi.openPath(absolutePath);
        return message
          ? { ok: false, reason: 'error', message }
          : { ok: true, kind: 'directory' };
      }

      shellApi.showItemInFolder(absolutePath);
      return { ok: true, kind: 'file' };
    },

    async read_text_file({ path: filePath }) {
      pathPolicy.assertReadAllowed(filePath);
      await ensureFile(filePath);
      return fsp.readFile(filePath, 'utf8');
    },

    async read_text_file_if_exists({ path: filePath }) {
      pathPolicy.assertReadAllowed(filePath);
      try {
        const stat = await fsp.stat(filePath);
        if (!stat.isFile()) return null;
        return fsp.readFile(filePath, 'utf8');
      } catch (error) {
        if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
        throw error;
      }
    },

    async write_text_file({ path: filePath, content }) {
      assertWriteAllowed(filePath);
      await writeTextFileAtomically(filePath, content);
    },

    async read_binary_file_base64({ path: filePath }) {
      pathPolicy.assertReadAllowed(filePath);
      await ensureFile(filePath);
      return (await fsp.readFile(filePath)).toString('base64');
    },

    async write_binary_file_base64({ path: filePath, contentBase64 }) {
      assertWriteAllowed(filePath);
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      await fsp.writeFile(filePath, Buffer.from(contentBase64, 'base64'));
    },

    async download_remote_file_to_path({ url, path: filePath, headers }) {
      assertWriteAllowed(filePath);
      const trimmedUrl = cleanString(url);
      if (!/^https?:\/\//i.test(trimmedUrl)) {
        throw new Error('Only http and https URLs can be downloaded');
      }
      const response = await fetch(trimmedUrl, { headers: headers ?? undefined });
      if (!response.ok) throw new Error(`Remote download returned HTTP ${response.status}`);

      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      await fsp.writeFile(filePath, Buffer.from(await response.arrayBuffer()));
    },

    library_select_pdf_files(_args, event) {
      return selectFiles(['openFile', 'multiSelections'], [{ name: 'PDF', extensions: ['pdf'] }], event).then((paths) => paths ?? []);
    },
  };
}

module.exports = { createFileCommands };
