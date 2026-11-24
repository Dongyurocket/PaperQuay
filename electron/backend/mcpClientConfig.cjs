const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// node:sqlite 需要 Node.js 22.13+（22.5 起有实验实现，但 22.13 才稳定可用）；
// 测试与构建要求 22.18+（package.json engines）。这里按最低可运行版本判定，
// 过低时由 MCP 启动检查给出明确错误，而不是运行期抛 "No such module"。
const MIN_NODE = [22, 13, 0];

function nodeVersionParts(version) {
  return String(version || '')
    .replace(/^v/, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function nodeSatisfiesSqlite(version) {
  const parts = nodeVersionParts(version);
  for (let index = 0; index < MIN_NODE.length; index += 1) {
    const actual = parts[index] ?? 0;
    if (actual > MIN_NODE[index]) return true;
    if (actual < MIN_NODE[index]) return false;
  }
  return true;
}

function probeSystemNode() {
  try {
    const output = execFileSync('node', ['-p', 'process.versions.node'], {
      encoding: 'utf8',
      timeout: 2000,
      windowsHide: true,
    }).trim();
    return output || null;
  } catch {
    return null;
  }
}

function resolveMcpLayout({ isPackaged, resourcesPath, appPath }) {
  const installedEntry = path.join(resourcesPath || '', 'paperquay-mcp', 'server.cjs');
  const sourceEntry = path.join(appPath || '', 'bin', 'paperquay-mcp.cjs');
  if (isPackaged) {
    return { mode: 'installed', entry: installedEntry };
  }
  if (fs.existsSync(installedEntry) && !fs.existsSync(sourceEntry)) {
    return { mode: 'installed', entry: installedEntry };
  }
  return { mode: 'development', entry: sourceEntry };
}

function quoteToml(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * D3-13：APPIMAGE 与 APPDIR 都是 AppImage 运行时的挂载信号。
 * APPIMAGE 指向稳定的单文件路径；APPDIR 只是 /tmp/.mount_* 临时挂载根。
 * @param {{ env?: Record<string, string | undefined> }} options
 */
function resolveMcpRuntimeMount({ env = {} } = {}) {
  const appImage = typeof env.APPIMAGE === 'string' ? env.APPIMAGE.trim() : '';
  const appDir = typeof env.APPDIR === 'string' ? env.APPDIR.trim() : '';
  if (appImage) return { mounted: true, source: 'APPIMAGE', appImage, appDir };
  if (appDir) return { mounted: true, source: 'APPDIR', appImage: '', appDir };
  return { mounted: false, source: null, appImage: '', appDir: '' };
}

/**
 * 只有打包后的 AppImage（任一挂载信号存在）且有数据目录时才准备稳定运行时目录。
 * @param {{ env?: Record<string, string | undefined>, isPackaged?: boolean, dataDir?: string }} options
 */
function shouldPrepareMcpRuntime({ env = {}, isPackaged = false, dataDir = '' } = {}) {
  return Boolean(isPackaged && dataDir && resolveMcpRuntimeMount({ env }).mounted);
}

/**
 * command 优先使用 APPIMAGE 的稳定路径；只有 APPDIR 时用 APPDIR + 当前可执行文件名；
 * 两者都没有则保持 execPath。
 * @param {{ execPath: string, env?: Record<string, string | undefined> }} options
 */
function resolveInstalledCommand({ execPath, env = {} }) {
  const mount = resolveMcpRuntimeMount({ env });
  if (mount.source === 'APPIMAGE') return mount.appImage;
  if (mount.source === 'APPDIR' && execPath) return path.join(mount.appDir, path.basename(execPath));
  return execPath;
}

/**
 * AppImage 的 resources 目录同样位于 /tmp/.mount_*。把 MCP bundle 复制到
 * 用户数据目录的固定位置，snippet 的 command 与 args 才能在重启后继续有效。
 * 通过 bundle-manifest.json 判断是否需要重新复制。
 * 失败时返回可诊断的 reason（missing-target / missing-source / entry-missing），
 * 调用方据此告警并明确回退到挂载入口，而不是假装稳定。
 * @param {{ resourcesPath?: string, targetDir?: string }} options
 */
function prepareMcpRuntimeDirectory({ resourcesPath, targetDir }) {
  const sourceDir = path.join(resourcesPath || '', 'paperquay-mcp');
  const sourceEntry = path.join(sourceDir, 'server.cjs');
  if (!targetDir) return { prepared: false, entry: sourceEntry, reason: 'missing-target' };
  if (!fs.existsSync(sourceEntry)) return { prepared: false, entry: sourceEntry, reason: 'missing-source' };

  let current = false;
  try {
    current = fs.readFileSync(path.join(sourceDir, 'bundle-manifest.json'), 'utf8')
      === fs.readFileSync(path.join(targetDir, 'bundle-manifest.json'), 'utf8');
  } catch {
    current = false;
  }

  if (!current) {
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.mkdirSync(targetDir, { recursive: true });
    for (const name of fs.readdirSync(sourceDir)) {
      fs.cpSync(path.join(sourceDir, name), path.join(targetDir, name), { recursive: true });
    }
  }

  // manifest 相同不代表文件完整（可能被清理或复制中断）；入口缺失时回退到挂载目录。
  if (!fs.existsSync(path.join(targetDir, 'server.cjs'))) {
    return { prepared: false, entry: sourceEntry, reason: 'entry-missing' };
  }

  return { prepared: true, entry: path.join(targetDir, 'server.cjs') };
}

function buildSnippets({ command, args, env }) {
  const withDataDir = args;
  const proma = {
    servers: {
      paperquay: {
        type: 'stdio',
        command,
        args: withDataDir,
        ...(Object.keys(env).length > 0 ? { env } : {}),
        enabled: true,
      },
    },
  };
  const claude = {
    mcpServers: {
      paperquay: {
        command,
        args: withDataDir,
        ...(Object.keys(env).length > 0 ? { env } : {}),
      },
    },
  };
  const envToml = Object.entries(env)
    .map(([key, value]) => `${key} = ${quoteToml(value)}`)
    .join('\n');
  const codex = [
    '[mcp_servers.paperquay]',
    `command = ${quoteToml(command)}`,
    'args = [',
    ...withDataDir.map((arg) => `  ${quoteToml(arg)},`),
    ']',
    envToml ? `env = { ${Object.entries(env).map(([key, value]) => `${key} = ${quoteToml(value)}`).join(', ')} }` : '',
  ].filter(Boolean).join('\n');

  return {
    proma: JSON.stringify(proma, null, 2),
    claude: JSON.stringify(claude, null, 2),
    codex,
  };
}

function buildMcpClientConfig({
  isPackaged = false,
  execPath = '',
  resourcesPath = '',
  appPath = '',
  dataDir = '',
  nodeVersion = process.versions.node,
  systemNodeVersion = undefined,
  env = process.env,
  installedEntry = '',
  runtimeReason = '',
} = {}) {
  const layout = resolveMcpLayout({ isPackaged, resourcesPath, appPath });
  const stableRuntime = Boolean(isPackaged && installedEntry);
  const resolvedLayout = stableRuntime
    ? { mode: 'installed', entry: installedEntry }
    : layout;
  const installed = resolvedLayout.mode === 'installed';
  const command = installed ? resolveInstalledCommand({ execPath, env }) : 'node';
  const args = dataDir ? [resolvedLayout.entry, '--data-dir', dataDir] : [resolvedLayout.entry];
  const launchEnv = installed ? { ELECTRON_RUN_AS_NODE: '1' } : {};
  const probedSystemNode = systemNodeVersion === undefined ? probeSystemNode() : systemNodeVersion;
  const embeddedNodeOk = nodeSatisfiesSqlite(nodeVersion);
  const systemNodeOk = probedSystemNode ? nodeSatisfiesSqlite(probedSystemNode) : false;

  // D3-13：报告运行时入口的真实来源，避免调用方把挂载路径当成稳定入口。
  // mode 语义：stable=AppImage + 稳定入口；appdir=入口稳定但 command 仍在临时挂载；
  // mount=准备失败、明确回退挂载入口；installed=普通安装包，resources 入口本身稳定；
  // source=开发态源码入口。
  const mount = resolveMcpRuntimeMount({ env });
  const mcpRuntime = { mode: 'stable', prepared: stableRuntime };
  if (stableRuntime) {
    if (mount.source === 'APPDIR') {
      mcpRuntime.mode = 'appdir';
      mcpRuntime.warning = 'APPDIR is a temporary AppImage mount, so command still points into the mount directory. Set APPIMAGE so the generated MCP config points at the stable AppImage file.';
    }
  } else if (isPackaged && mount.mounted) {
    mcpRuntime.mode = 'mount';
    mcpRuntime.reason = runtimeReason || 'runtime-not-prepared';
    mcpRuntime.warning = `stable MCP runtime was not prepared (${mcpRuntime.reason}); the config uses the temporary AppImage mount entry and will stop working after the AppImage is remounted.`;
  } else if (isPackaged) {
    // 普通安装包（deb/nsis 等）没有 AppImage 挂载，resources 入口本身稳定，无需准备目录。
    mcpRuntime.mode = 'installed';
    mcpRuntime.prepared = true;
  } else {
    mcpRuntime.mode = 'source';
  }

  return {
    mode: resolvedLayout.mode,
    entry: resolvedLayout.entry,
    entryExists: fs.existsSync(resolvedLayout.entry),
    command,
    args,
    env: launchEnv,
    /* AppImage 下 command 可能来自 APPIMAGE/APPDIR，和 process.execPath 不同。 */
    launchCommand: command,
    dataDir,
    mcpRuntime,
    nodeVersion,
    embeddedNodeSatisfiesSqlite: embeddedNodeOk,
    systemNodeVersion: probedSystemNode,
    systemNodeSatisfiesSqlite: systemNodeOk,
    launchHint: installed
      ? 'Installed launch uses the app Electron binary with ELECTRON_RUN_AS_NODE=1, so a separate Node.js install is not required.'
      : 'Development launch uses system Node. node:sqlite requires Node.js 22.13 or newer.',
    snippets: buildSnippets({ command, args, env: launchEnv }),
  };
}

function createMcpClientConfigCommands({ app, appPaths }) {
  return {
    async mcp_get_client_config() {
      // AppImage（APPIMAGE 或 APPDIR）：把 bundle 固定到用户数据目录，避免 snippet 指向 /tmp/.mount_*。
      let installedEntry = '';
      let runtimeReason = '';
      const isPackaged = Boolean(app?.isPackaged);
      const dataDir = appPaths?.dataDir || '';
      if (shouldPrepareMcpRuntime({ env: process.env, isPackaged, dataDir })) {
        try {
          const prepared = prepareMcpRuntimeDirectory({
            resourcesPath: process.resourcesPath,
            targetDir: path.join(dataDir, 'mcp-runtime'),
          });
          if (prepared.prepared) {
            installedEntry = prepared.entry;
          } else {
            // 复制失败时明确回退到挂载入口，并让调用方看到原因。
            runtimeReason = prepared.reason || 'entry-missing';
            console.warn(
              `[paperquay] MCP runtime was not prepared (${runtimeReason}); falling back to the AppImage mount entry ${prepared.entry}. `
                + 'The generated MCP config will stop working after the AppImage is remounted.',
            );
          }
        } catch (error) {
          runtimeReason = 'prepare-error';
          const fallbackEntry = path.join(process.resourcesPath || '', 'paperquay-mcp', 'server.cjs');
          console.warn(
            `[paperquay] failed to prepare a stable MCP runtime directory (${runtimeReason}); falling back to the AppImage mount entry ${fallbackEntry}. `
              + 'The generated MCP config will stop working after the AppImage is remounted.',
            error,
          );
        }
      }
      return buildMcpClientConfig({
        isPackaged,
        execPath: process.execPath,
        resourcesPath: process.resourcesPath,
        appPath: typeof app?.getAppPath === 'function' ? app.getAppPath() : path.resolve(__dirname, '../..'),
        dataDir,
        nodeVersion: process.versions.node,
        env: process.env,
        installedEntry,
        runtimeReason,
      });
    },
  };
}

module.exports = {
  buildMcpClientConfig,
  createMcpClientConfigCommands,
  nodeSatisfiesSqlite,
  prepareMcpRuntimeDirectory,
  resolveInstalledCommand,
  resolveMcpRuntimeMount,
  shouldPrepareMcpRuntime,
};
