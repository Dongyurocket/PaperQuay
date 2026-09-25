#!/usr/bin/env node
/**
 * Word 加载项 v2 构建：`office-addin/src/*.ts` → `office-addin/dist/*.js`。
 *
 * 兼容基线是 Word 2016 批量授权版（IE11 内核，只有 ES5）。esbuild 不能直接产出 ES5，
 * 所以分两步：
 *   1. esbuild 以 es2017 目标 bundle（解析 .ts、内联共享真源 src/shared/citation/）；
 *   2. TypeScript 编译器把 bundle 转写为 ES5（downlevelIteration 处理 for-of / 展开）。
 * polyfill（Promise/Map/Set/Array.from/Object.assign/String 方法等）由 office-addin/src/polyfills.ts
 * 从 core-js 按需引入，作为每个入口的第一个 import。
 *
 * 产物入库提交（与 build-citation.mjs 同规则）：`npm test` 的沙箱用例直接加载 dist。
 * 用法：`node scripts/build-office-addin.mjs [--check]`（--check 只校验产物里没有 ES2015+ 语法）
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import ts from 'typescript';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(rootDir, 'office-addin/src');
const distDir = path.join(rootDir, 'office-addin/dist');

/** 入口 → 全局名（IIFE）。sw.js 必须放在站点根目录（Service Worker 作用域）。 */
const entries = [
  { entry: 'taskpane.ts', outfile: path.join(distDir, 'taskpane.js') },
  { entry: 'dialog.ts', outfile: path.join(distDir, 'dialog.js') },
  { entry: 'core.ts', outfile: path.join(distDir, 'core.js'), globalName: 'PaperQuayWord' },
  { entry: 'sw.ts', outfile: path.join(rootDir, 'office-addin/sw.js'), serviceWorker: true },
];

const BANNER = '// 由 scripts/build-office-addin.mjs 生成，请勿手改；源文件：office-addin/src/';

async function bundleEntry({ entry, outfile, globalName, serviceWorker }) {
  const result = await build({
    entryPoints: [path.join(srcDir, entry)],
    bundle: true,
    write: false,
    format: 'iife',
    globalName,
    platform: 'browser',
    // es2017：保留 async/await 交给 TS 降级（esbuild 不能降 generator 到 ES5）。
    target: 'es2017',
    legalComments: 'none',
    charset: 'utf8',
    logLevel: 'silent',
  });
  const es2017 = result.outputFiles[0].text;
  // Service Worker 只在支持它的现代内核里运行，不需要降到 ES5。
  const output = serviceWorker
    ? es2017
    : ts.transpileModule(es2017, {
        // 按 .js 解析，避免把 `a < b > c` 之类的 JS 误读为 TS 泛型。
        fileName: 'bundle.js',
        compilerOptions: {
          target: ts.ScriptTarget.ES5,
          module: ts.ModuleKind.None,
          downlevelIteration: true,
          importHelpers: false,
          allowJs: true,
          removeComments: false,
        },
      }).outputText;
  mkdirSync(path.dirname(outfile), { recursive: true });
  writeFileSync(outfile, `${BANNER}${entry}\n${output}`, 'utf8');
  return outfile;
}

/** 粗检：ES5 产物里不应再出现箭头函数、class、let/const、模板串、展开参数。 */
export function findEs2015Syntax(code) {
  const source = ts.createSourceFile('bundle.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const hits = [];
  const visit = (node) => {
    if (hits.length >= 5) return;
    const kind = node.kind;
    const bad =
      kind === ts.SyntaxKind.ArrowFunction ||
      kind === ts.SyntaxKind.ClassDeclaration ||
      kind === ts.SyntaxKind.ClassExpression ||
      kind === ts.SyntaxKind.TemplateExpression ||
      kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
      kind === ts.SyntaxKind.SpreadElement ||
      kind === ts.SyntaxKind.AwaitExpression ||
      kind === ts.SyntaxKind.YieldExpression ||
      kind === ts.SyntaxKind.ForOfStatement ||
      (kind === ts.SyntaxKind.VariableDeclarationList && (node.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) !== 0);
    if (bad) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      hits.push(`${ts.SyntaxKind[kind]} @ line ${line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  let failed = false;
  for (const target of entries) {
    if (!checkOnly) await bundleEntry(target);
    const relative = path.relative(rootDir, target.outfile).split(path.sep).join('/');
    if (target.serviceWorker) {
      process.stdout.write(`[build-office-addin] ${checkOnly ? 'present' : 'generated'} ${relative}\n`);
      continue;
    }
    const hits = findEs2015Syntax(readFileSync(target.outfile, 'utf8'));
    if (hits.length > 0) {
      failed = true;
      process.stderr.write(`[build-office-addin] ${relative} 含 ES2015+ 语法：${hits.join('; ')}\n`);
    } else {
      process.stdout.write(`[build-office-addin] ${checkOnly ? 'checked' : 'generated'} ${relative} (ES5)\n`);
    }
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
