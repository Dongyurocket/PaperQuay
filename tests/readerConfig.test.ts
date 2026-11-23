import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { build } from 'esbuild';

import type { ReaderConfigDependencies } from '../src/services/readerConfig.ts';
import type { AppDefaultPaths } from '../src/services/desktop.ts';

const require = createRequire(import.meta.url);

interface ReaderConfigModule {
  loadReaderConfig: (
    defaultPaths: AppDefaultPaths | null | undefined,
    dependencies: ReaderConfigDependencies,
  ) => Promise<
    | { status: 'loaded'; config: Record<string, unknown> }
    | { status: 'missing' }
    | { status: 'error'; error: Error }
  >;
  resolveReaderConfigForHydration: (options: {
    defaultPaths: AppDefaultPaths;
    legacyConfigPath?: string;
    dependencies?: ReaderConfigDependencies;
  }) => Promise<{
    config: Record<string, unknown> | null;
    persistenceEnabled: boolean;
    error: Error | null;
  }>;
  writeReaderConfigFile: (
    config: Record<string, unknown>,
    defaultPaths: AppDefaultPaths | null | undefined,
    dependencies: ReaderConfigDependencies,
  ) => Promise<void>;
}

// esbuild 在内存里打成 CJS，避免 Node 直接解析 TS 模块里无扩展名的相对导入。
const readerConfig: ReaderConfigModule = await (async () => {
  const result = await build({
    entryPoints: ['src/services/readerConfig.ts'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  });
  const module = { exports: {} as ReaderConfigModule };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(
    require,
    module,
    module.exports,
  );
  return module.exports;
})();

const { loadReaderConfig, resolveReaderConfigForHydration, writeReaderConfigFile } = readerConfig;

class FakeConfigFs {
  files = new Map<string, string>();
  failReadPaths = new Set<string>();
  writeOverride: ((path: string, content: string, files: Map<string, string>) => void) | null = null;

  dependencies: ReaderConfigDependencies = {
    readTextFileIfExists: async (filePath: string) => {
      if (this.failReadPaths.has(filePath)) {
        const error = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
        error.code = 'EACCES';
        throw error;
      }
      return this.files.get(filePath) ?? null;
    },
    writeTextFile: async (filePath: string, content: string) => {
      if (this.writeOverride) {
        this.writeOverride(filePath, content, this.files);
        return;
      }
      this.files.set(filePath, content);
    },
  };
}

function paths(configPath: string): AppDefaultPaths {
  return {
    executableDir: '/app',
    configPath,
    mineruCacheDir: '/cache',
    remotePdfDownloadDir: '/downloads',
  };
}

const CONFIG_WITH_SECRET = JSON.stringify({
  version: 1,
  settings: { uiLanguage: 'en-US' },
  secrets: { qaModelPresets: [{ id: 'default', apiKey: 'sk-secret', model: 'm', baseUrl: 'https://example.test' }] },
}, null, 2);

test('loadReaderConfig distinguishes loaded, missing and corrupt files', async () => {
  const fake = new FakeConfigFs();
  const configPath = '/data/loaded.config.json';
  fake.files.set(configPath, CONFIG_WITH_SECRET);

  const loaded = await loadReaderConfig(paths(configPath), fake.dependencies);
  assert.equal(loaded.status, 'loaded');
  assert.equal(
    (loaded as { config: { secrets?: { qaModelPresets?: Array<{ apiKey: string }> } } })
      .config.secrets?.qaModelPresets?.[0]?.apiKey,
    'sk-secret',
  );

  fake.files.delete(configPath);
  assert.deepEqual(await loadReaderConfig(paths(configPath), fake.dependencies), { status: 'missing' });

  const corruptPath = '/data/corrupt.config.json';
  fake.files.set(corruptPath, '{ not valid json');
  const corrupt = await loadReaderConfig(paths(corruptPath), fake.dependencies);
  assert.equal(corrupt.status, 'error');
  // 读取/解析失败绝不改写原文件。
  assert.equal(fake.files.get(corruptPath), '{ not valid json');

  // 存在但为空/只有空白 = 写入中断，按损坏处理，不能当成首次运行。
  const emptyPath = '/data/empty.config.json';
  fake.files.set(emptyPath, '  \n');
  const empty = await loadReaderConfig(paths(emptyPath), fake.dependencies);
  assert.equal(empty.status, 'error');
  assert.equal(fake.files.get(emptyPath), '  \n');
});

test('hydration disables persistence when the config file cannot be read', async () => {
  const fake = new FakeConfigFs();
  const configPath = '/data/unreadable.config.json';
  const legacyPath = '/app/paperquay-data/paperquay.config.json';
  fake.files.set(configPath, CONFIG_WITH_SECRET);
  fake.failReadPaths.add(configPath);

  const result = await resolveReaderConfigForHydration({
    defaultPaths: paths(configPath),
    legacyConfigPath: legacyPath,
    dependencies: fake.dependencies,
  });

  assert.equal(result.persistenceEnabled, false);
  assert.equal(result.config, null);
  assert.ok(result.error instanceof Error);

  // 文件原样保留，API Key 仍可读。
  const onDisk = JSON.parse(fake.files.get(configPath) ?? '{}');
  assert.equal(onDisk.secrets.qaModelPresets[0].apiKey, 'sk-secret');
});

test('hydration treats parse failures as errors but reads legacy config when primary is missing', async () => {
  const fake = new FakeConfigFs();
  const corruptPath = '/data/broken.config.json';
  fake.files.set(corruptPath, '{"secrets":');

  const corrupt = await resolveReaderConfigForHydration({
    defaultPaths: paths(corruptPath),
    dependencies: fake.dependencies,
  });
  assert.equal(corrupt.persistenceEnabled, false);
  assert.ok(corrupt.error);
  assert.equal(fake.files.get(corruptPath), '{"secrets":');

  const missingPrimary = '/data/missing.config.json';
  const legacyPath = '/app/legacy/paperquay.config.json';
  fake.files.set(legacyPath, CONFIG_WITH_SECRET);
  const legacy = await resolveReaderConfigForHydration({
    defaultPaths: paths(missingPrimary),
    legacyConfigPath: legacyPath,
    dependencies: fake.dependencies,
  });
  assert.equal(legacy.persistenceEnabled, true);
  assert.ok(legacy.config);
});

test('writeReaderConfigFile keeps a single fixed-name backup and verifies the read-back', async () => {
  const fake = new FakeConfigFs();
  const configPath = '/data/write.config.json';
  fake.files.set(configPath, '{"old":true}');

  await writeReaderConfigFile({ version: 2 }, paths(configPath), fake.dependencies);

  const backups = [...fake.files.keys()].filter((key) => key.startsWith(`${configPath}.`) && key.endsWith('.bak'));
  assert.equal(backups.length, 1);
  assert.equal(fake.files.get(backups[0]), '{"old":true}');
  assert.deepEqual(JSON.parse(fake.files.get(configPath) ?? '{}'), { version: 2 });

  // 备份含明文 API Key：多次写入也只保留同一份，不会随启动次数累积。
  await writeReaderConfigFile({ version: 3 }, paths(configPath), fake.dependencies);
  await writeReaderConfigFile({ version: 4 }, paths(configPath), fake.dependencies);
  assert.equal(
    [...fake.files.keys()].filter((key) => key.startsWith(`${configPath}.`) && key.endsWith('.bak')).length,
    1,
  );
  assert.deepEqual(JSON.parse(fake.files.get(configPath) ?? '{}'), { version: 4 });
});

test('writeReaderConfigFile skips the backup when the content is unchanged', async () => {
  const fake = new FakeConfigFs();
  const configPath = '/data/unchanged.config.json';
  fake.files.set(configPath, JSON.stringify({ version: 2 }, null, 2));

  await writeReaderConfigFile({ version: 2 }, paths(configPath), fake.dependencies);

  assert.equal(
    [...fake.files.keys()].filter((key) => key.startsWith(`${configPath}.`) && key.endsWith('.bak')).length,
    0,
  );
});

test('writeReaderConfigFile refuses to overwrite when the read-back does not match', async () => {
  const fake = new FakeConfigFs();
  const configPath = '/data/verify.config.json';
  fake.files.set(configPath, '{"old":true}');
  fake.writeOverride = (filePath, content, files) => {
    // 模拟主配置写入被截断：文件实际内容与新配置不一致（备份写入保持正常）。
    files.set(filePath, filePath === configPath ? content.slice(0, 4) : content);
  };

  await assert.rejects(
    writeReaderConfigFile({ version: 9 }, paths(configPath), fake.dependencies),
    /verification failed/,
  );
  // 原内容仍在备份里。
  const backup = [...fake.files.keys()].find((key) => key.startsWith(`${configPath}.`) && key.endsWith('.bak'));
  assert.ok(backup);
  assert.equal(fake.files.get(backup as string), '{"old":true}');
});
