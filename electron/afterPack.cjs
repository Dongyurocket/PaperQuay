const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Arch } = require('builder-util');
const asar = require('@electron/asar');
const { FuseV1Options, FuseVersion, getCurrentFuseWire } = require('@electron/fuses');
const { FuseState } = require('@electron/fuses/dist/constants');
const { NtExecutable, NtExecutableResource } = require('resedit');
const { assertPdfJsAssets, assertPdfJsRuntime } = require('./pdfJsAssets.cjs');
const { auditPackagingDependencies } = require('./packagingDependencies.cjs');
const { auditMcpBundle } = require('./mcpBundleManifest.cjs');

const execFileAsync = promisify(execFile);

function sqliteVecPlatformPackage(electronPlatformName, arch) {
  const archName = Arch[arch];
  const osName = electronPlatformName === 'win32' ? 'windows' : electronPlatformName;
  const suffix = electronPlatformName === 'win32' ? 'dll' : electronPlatformName === 'darwin' ? 'dylib' : 'so';

  if (!archName || archName === 'universal' || !['windows', 'darwin', 'linux'].includes(osName)) {
    throw new Error(`Unsupported Electron target for sqlite-vec: ${electronPlatformName}-${archName || arch}`);
  }

  // D8-11：sqlite-vec 0.1.9 没有 windows-arm64 原生扩展。显式拒绝并说明原因，
  // 比 afterPack 到打包末尾才报「文件不存在」更早、更可诊断。
  if (osName === 'windows' && archName !== 'x64') {
    throw new Error(
      `Unsupported Windows architecture for sqlite-vec: ${archName}. `
      + 'sqlite-vec 0.1.9 publishes only sqlite-vec-windows-x64; '
      + 'build --x64 or add an in-process vector fallback before enabling Windows arm64.',
    );
  }

  return {
    packageName: `sqlite-vec-${osName}-${archName}`,
    extensionFile: `vec0.${suffix}`,
  };
}

async function assertFile(filePath, label) {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`${label} not found: ${filePath}`);
  }
}

async function run(filePath, args, options = {}) {
  const { stdout, stderr } = await execFileAsync(filePath, args, {
    maxBuffer: 1024 * 1024 * 8,
    ...options,
  });

  if (stdout) {
    process.stdout.write(stdout);
  }

  if (stderr) {
    process.stderr.write(stderr);
  }
}

async function updateWindowsExecutableIcon(context) {
  if (context.electronPlatformName !== 'win32') {
    return;
  }

  const projectDir = context.packager.projectDir;
  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  const iconPath = path.join(projectDir, 'public', 'icon.ico');
  const rceditPath = path.join(projectDir, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');

  await assertFile(exePath, 'Windows executable');
  await assertFile(iconPath, 'Windows icon');
  await assertFile(rceditPath, 'rcedit executable');

  await run(rceditPath, [exePath, '--set-icon', iconPath], {
    windowsHide: true,
  });

  console.log(`[afterPack] updated Windows executable icon: ${exeName}`);
}

async function adHocSignMacApp(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  if (process.platform !== 'darwin') {
    throw new Error('macOS app signing must run on a macOS build host.');
  }

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);

  await assertFile(appPath, 'macOS app bundle');

  try {
    await run('codesign', ['--remove-signature', appPath]);
  } catch (error) {
    console.warn(`[afterPack] no removable macOS signature found for ${appName}: ${error.message}`);
  }

  await run('codesign', ['--force', '--deep', '--sign', '-', appPath]);
  await run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);

  console.log(`[afterPack] ad-hoc signed macOS app bundle: ${appName}`);
}

async function assertMcpSqliteVec(context) {
  const resourcesDir = context.packager.getResourcesDir(context.appOutDir);
  const mcpDir = path.join(resourcesDir, 'paperquay-mcp');
  const { packageName, extensionFile } = sqliteVecPlatformPackage(context.electronPlatformName, context.arch);

  await assertFile(path.join(mcpDir, 'server.cjs'), 'PaperQuay MCP server');
  await assertFile(path.join(mcpDir, 'sql-wasm.wasm'), 'PaperQuay MCP sql.js wasm');
  await assertFile(path.join(mcpDir, 'ragWorker.cjs'), 'PaperQuay MCP rag worker');
  await assertFile(path.join(mcpDir, 'node_modules', 'sqlite-vec', 'package.json'), 'sqlite-vec package');
  await assertFile(path.join(mcpDir, 'node_modules', packageName, extensionFile), 'sqlite-vec native extension');
  console.log(`[afterPack] verified MCP sqlite-vec resources: ${packageName}/${extensionFile}`);
}

async function assertMcpBundle(context) {
  const resourcesDir = context.packager.getResourcesDir(context.appOutDir);
  const mcpDir = path.join(resourcesDir, 'paperquay-mcp');
  const problems = auditMcpBundle({ root: context.packager.projectDir, outDir: mcpDir });
  if (problems.length > 0) {
    throw new Error(`MCP bundle audit failed:\n${problems.join('\n')}`);
  }
  console.log('[afterPack] verified MCP bundle manifest (entry hash, tool count, worker)');
}

