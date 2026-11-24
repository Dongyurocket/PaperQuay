const fs = require('node:fs');
const path = require('node:path');

/**
 * F3 / D8-4：打包依赖闭包与 build.files 覆盖校验。
 *
 * 渲染层依赖（React、Tiptap、Cytoscape、KaTeX 等）由 Vite 打进 dist/，不需要作为
 * 生产依赖复制进 asar；只有主进程与 MCP 在运行时 require 的包才必须保留。
 *
 * 旧实现用硬编码白名单 RUNTIME_DEPENDENCIES，无法发现传递依赖（如 pdf-lib 的
 * pako/tslib、electron-updater 的 sax）漏打包。现在：
 * 1. 从 electron/、bin/、src/shared/ 的实际 require 得到运行时根依赖；
 * 2. 按 Node 解析规则（含嵌套 node_modules）展开 dependencies/optionalDependencies
 *    得到传递闭包；
 * 3. 用 build.files 的 glob 逐个验证闭包内每个包都被覆盖；
 * 4. afterPack 再对真实 asar/安装目录断言 package.json 存在。
 */

/**
 * 期望的运行时根依赖清单。实际根由 `collectRuntimeRequires` 扫描代码得出；
 * 二者必须一致（sql.js 没有静态 require，但 MCP bundle 复制其 wasm 资产，
 * 因此保留为显式根）。本清单只用于发现“依赖被误删/误移”这类回归，不是
 * 打包闭包的唯一来源。
 */
const RUNTIME_DEPENDENCIES = Object.freeze([
  'adm-zip',
  'electron-updater',
  'eventsource-parser',
  'pdf-lib',
  'sql.js',
  'sqlite-vec',
]);

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

/** 构建期/打包器提供的包：会在 electron/ 代码里出现，但不需要复制进 asar。 */
const BUILD_ONLY_DEPENDENCIES = new Set([
  '@electron/asar',
  '@electron/fuses',
  'app-builder-lib',
  'builder-util',
  'electron',
  'electron-winstaller',
  'esbuild',
  'resedit',
]);

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
 * 从 fromDir 开始按 Node 规则向上查找 `<dir>/node_modules/<name>/package.json`。
 * fromDir 可以是根目录（顶层依赖）或某个包目录（嵌套依赖）。
 */
