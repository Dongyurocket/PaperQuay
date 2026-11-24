import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(rootDir, 'eslint.config.js');
const workflowPath = path.join(rootDir, '.github', 'workflows', 'build.yml');

test('ESLint flat config 存在并覆盖 src/electron/scripts/bin/tests', async () => {
  assert.ok(fs.existsSync(configPath), '缺少 eslint.config.js');
  const { default: configs } = await import(pathToFileURL(configPath).href);
  assert.ok(Array.isArray(configs), 'flat config 必须是数组');

  const filesOf = () => configs.flatMap((config) => config.files ?? []);
  const allFiles = filesOf();
  for (const pattern of [
    'src/**/*.{ts,tsx}',
    'electron/**/*.{cjs,mjs,js}',
    'scripts/**/*.{cjs,mjs,js}',
    'bin/**/*.{cjs,mjs,js}',
    'tests/**/*.{ts,tsx,mjs,cjs}',
  ]) {
    assert.ok(allFiles.includes(pattern), `缺少 files 覆盖：${pattern}`);
  }

  const ignores = configs.flatMap((config) => config.ignores ?? []);
  for (const pattern of [
    'node_modules/**',
    'dist/**',
    'release/**',
    'packaging/**',
    'docs/**',
    'assets/**',
    '.verification-*/**',
    '.codex-temp/**',
  ]) {
    assert.ok(ignores.includes(pattern), `缺少忽略规则：${pattern}`);
  }
  // 不能整目录忽略源码来掩盖问题
  for (const dir of ['src', 'electron', 'tests', 'scripts', 'bin']) {
    assert.ok(
      !ignores.some((pattern) => pattern === `${dir}/**` || pattern === `${dir}/`),
      `不能整目录忽略 ${dir}/`,
    );
  }
});

test('ESLint 规则集包含约定项与忽略参数约定', async () => {
  const { default: configs } = await import(pathToFileURL(configPath).href);
  const ruleEntries = configs.flatMap((config) =>
    config.rules ? Object.entries(config.rules) : [],
  );
  const hasRule = (name) => ruleEntries.some(([rule]) => rule === name);

  for (const rule of [
    'no-unused-vars',
    '@typescript-eslint/no-unused-vars',
    'no-undef',
    'no-unreachable',
    'no-constant-condition',
    'no-dupe-keys',
    'no-fallthrough',
    'react-hooks/rules-of-hooks',
    'react-hooks/exhaustive-deps',
  ]) {
    assert.ok(hasRule(rule), `缺少规则：${rule}`);
  }

  const severityOf = (name) => {
    const values = ruleEntries.filter(([rule]) => rule === name).map(([, value]) => value);
    assert.ok(values.length > 0, `规则 ${name} 未配置`);
    return values[values.length - 1];
  };
  assert.equal(severityOf('react-hooks/rules-of-hooks'), 'error');
  // exhaustive-deps 允许通过数组形式配置
  assert.equal(severityOf('react-hooks/exhaustive-deps'), 'warn');
  // JS/CJS 保持 no-undef=error；TS 文件由编译器负责，显式关闭
  assert.ok(
    ruleEntries.some(([rule, value]) => rule === 'no-undef' && value === 'error'),
    'JS/CJS 需要 no-undef=error',
  );
  assert.ok(
    ruleEntries.some(([rule, value]) => rule === 'no-undef' && value === 'off'),
    'TS 文件需要关闭 no-undef',
  );

  const unusedVarOptions = ruleEntries
    .filter(([rule]) => rule === 'no-unused-vars' || rule === '@typescript-eslint/no-unused-vars')
    .map(([, value]) => (Array.isArray(value) ? value[1] : null))
    .filter(Boolean);
  assert.ok(
    unusedVarOptions.some(
      (options) =>
        options.argsIgnorePattern === '^_' &&
        options.varsIgnorePattern === '^_' &&
        options.ignoreRestSiblings === true,
    ),
    'no-unused-vars 需忽略下划线前缀并保留 rest 兄弟属性',
  );

  const constantCondition = ruleEntries
    .filter(([rule]) => rule === 'no-constant-condition')
    .map(([, value]) => (Array.isArray(value) ? value[1] : null))
    .filter(Boolean);
  assert.ok(
    constantCondition.some((options) => options.checkLoops === false),
    'no-constant-condition 需关闭 checkLoops',
  );
});

test('package.json 提供 lint 脚本，CI 在 typecheck 前执行 npm run lint', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  // 警告数 ratchet：允许在 eslint . 后带 --max-warnings N，但不允许关闭规则或整目录 ignore。
  assert.match(pkg.scripts?.lint ?? '', /^eslint \.(?: --max-warnings \d+)?$/);
  assert.match(pkg.scripts?.lint ?? '', /--max-warnings \d+/);

  const workflow = fs.readFileSync(workflowPath, 'utf8');
  assert.match(workflow, /-\s+name:\s*Run ESLint\b/);
  const lintIndex = workflow.indexOf('npm run lint');
  const typecheckIndex = workflow.indexOf('npm run typecheck');
  assert.ok(lintIndex >= 0, 'CI 缺少 npm run lint');
  assert.ok(typecheckIndex >= 0, 'CI 缺少 npm run typecheck');
  assert.ok(lintIndex < typecheckIndex, 'ESLint 必须在 typecheck 之前执行');

  // 发布流水线的 verify job 也必须执行 lint，不能只靠 build.yml。
  const releaseWorkflow = fs.readFileSync(
    path.join(rootDir, '.github', 'workflows', 'release.yml'),
    'utf8',
  );
  assert.match(releaseWorkflow, /-\s+name:\s*Run ESLint\b/);
  const releaseLint = releaseWorkflow.indexOf('npm run lint');
  const releaseTypecheck = releaseWorkflow.indexOf('npm run typecheck');
  assert.ok(releaseLint >= 0, 'release.yml 缺少 npm run lint');
  assert.ok(releaseLint < releaseTypecheck, 'release.yml 的 ESLint 必须在 typecheck 之前执行');
});