async function assertPackagedPdfJsAssets(context) {
  const resourcesDir = context.packager.getResourcesDir(context.appOutDir);
  const sourceRoot = path.join(context.packager.projectDir, 'node_modules', 'pdfjs-dist');
  const counts = await assertPdfJsAssets(resourcesDir, sourceRoot);
  await assertPdfJsRuntime(resourcesDir);
  console.log(
    `[afterPack] verified PDF.js assets: ${Object.entries(counts)
      .map(([dir, count]) => `${dir}=${count}`)
      .join(', ')}; legacy runtime present`,
  );
}

async function assertPackagedRuntimeDependencies(context) {
  const projectDir = context.packager.projectDir;
  const { problems, closure } = auditPackagingDependencies(projectDir);

  if (problems.length > 0) {
    throw new Error(`Packaging dependency audit failed:\n${problems.join('\n')}`);
  }

  // D8-4：不仅检查源码配置，还要在真实 asar/安装目录里确认每个运行时包存在。
  const resourcesDir = context.packager.getResourcesDir(context.appOutDir);
  const asarPath = path.join(resourcesDir, 'app.asar');
  let listing = null;
  try {
    await fs.access(asarPath);
    // @electron/asar 按路径缓存索引；同进程内重建 asar 后必须清缓存再读。
    asar.uncacheAll();
    listing = new Set(
      asar.listPackage(asarPath, { isPack: false }).map((entry) => entry.split(path.sep).join('/').replace(/^\/+/, '')),
    );
  } catch (error) {
    // 损坏的 app.asar 不应阻断打包，但必须留下可诊断的日志：直接静默回退会让
    // 「依赖校验偶然改用 app/」难以排查。错误原文保留，便于定位是头部 pickle
    // 损坏还是文件被占用。
    console.warn(
      `[afterPack] failed to read app.asar (${error?.name || 'Error'}: ${error?.message || error}); `
        + 'falling back to resources/app for the runtime dependency audit.',
    );
    listing = null;
  }

  const missing = [];
  // sandbox preload 只认 electron/preload.bundle.cjs；构建脚本漏跑时必须在这里失败，
  // 不能等到安装后窗口拿不到 window.paperquay 才发现。
  const preloadEntry = 'electron/preload.bundle.cjs';
  if (listing) {
    if (!listing.has(preloadEntry)) missing.push(preloadEntry);
  } else {
    try {
      await fs.access(path.join(resourcesDir, 'app', ...preloadEntry.split('/')));
    } catch {
      missing.push(preloadEntry);
    }
  }

  for (const entry of closure.values()) {
    // electron-builder 会把包内嵌套 node_modules 提升到 app 根（例如
    // pdf-lib/node_modules/pako -> node_modules/pako）。两种布局都接受，
    // 因为 Node 的向上查找在两种位置都能解析到该包。
    const candidates = [entry.path];
    const hoisted = `node_modules/${entry.name}`;
    if (!candidates.includes(hoisted)) candidates.push(hoisted);

    if (listing) {
      if (!candidates.some((candidate) => listing.has(`${candidate}/package.json`))) {
        missing.push(`${entry.path} (or ${hoisted})`);
      }
      continue;
    }

    let found = false;
    for (const candidate of candidates) {
      try {
        await fs.access(path.join(resourcesDir, 'app', ...candidate.split('/'), 'package.json'));
        found = true;
        break;
      } catch {
        // try the next layout
      }
    }
    if (!found) missing.push(`${entry.path} (or ${hoisted})`);
  }

  if (missing.length > 0) {
    throw new Error(`Packaged app is missing runtime dependencies:\n${missing.join('\n')}`);
  }

  console.log(
    `[afterPack] verified ${closure.size} runtime dependency packages in ${listing ? 'app.asar' : 'app/'}`,
  );
}

function electronExecutablePath(context) {
  const productFilename = context.packager.appInfo.productFilename;
  if (context.electronPlatformName === 'darwin') {
    return path.join(context.appOutDir, `${productFilename}.app`);
  }
  if (context.electronPlatformName === 'linux') {
    return path.join(
      context.appOutDir,
      context.packager.executableName || productFilename.toLowerCase(),
    );
  }
  return path.join(context.appOutDir, `${productFilename}.exe`);
}

function resolveElectronFuseConfig(packager) {
  const configured = packager?.config?.electronFuses;
  if (
    configured?.enableEmbeddedAsarIntegrityValidation !== true
    || configured?.onlyLoadAppFromAsar !== true
  ) {
    throw new Error(
      'electronFuses must enable enableEmbeddedAsarIntegrityValidation and onlyLoadAppFromAsar.',
    );
  }

  if (typeof packager.generateFuseConfig === 'function') {
    return packager.generateFuseConfig(configured);
  }

  // 兜底：只显式写入必需的两项，其余 fuse 保持继承默认值。
  return {
    version: FuseVersion.V1,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  };
}