function resolvePackageDir(root, fromDir, packageName) {
  const absoluteRoot = path.resolve(root);
  let current = path.resolve(fromDir);
  const segments = packageName.split('/');

  while (true) {
    const candidate = path.join(current, 'node_modules', ...segments);
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return candidate;
    }
    if (current === absoluteRoot || !current.startsWith(absoluteRoot)) return null;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function toPosixRelative(root, absolutePath) {
  return path.relative(root, absolutePath).split(path.sep).join('/');
}

/**
 * 展开依赖闭包。根依赖必须能被解析（缺失记为问题）；optionalDependencies
 * 缺失（例如其它平台的 sqlite-vec 包）静默跳过。
 */
function resolveDependencyClosure(root, roots) {
  /** @type {Map<string, { name: string, version: string, path: string }>} */
  const closure = new Map();
  /** @type {string[]} */
  const problems = [];
  const queue = [...roots].map((name) => ({ name, fromDir: root, optional: false }));

  while (queue.length > 0) {
    const item = queue.shift();
    const packageDir = resolvePackageDir(root, item.fromDir, item.name);
    if (!packageDir) {
      if (!item.optional) {
        problems.push(`runtime dependency "${item.name}" is required but not installed under node_modules`);
      }
      continue;
    }

    const relativePath = toPosixRelative(root, packageDir);
    if (closure.has(relativePath)) continue;

    const packageJson = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
    closure.set(relativePath, {
      name: String(packageJson.name ?? item.name),
      version: String(packageJson.version ?? ''),
      path: relativePath,
    });

    for (const [dependency] of Object.entries(packageJson.dependencies ?? {})) {
      queue.push({ name: dependency, fromDir: packageDir, optional: false });
    }
    for (const [dependency] of Object.entries(packageJson.optionalDependencies ?? {})) {
      queue.push({ name: dependency, fromDir: packageDir, optional: true });
    }
  }

  return { closure, problems };
}

function escapeRegExp(value) {
  return value.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

/**
 * 把 electron-builder 的 build.files glob 转成正则：
 * `**` 跨目录（非末段时匹配 0..n 个目录），`*` 匹配单段内任意字符。
 */
function globToRegExp(pattern) {
  const segments = pattern.split(path.sep).join('/').replace(/^\.\//, '').split('/');
  let source = '^';
  segments.forEach((segment, index) => {
    const isLast = index === segments.length - 1;
    if (segment === '**') {
      source += isLast ? '.*' : '(?:[^/]+/)*';
      return;
    }
    source += escapeRegExp(segment).replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
    if (!isLast) source += '/';
  });
  return new RegExp(`${source}$`);
}

/**
 * build.files 模式是否覆盖整个包目录。
 * 用包内 package.json 作为探针：`node_modules/foo/**` 必须匹配
 * node_modules/foo/package.json；嵌套 node_modules 也按同一规则匹配。
 */
function patternCoversPackage(pattern, packagePath) {
  if (!pattern || pattern.startsWith('!')) return false;
  return globToRegExp(pattern).test(`${packagePath}/package.json`);
}

/**
 * 正/负模式同时生效：包必须被至少一个正向模式覆盖，且不能被任何负向模式命中。
 * （package.json 里的 canvas 排除规则就是真实负模式。）
 */
function packageCoveredByFiles(files, packagePath) {
  const probe = `${packagePath}/package.json`;
  let covered = false;
  for (const pattern of files) {
    if (!pattern) continue;
    if (pattern.startsWith('!')) {
      if (globToRegExp(pattern.slice(1)).test(probe)) return false;
    } else if (globToRegExp(pattern).test(probe)) {
      covered = true;
    }
  }
  return covered;
}

/**
 * 断言依赖归类与打包覆盖正确：
 * 1. 代码里 require 的运行时根依赖都在 dependencies；
 * 2. 渲染层包都不在 dependencies；
 * 3. 已删除依赖没有回来；
 * 4. 根依赖与传递依赖都能在 node_modules 解析；
 * 5. build.files 覆盖闭包内每个包。
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
  // sql.js 没有静态 require：MCP bundle 仍复制 sql-wasm.wasm 作为旧库兼容资产，
  // 所以它继续算作需要随包发布的运行时依赖。
  const roots = [...new Set([
    ...[...requires].filter((name) => !BUILD_ONLY_DEPENDENCIES.has(name)),
    'sql.js',
  ])].sort();

  for (const name of requires) {
    if (BUILD_ONLY_DEPENDENCIES.has(name)) continue;
    if (!dependencies.includes(name)) {
      problems.push(`main-process code requires "${name}" but it is not declared in dependencies`);
    }
  }

  // 反向漂移：期望清单里的包若已不再被 require，应同步清理（sql.js 例外）。
  const scannedRoots = new Set(roots);
  for (const name of RUNTIME_DEPENDENCIES) {
    if (name === 'sql.js') continue;
    if (!scannedRoots.has(name)) {
      problems.push(`RUNTIME_DEPENDENCIES lists "${name}" but no main-process require was found; update the expected list`);
    }
  }

  const { closure, problems: resolutionProblems } = resolveDependencyClosure(root, roots);
  problems.push(...resolutionProblems);

  const files = packageJson.build?.files ?? [];
  for (const entry of closure.values()) {
    if (!packageCoveredByFiles(files, entry.path)) {
      problems.push(
        `build.files must include ${entry.path}/**/* so the packaged app can require "${entry.name}"`,
      );
    }
  }

  return { problems, requires, roots, dependencies, closure };
}

module.exports = {
  RUNTIME_DEPENDENCIES,
  RENDERER_ONLY_DEPENDENCIES,
  REMOVED_DEPENDENCIES,
  BUILD_ONLY_DEPENDENCIES,
  collectRuntimeRequires,
  resolvePackageDir,
  resolveDependencyClosure,
  globToRegExp,
  patternCoversPackage,
  packageCoveredByFiles,
  auditPackagingDependencies,
};
