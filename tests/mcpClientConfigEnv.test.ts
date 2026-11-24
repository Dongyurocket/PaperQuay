import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildMcpClientConfig,
  createMcpClientConfigCommands,
  prepareMcpRuntimeDirectory,
  resolveInstalledCommand,
  resolveMcpRuntimeMount,
  shouldPrepareMcpRuntime,
} = require('../electron/backend/mcpClientConfig.cjs');

/**
 * D3-13：AppImage 的 process.execPath 位于 /tmp/.mount_*，不能写进持久化 snippet。
 */
test('AppImage snippets prefer the stable APPIMAGE path', () => {
  const appImage = '/home/me/Applications/PaperQuay.AppImage';
  const stableEntry = '/home/me/.config/PaperQuay/mcp-runtime/server.cjs';
  assert.equal(
    resolveInstalledCommand({ execPath: '/tmp/.mount_PaperXyz/paperquay', env: { APPIMAGE: appImage } }),
    appImage,
  );

  const config = buildMcpClientConfig({
    isPackaged: true,
    execPath: '/tmp/.mount_PaperXyz/paperquay',
    resourcesPath: '/tmp/.mount_PaperXyz/resources',
    appPath: '/tmp/.mount_PaperXyz/resources/app.asar',
    dataDir: '/home/me/.config/PaperQuay',
    env: { APPIMAGE: appImage },
    systemNodeVersion: '22.18.0',
    installedEntry: stableEntry,
  });
  assert.equal(config.command, appImage);
  assert.equal(config.launchCommand, appImage);
  assert.equal(config.entry, stableEntry);
  assert.equal(config.args[0], stableEntry);
  assert.equal(config.mcpRuntime.mode, 'stable');
  assert.equal(config.mcpRuntime.prepared, true);
  assert.equal(config.mcpRuntime.warning, undefined);
  const snippet = JSON.parse(config.snippets.claude);
  assert.equal(snippet.mcpServers.paperquay.command, appImage);
  assert.doesNotMatch(config.snippets.codex, /\.mount_/);
  assert.match(config.snippets.codex, /mcp-runtime/);
});

test('AppImage snippets fall back to APPDIR plus the executable name', () => {
  assert.equal(
    resolveInstalledCommand({ execPath: '/tmp/.mount_PaperXyz/paperquay', env: { APPDIR: '/tmp/.mount_PaperXyz' } }),
    path.join('/tmp/.mount_PaperXyz', 'paperquay'),
  );
  // 没有 APPIMAGE/APPDIR 时保持原行为（普通安装包）。
  assert.equal(resolveInstalledCommand({ execPath: '/opt/PaperQuay/paperquay', env: {} }), '/opt/PaperQuay/paperquay');
});

