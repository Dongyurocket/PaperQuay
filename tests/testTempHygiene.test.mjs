import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * F5 守卫：本机 `%TEMP%` 被安全软件锁住时，esbuild 落盘会 `Access is denied`，
 * 所以测试要么 `write: false`（内存构建），要么显式使用仓库内 `.tmp-test/` 并重试。
 *
 * 这条测试锁住「不要新增把产物写进 %TEMP% 的测试」。
 */

const TESTS_DIR = path.resolve('tests');

function testFiles() {
  return readdirSync(TESTS_DIR).filter((name) => /\.test\.(ts|mjs)$/.test(name));
}

test('F5: no test writes esbuild output into the OS temp directory', () => {
  const offenders = [];

  for (const name of testFiles()) {
    const source = readFileSync(path.join(TESTS_DIR, name), 'utf8');
    const usesEsbuild = /from 'esbuild'|require\('esbuild'\)/.test(source);
    if (!usesEsbuild) continue;

    // 允许：write:false 内存构建；或显式写到仓库内 .tmp-test。
    const writesToDisk = /write:\s*true/.test(source);
    const usesRepoScratch = /\.tmp-test/.test(source);
    const writesToTemp = /outfile:[^\n]*(tmpdir\(\)|os\.tmpdir)/.test(source);

    if (writesToDisk || (writesToTemp && !usesRepoScratch)) {
      offenders.push(name);
    }
  }

  assert.deepEqual(offenders, [], `esbuild output must stay in memory or in .tmp-test:\n${offenders.join('\n')}`);
});

test('F5: the repo-local scratch directory is gitignored', () => {
  const gitignore = readFileSync(path.resolve('.gitignore'), 'utf8');

  assert.match(gitignore, /\.tmp-\*/);
});
