#!/usr/bin/env node
/**
 * Office 桥冒烟脚本（不需要打开 Word）。
 *
 * 读取 PaperQuay 写出的发现文件，直接打桥的只读端点，用**真实文献库**验证：
 *   1. `GET /health`：桥在监听、令牌正确、回写的开关状态；
 *   2. `GET /papers`：能否检索到文献；
 *   3. `POST /citations/render`：GB/T 顺序编码制内联与文献表输出是否符合预期。
 *
 * 用法：
 *   node scripts/office-addin-smoke.mjs                 # 自动找发现文件
 *   node scripts/office-addin-smoke.mjs --port 23120 --token <token>
 *   node scripts/office-addin-smoke.mjs --discovery <path>
 *   node scripts/office-addin-smoke.mjs --paper-id <id> --style apa7
 *
 * 退出码：0 通过；2 找不到发现文件；3 桥不可达/鉴权失败；4 文献库为空；5 渲染失败。
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

const DISCOVERY_FILE_NAME = 'paperquay-office-bridge.json';

function parseArgs(argv) {
  const args = { style: '', search: '', paperId: '', port: 0, token: '', discovery: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (current === '--port' && next) { args.port = Number.parseInt(next, 10); index += 1; }
    else if (current === '--token' && next) { args.token = next; index += 1; }
    else if (current === '--discovery' && next) { args.discovery = next; index += 1; }
    else if (current === '--paper-id' && next) { args.paperId = next; index += 1; }
    else if (current === '--style' && next) { args.style = next; index += 1; }
    else if (current === '--search' && next) { args.search = next; index += 1; }
    else if (current === '--help' || current === '-h') { args.help = true; }
  }
  return args;
}

function candidateDiscoveryPaths() {
  const explicit = process.env.PAPERQUAY_OFFICE_DISCOVERY;
  const appData = process.env.APPDATA;
  const configHome = process.env.XDG_CONFIG_HOME;
  const list = [];
  if (explicit) list.push(explicit);
  if (platform() === 'win32') {
    if (appData) list.push(join(appData, 'PaperQuay', DISCOVERY_FILE_NAME));
    list.push(join(homedir(), 'AppData', 'Roaming', 'PaperQuay', DISCOVERY_FILE_NAME));
  } else if (platform() === 'darwin') {
    list.push(join(homedir(), 'Library', 'Application Support', 'PaperQuay', DISCOVERY_FILE_NAME));
  } else {
    list.push(join(configHome || join(homedir(), '.config'), 'PaperQuay', DISCOVERY_FILE_NAME));
  }
  return [...new Set(list)];
}

function readDiscovery(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  const port = Number.parseInt(String(parsed?.port ?? ''), 10);
  const token = typeof parsed?.token === 'string' ? parsed.token : '';
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`发现文件缺少有效 port：${filePath}`);
  }
  return { port, token, apiVersion: parsed?.apiVersion, appVersion: parsed?.appVersion, pid: parsed?.pid };
}

async function request(base, path, { token, method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  return { status: response.status, payload };
}

function fail(code, message) {
  console.error(`✗ ${message}`);
  process.exit(code);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log('用法：node scripts/office-addin-smoke.mjs [--port N] [--token T] [--discovery PATH] [--paper-id ID] [--style gbt7714|apa7|ieee] [--search 关键词]');
  process.exit(0);
}

let connection = null;
if (args.port > 0) {
  connection = { port: args.port, token: args.token, source: '命令参数' };
} else {
  for (const candidate of candidateDiscoveryPaths()) {
    if (candidate && existsSync(candidate)) {
      try {
        connection = { ...readDiscovery(candidate), source: candidate };
        break;
      } catch (error) {
        fail(2, `发现文件不可用：${candidate}（${error.message}）`);
      }
    }
  }
}

if (!connection) {
  fail(
    2,
    `没找到发现文件 ${DISCOVERY_FILE_NAME}。请先在 PaperQuay 设置里「启动桥」，或用 --port/--token 手动指定。\n  查找过：${candidateDiscoveryPaths().join('、')}`,
  );
}

const base = `http://127.0.0.1:${connection.port}`;
console.log(`→ 连接 ${base}（来源：${connection.source}）`);

let health;
try {
  health = await request(base, '/health', { token: connection.token });
} catch (error) {
  fail(3, `桥不可达：${base}（${error.message}）。确认 PaperQuay 正在运行且桥已启动。`);
}
if (health.status !== 200) {
  fail(3, `GET /health 返回 ${health.status}：${JSON.stringify(health.payload)}`);
}
const info = health.payload ?? {};
console.log(`✓ 桥存活：${info.name ?? 'PaperQuay Office Bridge'} v${info.appVersion ?? '?'}（apiVersion ${info.apiVersion ?? '?'}, pid ${info.pid ?? connection.pid ?? '?'}）`);
console.log(`  回写「本文引用过」：${info.capabilities?.writeBack ? '已开启' : '已关闭'}；默认样式：${info.capabilities?.defaultStyle ?? '?'}；可用样式：${(info.capabilities?.styles ?? []).join(', ') || '?'}`);

const search = args.search || '';
const papersResponse = await request(base, `/papers?limit=5${search ? `&search=${encodeURIComponent(search)}` : ''}`, {
  token: connection.token,
});
if (papersResponse.status !== 200) {
  fail(5, `GET /papers 返回 ${papersResponse.status}：${JSON.stringify(papersResponse.payload)}`);
}
const papers = Array.isArray(papersResponse.payload?.papers) ? papersResponse.payload.papers : [];
console.log(`✓ 文献检索：命中 ${papersResponse.payload?.total ?? papers.length} 条，返回 ${papers.length} 条`);
for (const paper of papers) {
  console.log(`  - ${paper.id}  ${paper.year ?? '????'}  ${paper.title ?? '(无标题)'}`);
}
if (papers.length === 0) {
  fail(4, '文献库为空或关键词无命中，无法继续验证渲染。');
}

const style = args.style || info.capabilities?.defaultStyle || 'gbt7714';
const targetIds = args.paperId ? [args.paperId] : papers.slice(0, Math.min(2, papers.length)).map((paper) => paper.id);

const inlineRender = await request(base, '/citations/render', {
  token: connection.token,
  method: 'POST',
  body: { style, items: [{ paperId: targetIds[0] }] },
});
if (inlineRender.status !== 200) {
  fail(5, `POST /citations/render（单组）返回 ${inlineRender.status}：${JSON.stringify(inlineRender.payload)}`);
}
console.log(`✓ 单条引用（${style}）：${inlineRender.payload?.inline ?? '(空)'}`);
for (const entry of inlineRender.payload?.entries ?? []) {
  console.log(`  [${entry.seq}] ${entry.text}`);
}
if ((inlineRender.payload?.missingPaperIds ?? []).length > 0) {
  console.warn(`  ! 文献已不在库中：${inlineRender.payload.missingPaperIds.join(', ')}`);
}

const listRender = await request(base, '/citations/render', {
  token: connection.token,
  method: 'POST',
  body: {
    style,
    groups: [
      targetIds.map((paperId) => ({ paperId })),
      targetIds.length > 1 ? [{ paperId: targetIds[0] }] : [{ paperId: targetIds[targetIds.length - 1], locator: '25' }],
    ],
  },
});
if (listRender.status !== 200) {
  fail(5, `POST /citations/render（全文刷新）返回 ${listRender.status}：${JSON.stringify(listRender.payload)}`);
}
console.log('✓ 全文刷新：');
for (const group of listRender.payload?.groups ?? []) {
  console.log(`  ${group.citeId} → ${group.inline}`);
}
console.log(`✓ 参考文献表${listRender.payload?.bibliographyTitle ? `「${listRender.payload.bibliographyTitle}」` : ''}：`);
for (const line of String(listRender.payload?.bibliography ?? '').split('\n')) {
  if (line) console.log(`  ${line}`);
}
console.log('冒烟通过：桥、检索、编号与文献表输出均可用于 Word 加载项。');