test('prepareMcpRuntimeDirectory copies the installed bundle once and reuses it', () => {
  const root = path.join(tmpdir(), `paperquay-mcp-runtime-${process.pid}-${Math.random().toString(16).slice(2)}`);
  const resources = path.join(root, 'resources');
  const source = path.join(resources, 'paperquay-mcp');
  const target = path.join(root, 'mcp-runtime');
  try {
    mkdirSync(path.join(source, 'node_modules', 'sqlite-vec'), { recursive: true });
    writeFileSync(path.join(source, 'server.cjs'), "'use strict';\n");
    writeFileSync(path.join(source, 'ragWorker.cjs'), "'use strict';\n");
    writeFileSync(path.join(source, 'bundle-manifest.json'), '{"schemaVersion":1}\n');
    writeFileSync(path.join(source, 'node_modules', 'sqlite-vec', 'package.json'), '{"name":"sqlite-vec"}\n');

    const first = prepareMcpRuntimeDirectory({ resourcesPath: resources, targetDir: target });
    assert.equal(first.prepared, true);
    assert.equal(first.entry, path.join(target, 'server.cjs'));
    assert.equal(first.reason, undefined);
    assert.equal(existsSync(path.join(target, 'ragWorker.cjs')), true);
    assert.equal(existsSync(path.join(target, 'node_modules', 'sqlite-vec', 'package.json')), true);

    // 第二次调用不应重写目标目录（manifest 相同）。
    writeFileSync(path.join(target, 'server.cjs'), "'use strict';\n// cached\n");
    prepareMcpRuntimeDirectory({ resourcesPath: resources, targetDir: target });
    assert.equal(existsSync(path.join(target, 'ragWorker.cjs')), true);
    assert.match(
      String(require('node:fs').readFileSync(path.join(target, 'server.cjs'))),
      /cached/,
      'an unchanged bundle must not be recopied',
    );

    // manifest 变化时必须重新复制（源新增文件也要出现）。
    writeFileSync(path.join(source, 'bundle-manifest.json'), '{"schemaVersion":2}\n');
    writeFileSync(path.join(source, 'worker-extra.txt'), 'extra\n');
    const recopied = prepareMcpRuntimeDirectory({ resourcesPath: resources, targetDir: target });
    assert.equal(recopied.prepared, true);
    assert.equal(existsSync(path.join(target, 'worker-extra.txt')), true);
    assert.match(
      String(require('node:fs').readFileSync(path.join(target, 'bundle-manifest.json'))),
      /schemaVersion":2/,
    );

    // manifest 相同但入口丢失时回退到挂载目录，不返回不可用的稳定路径。
    rmSync(path.join(target, 'server.cjs'));
    const missingEntry = prepareMcpRuntimeDirectory({ resourcesPath: resources, targetDir: target });
    assert.equal(missingEntry.prepared, false);
    assert.equal(missingEntry.entry, path.join(source, 'server.cjs'));
    assert.equal(missingEntry.reason, 'entry-missing');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('D3-13: mount predicates treat APPIMAGE or APPDIR as an AppImage runtime', () => {
  assert.equal(resolveMcpRuntimeMount({ env: {} }).mounted, false);
  assert.equal(resolveMcpRuntimeMount({ env: {} }).source, null);

  const byAppImage = resolveMcpRuntimeMount({ env: { APPIMAGE: ' /home/me/PaperQuay.AppImage ' } });
  assert.equal(byAppImage.mounted, true);
  assert.equal(byAppImage.source, 'APPIMAGE');
  assert.equal(byAppImage.appImage, '/home/me/PaperQuay.AppImage');
  assert.equal(byAppImage.appDir, '');

  const byAppDir = resolveMcpRuntimeMount({ env: { APPDIR: '/tmp/.mount_PaperXyz' } });
  assert.equal(byAppDir.mounted, true);
  assert.equal(byAppDir.source, 'APPDIR');
  assert.equal(byAppDir.appDir, '/tmp/.mount_PaperXyz');

  assert.equal(shouldPrepareMcpRuntime({ env: {}, isPackaged: true, dataDir: '/data' }), false);
  assert.equal(
    shouldPrepareMcpRuntime({ env: { APPIMAGE: '/home/me/PaperQuay.AppImage' }, isPackaged: true, dataDir: '/data' }),
    true,
  );
  assert.equal(
    shouldPrepareMcpRuntime({ env: { APPDIR: '/tmp/.mount_PaperXyz' }, isPackaged: true, dataDir: '/data' }),
    true,
  );
  // 未打包或没有数据目录时都没有稳定目录可准备。
  assert.equal(
    shouldPrepareMcpRuntime({ env: { APPDIR: '/tmp/.mount_PaperXyz' }, isPackaged: false, dataDir: '/data' }),
    false,
  );
  assert.equal(
    shouldPrepareMcpRuntime({ env: { APPDIR: '/tmp/.mount_PaperXyz' }, isPackaged: true, dataDir: '' }),
    false,
  );
});

test('D3-13: failed preparation reports a reason and the config falls back to the mount entry', () => {
  const root = path.join(tmpdir(), `paperquay-mcp-runtime-fail-${process.pid}-${Math.random().toString(16).slice(2)}`);
  const resources = path.join(root, 'resources');
  try {
    // 源入口缺失：resources/paperquay-mcp/server.cjs 不存在。
    const missingSource = prepareMcpRuntimeDirectory({
      resourcesPath: resources,
      targetDir: path.join(root, 'mcp-runtime'),
    });
    assert.equal(missingSource.prepared, false);
    assert.equal(missingSource.reason, 'missing-source');
    assert.equal(missingSource.entry, path.join(resources, 'paperquay-mcp', 'server.cjs'));

    // 没有目标目录时也不能假装准备成功。
    const missingTarget = prepareMcpRuntimeDirectory({ resourcesPath: resources });
    assert.equal(missingTarget.prepared, false);
    assert.equal(missingTarget.reason, 'missing-target');

    // handler 拿到空 installedEntry 时必须退回挂载入口，并给出可诊断的 mode/warning。
    const mountEntry = path.join(resources, 'paperquay-mcp', 'server.cjs');
    const config = buildMcpClientConfig({
      isPackaged: true,
      execPath: '/tmp/.mount_PaperXyz/paperquay',
      resourcesPath: resources,
      appPath: path.join(resources, 'app.asar'),
      dataDir: path.join(root, 'data'),
      env: { APPIMAGE: '/home/me/PaperQuay.AppImage' },
      systemNodeVersion: '22.18.0',
      installedEntry: '',
      runtimeReason: missingSource.reason,
    });
    assert.equal(config.entry, mountEntry);
    assert.equal(config.args[0], mountEntry);
    assert.equal(config.mcpRuntime.mode, 'mount');
    assert.equal(config.mcpRuntime.prepared, false);
    assert.equal(config.mcpRuntime.reason, 'missing-source');
    assert.ok(config.mcpRuntime.warning, 'mount fallback must explain itself');
    const snippet = JSON.parse(config.snippets.claude);
    assert.equal(snippet.mcpServers.paperquay.args[0], mountEntry);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('D3-13: APPDIR-only prepares the stable runtime and warns about the mount command', () => {
  const root = path.join(tmpdir(), `paperquay-mcp-appdir-${process.pid}-${Math.random().toString(16).slice(2)}`);
  const resources = path.join(root, 'resources');
  const source = path.join(resources, 'paperquay-mcp');
  const target = path.join(root, 'mcp-runtime');
  const appDir = '/tmp/.mount_PaperXyz';
  const execPath = path.join(appDir, 'paperquay');
  try {
    mkdirSync(source, { recursive: true });
    writeFileSync(path.join(source, 'server.cjs'), "'use strict';\n");
    writeFileSync(path.join(source, 'bundle-manifest.json'), '{"schemaVersion":1}\n');

    assert.equal(shouldPrepareMcpRuntime({ env: { APPDIR: appDir }, isPackaged: true, dataDir: root }), true);
    const prepared = prepareMcpRuntimeDirectory({ resourcesPath: resources, targetDir: target });
    assert.equal(prepared.prepared, true);
    assert.equal(prepared.entry, path.join(target, 'server.cjs'));

    const config = buildMcpClientConfig({
      isPackaged: true,
      execPath,
      resourcesPath: resources,
      appPath: path.join(resources, 'app.asar'),
      dataDir: root,
      env: { APPDIR: appDir },
      systemNodeVersion: '22.18.0',
      installedEntry: prepared.entry,
    });
    assert.equal(config.entry, prepared.entry);
    assert.equal(config.args[0], prepared.entry);
    assert.equal(config.command, path.join(appDir, 'paperquay'));
    assert.equal(config.mcpRuntime.mode, 'appdir');
    assert.equal(config.mcpRuntime.prepared, true);
    // command 仍然落在临时挂载目录，必须提示设置 APPIMAGE。
    assert.match(String(config.mcpRuntime.warning), /APPIMAGE/);
    const snippet = JSON.parse(config.snippets.claude);
    assert.equal(snippet.mcpServers.paperquay.command, path.join(appDir, 'paperquay'));
    assert.equal(snippet.mcpServers.paperquay.args[0], prepared.entry);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('D3-13: no AppImage mount keeps the source entry without preparation', () => {
  const root = path.join(tmpdir(), `paperquay-mcp-source-${process.pid}-${Math.random().toString(16).slice(2)}`);
  const resources = path.join(root, 'resources');
  try {
    assert.equal(shouldPrepareMcpRuntime({ env: {}, isPackaged: false, dataDir: root }), false);
    const config = buildMcpClientConfig({
      isPackaged: false,
      execPath: path.join(root, 'electron.exe'),
      resourcesPath: resources,
      appPath: root,
      dataDir: '',
      env: {},
      systemNodeVersion: '22.18.0',
    });
    assert.equal(config.mcpRuntime.mode, 'source');
    assert.equal(config.mcpRuntime.prepared, false);
    assert.equal(config.command, 'node');

    // 普通安装包（deb/nsis 等）没有 AppImage 挂载，resources 入口本身稳定。
    const packaged = buildMcpClientConfig({
      isPackaged: true,
      execPath: '/opt/PaperQuay/paperquay',
      resourcesPath: resources,
      appPath: path.join(resources, 'app.asar'),
      dataDir: '',
      env: {},
      systemNodeVersion: '22.18.0',
    });
    assert.equal(packaged.mcpRuntime.mode, 'installed');
    assert.equal(packaged.mcpRuntime.prepared, true);
    assert.equal(packaged.mcpRuntime.warning, undefined);
    assert.equal(packaged.command, '/opt/PaperQuay/paperquay');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('D3-13: createMcpClientConfigCommands warns when the stable runtime cannot be prepared', async () => {
  const root = path.join(tmpdir(), `paperquay-mcp-warn-${process.pid}-${Math.random().toString(16).slice(2)}`);
  const resources = path.join(root, 'resources');
  const dataDir = path.join(root, 'data');
  const processWithResources = process as unknown as { resourcesPath?: string };
  const previousResourcesPath = checkOwn(processWithResources, 'resourcesPath');
  const previousAppImage = process.env.APPIMAGE;
  const warnings: string[] = [];
  const originalWarn = console.warn;
  try {
    processWithResources.resourcesPath = resources;
    process.env.APPIMAGE = '/home/me/PaperQuay.AppImage';
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((value) => String(value)).join(' '));
    };

    const commands = createMcpClientConfigCommands({
      app: { isPackaged: true, getAppPath: () => path.join(resources, 'app.asar') },
      appPaths: { dataDir },
    });
    const config = await commands.mcp_get_client_config();
    assert.equal(config.mcpRuntime.mode, 'mount');
    assert.equal(config.mcpRuntime.reason, 'missing-source');
    assert.equal(config.entry, path.join(resources, 'paperquay-mcp', 'server.cjs'));
    const warningText = warnings.join('\n');
    assert.match(warningText, /missing-source/);
    assert.match(warningText, /(falling back|mount)/i);
  } finally {
    console.warn = originalWarn;
    restoreOwn(processWithResources, 'resourcesPath', previousResourcesPath);
    if (previousAppImage === undefined) delete process.env.APPIMAGE;
    else process.env.APPIMAGE = previousAppImage;
    rmSync(root, { recursive: true, force: true });
  }
});

test('D3-13: createMcpClientConfigCommands warns when preparation throws', async () => {
  const root = path.join(tmpdir(), `paperquay-mcp-throw-${process.pid}-${Math.random().toString(16).slice(2)}`);
  const resources = path.join(root, 'resources');
  const source = path.join(resources, 'paperquay-mcp');
  // dataDir 是文件而不是目录，mkdir mcp-runtime 时会抛 ENOTDIR/EEXIST。
  const dataFile = path.join(root, 'data-file');
  const processWithResources = process as unknown as { resourcesPath?: string };
  const previousResourcesPath = checkOwn(processWithResources, 'resourcesPath');
  const previousAppImage = process.env.APPIMAGE;
  const warnings: string[] = [];
  const originalWarn = console.warn;
  try {
    mkdirSync(source, { recursive: true });
    writeFileSync(path.join(source, 'server.cjs'), "'use strict';\n");
    writeFileSync(path.join(source, 'bundle-manifest.json'), '{"schemaVersion":1}\n');
    writeFileSync(dataFile, 'not a directory');
    processWithResources.resourcesPath = resources;
    process.env.APPIMAGE = '/home/me/PaperQuay.AppImage';
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((value) => String(value)).join(' '));
    };

    const commands = createMcpClientConfigCommands({
      app: { isPackaged: true, getAppPath: () => path.join(resources, 'app.asar') },
      appPaths: { dataDir: dataFile },
    });
    const config = await commands.mcp_get_client_config();
    assert.equal(config.mcpRuntime.mode, 'mount');
    assert.equal(config.mcpRuntime.reason, 'prepare-error');
    const warningText = warnings.join('\n');
    assert.match(warningText, /prepare-error/);
    assert.match(warningText, /paperquay-mcp[\\/]server\.cjs/);
  } finally {
    console.warn = originalWarn;
    restoreOwn(processWithResources, 'resourcesPath', previousResourcesPath);
    if (previousAppImage === undefined) delete process.env.APPIMAGE;
    else process.env.APPIMAGE = previousAppImage;
    rmSync(root, { recursive: true, force: true });
  }
});

/** 记录 process 自身属性的存在状态，便于测试后恢复。 */
function checkOwn(target: object, key: string): PropertyDescriptor | undefined {
  return Object.getOwnPropertyDescriptor(target, key);
}

function restoreOwn(target: object, key: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) Object.defineProperty(target, key, descriptor);
  else delete (target as Record<string, unknown>)[key];
}
