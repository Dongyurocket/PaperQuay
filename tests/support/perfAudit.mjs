// S1 性能对比：在仓库外临时目录构建审计前基线，用同一 Electron 二进制
// 与同一份夹具数据各跑 3 次，取中位数。运行方式：
//   node tests/support/perfAudit.mjs [--baseline-ref 1283d82]
// 前置：当前工作区已执行 npm run build（dist/ 存在）。
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  launchPaperQuay,
  makeUserDataDir,
} from './electronCdp.mjs';
import { writePdfFixtures } from './pdfFixtures.mjs';

const projectRoot = process.cwd();
const baselineRef = process.argv.includes('--baseline-ref')
  ? process.argv[process.argv.indexOf('--baseline-ref') + 1]
  : '1283d82';
const runsPerVersion = 3;
const extraArgs = ['--no-sandbox', '--disable-gpu'];

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function round(value, digits = 1) {
  return Number(value.toFixed(digits));
}

function stats(values) {
  const numbers = values.filter((value) => Number.isFinite(value));
  if (numbers.length === 0) return { min: null, max: null, stddev: null };
  const mean = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  const variance = numbers.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / numbers.length;
  return {
    min: round(Math.min(...numbers)),
    max: round(Math.max(...numbers)),
    stddev: round(Math.sqrt(variance)),
  };
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(await fs.readFile(filePath));
  return hash.digest('hex');
}

async function hashTree(rootDir) {
  const entries = await fs.readdir(rootDir, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name))
    .sort();
  const hash = crypto.createHash('sha256');
  for (const filePath of files) {
    hash.update(path.relative(rootDir, filePath).replace(/\\/g, '/'));
    hash.update(await fs.readFile(filePath));
  }
  return { sha256: hash.digest('hex'), files: files.length };
}

/** 记录对比双方的前端产物与 preload 哈希，便于复核测量对象。 */
async function buildFingerprint(appRoot) {
  const dist = await hashTree(path.join(appRoot, 'dist')).catch(() => null);
  let preload = null;
  for (const relative of ['electron/preload.bundle.cjs', 'electron/preload.cjs']) {
    const candidate = path.join(appRoot, relative);
    const hash = await hashFile(candidate).catch(() => null);
    if (hash) {
      preload = { path: relative, sha256: hash };
      break;
    }
  }
  return { dist, preload };
}

async function prepareBaseline() {
  // S1 要求基线构建在仓库外；不要使用仓库内的 .tmp-audit。
  const externalRoot = path.resolve(projectRoot, '..', '.tmp-perf');
  await fs.mkdir(externalRoot, { recursive: true });
  const workRoot = await fs.mkdtemp(path.join(externalRoot, 'pq-perf-'));
  const baseDir = path.join(workRoot, 'baseline');
  await fs.mkdir(baseDir, { recursive: true });
  // Windows 的 bsdtar 会把 C:\... 当成远程主机名；归档路径给 git 用绝对路径，
  // 解压时用 workRoot 下的相对文件名。
  const tarPath = path.join(workRoot, 'baseline.tar');
  execFileSync('git', ['-C', projectRoot, 'archive', '--format=tar', `-o${tarPath}`, baselineRef]);
  execFileSync('tar', ['-xf', 'baseline.tar', '-C', 'baseline'], { cwd: workRoot });
  await fs.symlink(path.join(projectRoot, 'node_modules'), path.join(baseDir, 'node_modules'), 'junction');
  const viteBin = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  // 本机安全软件会锁 %TEMP% 与仓库外目录里的 esbuild 临时文件（Access is denied）。
  // 基线构建改用工作区内的临时目录；仍失败时由调用方重试。
  const esbuildTemp = path.join(projectRoot, '.tmp-audit', 'perf-esbuild-tmp');
  await fs.mkdir(esbuildTemp, { recursive: true });
  const env = { ...process.env, TEMP: esbuildTemp, TMP: esbuildTemp, TMPDIR: esbuildTemp };
  execFileSync(process.execPath, [viteBin, 'build'], { cwd: baseDir, stdio: 'inherit', env });
  return { workRoot, baseDir };
}

async function seedUserData(appRoot, workRoot, label) {
  const userDataDir = await makeUserDataDir(`pq-perf-${label}-`);
  const dataDir = path.join(userDataDir, 'PaperQuay');
  const { simplePath } = await writePdfFixtures(dataDir);
  const app = await launchPaperQuay({
    projectRoot: appRoot, appPath: appRoot, userDataDir, port: 9555, extraArgs,
  });
  try {
    await app.waitFor(`document.readyState === 'complete' && Boolean(window.paperquay)`);
    await app.evaluate(`localStorage.setItem('pq.perf', '1'); localStorage.setItem('paperquay-theme-mode', 'light'); true`);
    const imported = await app.evaluate(`window.paperquay.invoke('library_import_pdfs', {
      request: { paths: [${JSON.stringify(simplePath)}], importMode: 'copy' },
    })`);
    if (!Array.isArray(imported) || !imported.some((item) => item.status === 'imported')) {
      throw new Error(`${label}: fixture import failed: ${JSON.stringify(imported)}`);
    }
    await app.waitFor(`Boolean(document.querySelector('[data-paper-row-id]'))`, { timeoutMs: 60_000 });
  } finally {
    await app.stop();
  }
  const seedCopy = path.join(workRoot, `seed-${label}`);
  await fs.cp(userDataDir, seedCopy, { recursive: true });
  await fs.rm(userDataDir, { recursive: true, force: true });
  return seedCopy;
}