async function assertPackagedElectronFuses(context, { readFuseWire = getCurrentFuseWire } = {}) {
  const fuseConfig = resolveElectronFuseConfig(context.packager);
  if (typeof context.packager.addElectronFuses !== 'function') {
    throw new Error('The packager cannot apply Electron fuses; ASAR integrity cannot be verified.');
  }

  // electron-builder 的 pack 顺序是 emitAfterPack -> sanityCheckPackage ->
  // doAddElectronFuses（app-builder-lib/out/platformPackager.js），afterPack 里
  // 读不到最终 fuse。这里先用构建器同一份配置主动翻转，再读取 exe 的 fuse wire；
  // 构建器随后会用相同配置再写一次同样的字节，结果幂等。
  await context.packager.addElectronFuses(context, fuseConfig);

  const executablePath = electronExecutablePath(context);
  const wire = await readFuseWire(executablePath);
  if (
    wire?.[FuseV1Options.EnableEmbeddedAsarIntegrityValidation] !== FuseState.ENABLE
    || wire?.[FuseV1Options.OnlyLoadAppFromAsar] !== FuseState.ENABLE
  ) {
    throw new Error(
      `Packaged Electron binary is missing the required ASAR integrity fuses: ${executablePath}`,
    );
  }

  console.log(
    '[afterPack] verified Electron fuses: EnableEmbeddedAsarIntegrityValidation + OnlyLoadAppFromAsar',
  );
}

const ASAR_INTEGRITY_RESOURCE_TYPE = 'INTEGRITY';
const ASAR_INTEGRITY_RESOURCE_ID = 'ELECTRONASAR';

function assertAsarIntegrityResourceEntries(entries) {
  const candidates = Array.isArray(entries) ? entries : [];
  const match = candidates.find((entry) => {
    const file = String(entry?.file ?? '').replace(/\\/g, '/');
    // electron-builder 写出的 alg 是大写 "SHA256"；按大小写不敏感匹配。
    const alg = typeof entry?.alg === 'string' ? entry.alg.toLowerCase() : '';
    return (
      /(^|\/)app\.asar$/.test(file)
      && alg === 'sha256'
      && typeof entry?.value === 'string'
      && /^[0-9a-f]{64}$/i.test(entry.value)
    );
  });

  if (!match) {
    throw new Error(
      'ELECTRONASAR resource must describe app.asar with alg=sha256 and a 64-hex hash; '
        + `got ${JSON.stringify(entries)}`,
    );
  }

  return match;
}

async function readElectronAsarIntegrityEntries(executablePath) {
  const buffer = await fs.readFile(executablePath);
  const executable = NtExecutable.from(buffer);
  const resource = NtExecutableResource.from(executable);
  const rawEntries = resource.getResourceEntriesAsString(
    ASAR_INTEGRITY_RESOURCE_TYPE,
    ASAR_INTEGRITY_RESOURCE_ID,
  );
  if (!rawEntries || rawEntries.length === 0) return null;

  const [, payload] = rawEntries[0];
  try {
    return JSON.parse(payload);
  } catch (error) {
    throw new Error(
      `ELECTRONASAR resource is not valid JSON in ${executablePath}: ${error?.message || error}`,
    );
  }
}

async function assertWindowsAsarIntegrityResource(
  context,
  { readEntries = readElectronAsarIntegrityEntries } = {},
) {
  // ELECTRONASAR 是 Windows PE 资源；mac/linux 的完整性载体不同，本机不验证。
  if (context.electronPlatformName !== 'win32') {
    console.log(`[afterPack] skipped ELECTRONASAR resource check on ${context.electronPlatformName}`);
    return;
  }

  const executablePath = electronExecutablePath(context);
  const entries = await readEntries(executablePath);
  assertAsarIntegrityResourceEntries(entries);
  console.log(`[afterPack] verified ELECTRONASAR integrity resource: ${executablePath}`);
}

async function afterPack(context) {
  await updateWindowsExecutableIcon(context);
  // 先翻转 fuse 再校验；ELECTRONASAR 校验放在 rcedit 换图标之后，确认资源未被改写丢。
  await assertPackagedElectronFuses(context);
  await assertWindowsAsarIntegrityResource(context);
  await adHocSignMacApp(context);
  await assertMcpSqliteVec(context);
  await assertMcpBundle(context);
  await assertPackagedPdfJsAssets(context);
  await assertPackagedRuntimeDependencies(context);
}

exports.default = afterPack;
exports.sqliteVecPlatformPackage = sqliteVecPlatformPackage;
exports.assertMcpSqliteVec = assertMcpSqliteVec;
exports.assertMcpBundle = assertMcpBundle;
exports.assertPackagedPdfJsAssets = assertPackagedPdfJsAssets;
exports.assertPackagedRuntimeDependencies = assertPackagedRuntimeDependencies;
exports.assertPackagedElectronFuses = assertPackagedElectronFuses;
exports.assertWindowsAsarIntegrityResource = assertWindowsAsarIntegrityResource;
exports.assertAsarIntegrityResourceEntries = assertAsarIntegrityResourceEntries;
exports.electronExecutablePath = electronExecutablePath;
exports.resolveElectronFuseConfig = resolveElectronFuseConfig;
