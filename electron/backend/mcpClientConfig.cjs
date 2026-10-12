const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const MIN_NODE = [22, 5, 0];

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
  if (isPackaged && fs.existsSync(installedEntry)) {
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
} = {}) {
  const layout = resolveMcpLayout({ isPackaged, resourcesPath, appPath });
  const installed = layout.mode === 'installed';
  const command = installed ? execPath : 'node';
  const args = dataDir ? [layout.entry, '--data-dir', dataDir] : [layout.entry];
  const env = installed ? { ELECTRON_RUN_AS_NODE: '1' } : {};
  const probedSystemNode = systemNodeVersion === undefined ? probeSystemNode() : systemNodeVersion;
  const embeddedNodeOk = nodeSatisfiesSqlite(nodeVersion);
  const systemNodeOk = probedSystemNode ? nodeSatisfiesSqlite(probedSystemNode) : false;

  return {
    mode: layout.mode,
    entry: layout.entry,
    entryExists: fs.existsSync(layout.entry),
    command,
    args,
    env,
    dataDir,
    nodeVersion,
    embeddedNodeSatisfiesSqlite: embeddedNodeOk,
    systemNodeVersion: probedSystemNode,
    systemNodeSatisfiesSqlite: systemNodeOk,
    launchHint: installed
      ? 'Installed launch uses the app Electron binary with ELECTRON_RUN_AS_NODE=1, so a separate Node.js install is not required.'
      : 'Development launch uses system Node. node:sqlite requires Node.js 22.5 or newer.',
    snippets: buildSnippets({ command, args, env, dataDir }),
  };
}

function createMcpClientConfigCommands({ app, appPaths }) {
  return {
    async mcp_get_client_config() {
      return buildMcpClientConfig({
        isPackaged: Boolean(app?.isPackaged),
        execPath: process.execPath,
        resourcesPath: process.resourcesPath,
        appPath: typeof app?.getAppPath === 'function' ? app.getAppPath() : path.resolve(__dirname, '../..'),
        dataDir: appPaths?.dataDir || '',
        nodeVersion: process.versions.node,
      });
    },
  };
}

module.exports = {
  buildMcpClientConfig,
  createMcpClientConfigCommands,
  nodeSatisfiesSqlite,
};