async function measureOnce(appRoot, seedCopy, runIndex, label) {
  const userDataDir = await makeUserDataDir(`pq-perf-run-${label}-`);
  await fs.cp(seedCopy, userDataDir, { recursive: true });
  const app = await launchPaperQuay({
    projectRoot: appRoot, appPath: appRoot, userDataDir, port: 9556, extraArgs,
  });
  try {
    await app.waitFor(`document.readyState === 'complete' && Boolean(window.paperquay)`);
    await app.waitFor(`Boolean(document.querySelector('[data-paper-row-id]'))`, { timeoutMs: 90_000 });
    const coldExternalMs = Date.now() - app.startedAt;
    const libraryRendererMs = await app.evaluate(`performance.now()`);
    const mainLog = app.stdout;
    const windowVisible = [...mainLog.matchAll(/\[paperquay:perf\] startup:window-visible: ([\d.]+)ms/g)].at(-1);

    const notesStart = Date.now();
    await app.evaluate(`(() => {
      const el = [...document.querySelectorAll('button')].find((node) => node.getAttribute('aria-label') === '笔记');
      if (!el) throw new Error('notes nav missing');
      el.click();
      return true;
    })()`);
    // 以用户可见的就绪信号计时，避免依赖 dev-only 的 console.debug 转发。
    await app.waitFor(`Boolean(document.querySelector('[aria-label="新建笔记"],[aria-label="New note"]'))`, {
      timeoutMs: 60_000,
      intervalMs: 25,
    });
    const notesOpenMs = Date.now() - notesStart;

    const graphStart = Date.now();
    await app.evaluate(`(() => {
      const el = [...document.querySelectorAll('button')].find((node) => node.getAttribute('aria-label') === '图谱');
      if (!el) throw new Error('graph nav missing');
      el.click();
      return true;
    })()`);
    await app.waitFor(`Boolean(document.querySelector('[aria-label="放大"],[aria-label="Zoom in"]'))`, {
      timeoutMs: 60_000,
      intervalMs: 25,
    });
    const graphOpenMs = Date.now() - graphStart;

    return {
      run: runIndex,
      coldExternalMs,
      windowVisibleMs: windowVisible ? Number(windowVisible[1]) : null,
      libraryRendererMs: round(libraryRendererMs),
      notesOpenMs,
      graphOpenMs,
    };
  } finally {
    await app.stop();
  }
}

function summarizeVersion(label, appRoot, runs, fingerprint) {
  const pick = (key) => runs.map((run) => run[key]).filter((value) => Number.isFinite(value));
  return {
    label,
    appRoot,
    fingerprint,
    runs,
    median: {
      coldExternalMs: round(median(pick('coldExternalMs'))),
      windowVisibleMs: round(median(pick('windowVisibleMs'))),
      libraryRendererMs: round(median(pick('libraryRendererMs'))),
      notesOpenMs: round(median(pick('notesOpenMs'))),
      graphOpenMs: round(median(pick('graphOpenMs'))),
    },
    stats: {
      coldExternalMs: stats(pick('coldExternalMs')),
      windowVisibleMs: stats(pick('windowVisibleMs')),
      libraryRendererMs: stats(pick('libraryRendererMs')),
      notesOpenMs: stats(pick('notesOpenMs')),
      graphOpenMs: stats(pick('graphOpenMs')),
    },
  };
}

async function main() {
  if (!(await fs.stat(path.join(projectRoot, 'dist', 'index.html')).catch(() => null))) {
    throw new Error('dist/index.html missing; run npm run build first');
  }
  const { workRoot, baseDir } = await prepareBaseline();
  // 交替测量（before/after 每轮换序），避免固定先测基线带来的磁盘缓存偏差。
  const seeds = {
    before: await seedUserData(baseDir, workRoot, 'before'),
    after: await seedUserData(projectRoot, workRoot, 'after'),
  };
  const runs = { before: [], after: [] };
  for (let roundIndex = 1; roundIndex <= runsPerVersion; roundIndex += 1) {
    const order = roundIndex % 2 === 1 ? ['before', 'after'] : ['after', 'before'];
    for (const label of order) {
      const appRoot = label === 'before' ? baseDir : projectRoot;
      const result = await measureOnce(appRoot, seeds[label], roundIndex, label);
      console.log(`[perf] ${label} run ${roundIndex}:`, result);
      runs[label].push(result);
    }
  }
  const baseline = summarizeVersion('before', baseDir, runs.before, await buildFingerprint(baseDir));
  const current = summarizeVersion('after', projectRoot, runs.after, await buildFingerprint(projectRoot));
  const results = {
    baselineRef,
    measuredAt: new Date().toISOString(),
    electron: JSON.parse(await fs.readFile(path.join(projectRoot, 'node_modules', 'electron', 'package.json'), 'utf8')).version,
    params: {
      extraArgs,
      runsPerVersion,
      order: 'alternating before/after each round',
      coldExternalEndpoint: 'process spawn → first [data-paper-row-id] visible (100ms poll; includes Electron app ready and backend init)',
      effectiveLaunchFlags: ['--no-sandbox', '--disable-gpu', '--disable-crash-reporter', '--disable-breakpad'],
      windowVisibleEndpoint: 'main-process marker startup:window-visible (app:ready → ready-to-show)',
      libraryRendererEndpoint: 'window.performance.now() when the first library row is present',
      notesOpenEndpoint: 'click 笔记 → [aria-label="新建笔记"] visible (25ms poll)',
      graphOpenEndpoint: 'click 图谱 → [aria-label="放大"] visible (25ms poll)',
    },
    baseline,
    current,
    workRoot,
  };
  const outputPath = path.join(workRoot, 'perf-results.json');
  await fs.writeFile(outputPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(results, null, 2));
  console.log(`[perf] results: ${outputPath}`);
  console.log(`[perf] work root kept for inspection: ${workRoot}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
