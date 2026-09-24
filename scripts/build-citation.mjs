#!/usr/bin/env node
/**
 * 把共享引用真源 `src/shared/citation/index.ts` bundle 成两份产物：
 *
 *   1. `electron/generated/citationFormatters.cjs` —— 供 Electron 主进程（CJS）require，
 *      例如 `electron/backend/noteVault.cjs` 的参考文献序列化、本地桥 `officeBridge.cjs`。
 *   2. `office-addin/dist/citation-shared.js` —— 供 Word 加载项（浏览器环境）以
 *      `<script src="...">` 引入的 IIFE，全局名 `PaperQuayCitation`。
 *
 * 产物入库提交：保证 `npm test` 与开发态「克隆即可用」，`npm run build` 会重新生成。
 * 用法：`node scripts/build-citation.mjs [--main-only|--addin-only]`
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entryPoint = path.join(rootDir, 'src/shared/citation/index.ts');

const skipMain = process.argv.includes('--addin-only');
const skipAddin = process.argv.includes('--main-only');

const targets = [
  {
    enabled: !skipMain,
    outfile: path.join(rootDir, 'electron/generated/citationFormatters.cjs'),
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    banner: '// 由 scripts/build-citation.mjs 生成，请勿手改；源文件：src/shared/citation/index.ts',
  },
  {
    enabled: !skipAddin,
    outfile: path.join(rootDir, 'office-addin/dist/citation-shared.js'),
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    globalName: 'PaperQuayCitation',
    banner: '// 由 scripts/build-citation.mjs 生成，请勿手改；源文件：src/shared/citation/index.ts',
  },
].filter((target) => target.enabled);

for (const target of targets) {
  mkdirSync(path.dirname(target.outfile), { recursive: true });
  await build({
    entryPoints: [entryPoint],
    outfile: target.outfile,
    bundle: true,
    format: target.format,
    platform: target.platform,
    target: target.target,
    globalName: target.globalName,
    legalComments: 'none',
    banner: { js: target.banner },
  });
  const relative = path.relative(rootDir, target.outfile).split(path.sep).join('/');
  process.stdout.write(`[build-citation] generated ${relative}\n`);
}
