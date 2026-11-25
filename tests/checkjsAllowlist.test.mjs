import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkjsConfigPath = path.join(rootDir, 'tsconfig.checkjs.json');
const testsMjsConfigPath = path.join(rootDir, 'tsconfig.tests.mjs.json');
const backlogPath = path.join(rootDir, 'docs', 'typecheck-backlog.md');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const normalize = (file) => file.split(path.sep).join('/');

function walkJsFiles(dir, extension, output = []) {
  if (!fs.existsSync(dir)) return output;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJsFiles(absolute, extension, output);
    else if (entry.name.endsWith(extension)) output.push(normalize(path.relative(rootDir, absolute)));
  }
  return output;
}

// 已确认 0 诊断的基线名单；只允许增加，不允许悄悄移除或挪回 backlog。
const REQUIRED_CHECKJS = [
  'electron/afterPack.cjs',
  'electron/backend/desktopRunMarker.cjs',
  'electron/backend/externalWriteMarker.cjs',
  'electron/backend/externalWriteWatch.cjs',
  'electron/backend/legacyBackupCleanup.cjs',
  'electron/backend/libraryAttachmentAvailability.cjs',
  'electron/backend/libraryRagStatusFilter.cjs',
  'electron/backend/mcpClientConfig.cjs',
  'electron/backend/metadataValidation.cjs',
  'electron/backend/mineruAssetPaths.cjs',
  'electron/backend/mineruContentList.cjs',
  'electron/backend/mineruMerge.cjs',
  'electron/backend/nodeSqlite.cjs',
  'electron/backend/noteVectors.cjs',
  'electron/backend/paperMetadataFields.cjs',
  'electron/backend/pdfAssetGovernance.cjs',
  'electron/backend/pdfSplitter.cjs',
  'electron/backend/ragMembership.cjs',
  'electron/backend/updateCommands.cjs',
  'electron/ipcAllowlist.cjs',
  'electron/ipcSecurity.cjs',
  'electron/mcp/mcpTools.cjs',
  'electron/mcpBundleManifest.cjs',
  'electron/packagingDependencies.cjs',
  'electron/pdfJsAssets.cjs',
  'electron/perfTrace.cjs',
  'electron/preload.cjs',
  'electron/shared/zoteroDomain.cjs',
  'src/shared/mineruCachePaths.cjs',
  'src/shared/zoteroItemMetadata.cjs',
];

const REQUIRED_TESTS_MJS = [
  'tests/appSettingsModuleStructure.test.mjs',
  'tests/axeAudit.test.mjs',
  'tests/checkjsAllowlist.test.mjs',
  'tests/dialogFocusTrap.test.mjs',
  'tests/electronMainIntegration.test.mjs',
  'tests/electronSandboxStructure.test.mjs',
  'tests/initialChunks.test.mjs',
  'tests/lintConfig.test.mjs',
  'tests/libraryRagStatusFilter.test.mjs',
  'tests/literatureToolbarRefresh.test.mjs',
  'tests/packagingDependencies.test.mjs',
  'tests/readerChatInputOverride.test.mjs',
  'tests/readerSettingsHydration.test.mjs',
  'tests/rendererDeadModules.test.mjs',
  'tests/support/electronCdp.mjs',
  'tests/support/installerSmoke.mjs',
  'tests/support/pdfFixtures.mjs',
  'tests/support/perfAudit.mjs',
  'tests/support/windowsDialog.mjs',
  'tests/testTempHygiene.test.mjs',
  'tests/windowMinWidth.test.mjs',
  'tests/workspaceRestore.test.mjs',
];

test('tsconfig.checkjs.json 的 allowlist 文件存在、无重复且未丢失基线', () => {
  const config = readJson(checkjsConfigPath);
  const include = config.include ?? [];
  assert.ok(include.length > 0, 'checkjs allowlist 不能为空');
  assert.equal(new Set(include).size, include.length, 'checkjs allowlist 存在重复项');

  for (const file of include) {
    assert.ok(fs.existsSync(path.join(rootDir, file)), `allowlist 文件不存在：${file}`);
    assert.match(
      file,
      /^(electron\/|bin\/|src\/shared\/).+\.cjs$/,
      `checkjs allowlist 只应包含 electron/bin/src/shared 的 .cjs：${file}`,
    );
  }
  assert.ok(!include.includes('electron/preload.bundle.cjs'), '生成产物不应加入 allowlist');

  for (const file of REQUIRED_CHECKJS) {
    assert.ok(include.includes(file), `checkjs allowlist 丢失基线文件：${file}`);
  }
  assert.equal(config.compilerOptions?.checkJs, true);
  assert.equal(config.compilerOptions?.strict ?? false, false, '保持 strict:false，不引入新的类型断言掩盖');
});

