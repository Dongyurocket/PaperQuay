const fs = require('node:fs');
const path = require('node:path');

/**
 * F3：打包依赖归类与白名单校验。
 *
 * 渲染层依赖（React、Tiptap、Cytoscape、KaTeX 等）由 Vite 打进 dist/，不需要作为
 * 生产依赖复制进 asar；只有主进程与 MCP 在运行时 require 的包才必须保留。
 *
 * 本模块只读 package.json，供测试与 afterPack 断言使用：
 * - RUNTIME_DEPENDENCIES 是主进程/MCP 真正 require 的包；
 * - 出现新的运行时 require 而没登记时，测试会失败，避免再次出现
 *   「依赖移入 devDependencies 导致安装版缺模块」的回归。
 */

/** 主进程或 MCP 运行时 require 的第三方包（node: 内置模块除外）。 */
const RUNTIME_DEPENDENCIES = [
  'adm-zip',
  'electron-updater',
  'eventsource-parser',
  'pdf-lib',
  'sql.js',
  'sqlite-vec',
];

/** 这些包只服务于渲染层，Vite 已打包进 dist/，不应出现在 dependencies。 */
const RENDERER_ONLY_DEPENDENCIES = [
  '@tiptap/core',
  '@tiptap/pm',
  '@tiptap/react',
  '@tiptap/starter-kit',
  '@tiptap/suggestion',
  'cytoscape',
  'cytoscape-fcose',
  'katex',
  'lowlight',
  'lucide-react',
  'react',
  'react-dom',
  'react-markdown',
  'rehype-katex',
  'remark-gfm',
  'remark-math',
  'zustand',
];

/** 已移除的未使用依赖：任何位置再次出现都视为回归。 */
const REMOVED_DEPENDENCIES = ['temml'];

const MAIN_PROCESS_DIRS = ['electron', 'bin', 'src/shared'];

/** 无 node: 前缀也可用的内置模块（require('fs') 这类写法）。 */
const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants',
  'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http',
  'http2', 'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 'process',
  'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'timers',
  'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
]);

function listJavaScriptFiles(root, relativeDir) {
  const dirPath = path.join(root, relativeDir);
  if (!fs.existsSync(dirPath)) return [];

  const results = [];
  const stack = [dirPath];

  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        stack.push(full);
      } else if (/\.(cjs|mjs|js)$/.test(entry.name)) {
        results.push(full);
      }
    }
  }

  return results;
}

/** 收集主进程侧代码里 require/import 的第三方包名（不含相对路径与 node: 内置）。 */
function collectRuntimeRequires(root) {
  const packages = new Set();
  const pattern = /(?:require\(\s*['"]([^'"]+)['"]\s*\)|from\s+['"]([^'"]+)['"])/g;

  for (const relativeDir of MAIN_PROCESS_DIRS) {
    for (const filePath of listJavaScriptFiles(root, relativeDir)) {
      const source = fs.readFileSync(filePath, 'utf8');
      for (const match of source.matchAll(pattern)) {
        const specifier = match[1] ?? match[2] ?? '';
        if (!specifier || specifier.startsWith('.') || specifier.startsWith('node:')) continue;
        if (NODE_BUILTINS.has(specifier)) continue;
        const name = specifier.startsWith('@')
          ? specifier.split('/').slice(0, 2).join('/')
          : specifier.split('/')[0];
        packages.add(name);
      }
    }
  }

  return packages;
}

function readPackageJson(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
}

/**
 * 断言依赖归类正确：
 * 1. 运行时包都在 dependencies；
 * 2. 渲染层包都不在 dependencies；
 * 3. 已删除依赖没有回来；
 * 4. 主进程代码里 require 的第三方包都登记在 RUNTIME_DEPENDENCIES；
 * 5. 打包 files 白名单覆盖所有运行时依赖。
 */
function auditPackagingDependencies(root) {
  const packageJson = readPackageJson(root);
  const dependencies = Object.keys(packageJson.dependencies ?? {});
  const problems = [];

  for (const name of RUNTIME_DEPENDENCIES) {
    if (!dependencies.includes(name)) {
      problems.push(`runtime dependency "${name}" must stay in dependencies (main process/MCP require it)`);
    }
  }

  for (const name of RENDERER_ONLY_DEPENDENCIES) {
    if (dependencies.includes(name)) {
      problems.push(`renderer-only dependency "${name}" must move to devDependencies (Vite bundles it into dist/)`);
    }
  }

  for (const name of REMOVED_DEPENDENCIES) {
    const all = { ...packageJson.dependencies, ...packageJson.devDependencies };
    if (name in all) {
      problems.push(`unused dependency "${name}" must not be reinstalled`);
    }
  }

  const requires = collectRuntimeRequires(root);
  const known = new Set(RUNTIME_DEPENDENCIES);
  // electron 由打包器提供；builder-util 只在 afterPack（构建期）使用；
  // esbuild 只在 scripts/bundle-mcp.cjs（构建期）使用。
  const ignored = new Set(['electron', 'builder-util', 'builder-util-runtime', 'esbuild']);
  for (const name of requires) {
    if (known.has(name) || ignored.has(name)) continue;
    problems.push(`main-process code requires "${name}" but it is not registered in RUNTIME_DEPENDENCIES`);
  }

  const files = packageJson.build?.files ?? [];
  for (const name of RUNTIME_DEPENDENCIES) {
    const covered = files.some((pattern) => pattern === `node_modules/${name}/**/*` || pattern.startsWith(`node_modules/${name}/`));
    if (!covered) {
      problems.push(`build.files must include node_modules/${name}/**/* so the packaged app can require it`);
    }
  }

  return { problems, requires, dependencies };
}

module.exports = {
  RUNTIME_DEPENDENCIES,
  RENDERER_ONLY_DEPENDENCIES,
  REMOVED_DEPENDENCIES,
  collectRuntimeRequires,
  auditPackagingDependencies,
};
