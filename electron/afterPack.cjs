const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Arch } = require('builder-util');

const execFileAsync = promisify(execFile);

function sqliteVecPlatformPackage(electronPlatformName, arch) {
  const archName = Arch[arch];
  const osName = electronPlatformName === 'win32' ? 'windows' : electronPlatformName;
  const suffix = electronPlatformName === 'win32' ? 'dll' : electronPlatformName === 'darwin' ? 'dylib' : 'so';

  if (!archName || archName === 'universal' || !['windows', 'darwin', 'linux'].includes(osName)) {
    throw new Error(`Unsupported Electron target for sqlite-vec: ${electronPlatformName}-${archName || arch}`);
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
  await assertFile(path.join(mcpDir, 'node_modules', 'sqlite-vec', 'package.json'), 'sqlite-vec package');
  await assertFile(path.join(mcpDir, 'node_modules', packageName, extensionFile), 'sqlite-vec native extension');
  console.log(`[afterPack] verified MCP sqlite-vec resources: ${packageName}/${extensionFile}`);
}

async function afterPack(context) {
  await updateWindowsExecutableIcon(context);
  await adHocSignMacApp(context);
  await assertMcpSqliteVec(context);
}

exports.default = afterPack;
exports.sqliteVecPlatformPackage = sqliteVecPlatformPackage;
exports.assertMcpSqliteVec = assertMcpSqliteVec;