test('tsconfig.tests.mjs.json 的 allowlist 文件存在、无重复且未丢失基线', () => {
  const config = readJson(testsMjsConfigPath);
  const include = config.include ?? [];
  assert.ok(include.length > 0, 'tests mjs allowlist 不能为空');
  assert.equal(new Set(include).size, include.length, 'tests mjs allowlist 存在重复项');

  for (const file of include) {
    assert.ok(fs.existsSync(path.join(rootDir, file)), `allowlist 文件不存在：${file}`);
    assert.match(file, /^tests\/.+\.mjs$/, `tests mjs allowlist 只应包含 tests/*.mjs：${file}`);
  }

  for (const file of REQUIRED_TESTS_MJS) {
    assert.ok(include.includes(file), `tests mjs allowlist 丢失基线文件：${file}`);
  }
  assert.equal(config.compilerOptions?.checkJs, true);
});

test('typecheck-backlog.md 与 allowlist 无漂移，未纳入文件都有记录', () => {
  assert.ok(fs.existsSync(backlogPath), '缺少 docs/typecheck-backlog.md');
  const backlog = fs.readFileSync(backlogPath, 'utf8');
  assert.match(backlog, /日期：\d{4}-\d{2}-\d{2}/);
  assert.match(backlog, /tsconfig\.checkjs\.full\.tmp\.json/);
  assert.match(backlog, /tsconfig\.testsmjs\.full\.tmp\.json/);

  const checkjsInclude = readJson(checkjsConfigPath).include ?? [];
  const testsMjsInclude = readJson(testsMjsConfigPath).include ?? [];

  // 表格记录：`path` | 错误数
  const tableEntries = new Map();
  for (const match of backlog.matchAll(/^\|\s*`([^`]+)`\s*\|\s*(\d+)\s*\|\s*$/gm)) {
    const [, file, countText] = match;
    const count = Number(countText);
    assert.ok(Number.isInteger(count) && count > 0, `backlog 错误数必须是正整数：${file}`);
    assert.ok(fs.existsSync(path.join(rootDir, file)), `backlog 文件不存在：${file}`);
    assert.ok(!checkjsInclude.includes(file), `文件已进入 allowlist，却仍在 backlog 表格：${file}`);
    assert.ok(!testsMjsInclude.includes(file), `文件已进入 allowlist，却仍在 backlog 表格：${file}`);
    tableEntries.set(file, count);
  }
  assert.ok(tableEntries.size > 0, 'backlog 缺少逐文件错误表');

  // 文档中出现过的源码路径（表格 + 代码块）
  const documented = new Set(tableEntries.keys());
  for (const match of backlog.matchAll(/(?:electron|bin|tests)\/[\w./-]+\.(?:cjs|mjs)/g)) {
    documented.add(match[0]);
  }

  const checkjsFiles = [
    ...walkJsFiles(path.join(rootDir, 'electron'), '.cjs'),
    ...walkJsFiles(path.join(rootDir, 'bin'), '.cjs'),
  ].filter((file) => file !== 'electron/preload.bundle.cjs');
  const testsMjsFiles = walkJsFiles(path.join(rootDir, 'tests'), '.mjs');

  for (const file of checkjsFiles) {
    assert.ok(
      checkjsInclude.includes(file) || documented.has(file),
      `electron/bin 文件既不在 allowlist 也没有进入 backlog：${file}`,
    );
  }
  for (const file of testsMjsFiles) {
    assert.ok(
      testsMjsInclude.includes(file) || documented.has(file),
      `tests/*.mjs 既不在 allowlist 也没有进入 backlog：${file}`,
    );
  }
});
