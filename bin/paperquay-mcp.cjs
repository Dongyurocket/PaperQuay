#!/usr/bin/env node

/**
 * PaperQuay Knowledge Base MCP Server (Stdio)
 *
 * Designed for Proma, Pi, Codex, Claude Code, and any Model Context Protocol compliant agents.
 * Read tools connect read-only to PaperQuay local SQLite databases for fast, conflict-free retrieval.
 * Write tools (import_pdfs, manage_category, set_paper_categories, update_paper, delete_papers)
 * go through the shared library store and are refused while the PaperQuay desktop app is running,
 * unless allowWhileAppRunning: true is passed explicitly.
 *
 * Tool schemas, handlers, and JSON-RPC message handling live in electron/mcp/mcpTools.cjs;
 * this file is only the stdio transport.
 */

const readline = require('node:readline');

// F3：node:sqlite 需要 Node.js 22.13+。版本过低时直接给出可读错误，
// 而不是在第一次查询时抛 "No such built-in module: node:sqlite"。
function assertSupportedNodeVersion() {
  const [major = 0, minor = 0] = String(process.versions.node || '')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
  const supported = major > 22 || (major === 22 && minor >= 13);
  if (supported) return;

  process.stderr.write(
    `PaperQuay MCP requires Node.js 22.13 or newer (node:sqlite). Current version: ${process.versions.node}.\n`
    + 'Install a newer Node.js or point your MCP client at the app-bundled server (ELECTRON_RUN_AS_NODE).\n',
  );
  process.exit(1);
}

// 解析 CLI 参数
function parseArgs() {
  const args = process.argv.slice(2);
  const options = { dataDir: '' };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data-dir' && args[i + 1]) {
      options.dataDir = args[i + 1];
      i++;
    } else if (args[i].startsWith('--data-dir=')) {
      options.dataDir = args[i].slice('--data-dir='.length);
    }
  }

  return options;
}

function main() {
  assertSupportedNodeVersion();

  const { PaperQuayKnowledgeService } = require('../electron/mcp/knowledgeMcpService.cjs');
  const { SERVER_VERSION, handleMessage } = require('../electron/mcp/mcpTools.cjs');

  // ELECTRON_RUN_AS_NODE 模式下本进程的映像名仍是 PaperQuay.exe。改写进程标题让
  // Linux/macOS 的 pgrep -x PaperQuay 不匹配本服务进程（写护栏自误报防护的一环；
  // Windows 映像名不受 process.title 影响，由 detectDesktopAppRunning 按 PID/命令行排除）。
  try {
    process.title = 'paperquay-mcp';
  } catch {
    // 部分平台不支持改写进程标题，忽略。
  }

  const options = parseArgs();
  const service = new PaperQuayKnowledgeService({ dataDir: options.dataDir });

  // 进程级 library store 由服务复用；退出时同步释放，避免 Windows 下留下
  // 库文件句柄（D3-5）。close() 幂等，重复调用安全。
  function closeService() {
    try {
      service.close();
    } catch {}
  }
  process.on('exit', closeService);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    try {
      process.on(signal, () => {
        closeService();
        process.exit(0);
      });
    } catch {}
  }

  function sendJsonRpc(response) {
    process.stdout.write(`${JSON.stringify(response)}\n`);
  }

  function sendResult(id, result) {
    sendJsonRpc({
      jsonrpc: '2.0',
      id,
      result,
    });
  }

  function sendError(id, code, message, data) {
    sendJsonRpc({
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
        ...(data !== undefined ? { data } : {}),
      },
    });
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const json = JSON.parse(trimmed);
      void handleMessage({ service, message: json, sendResult, sendError });
    } catch (parseError) {
      console.error('[PaperQuay MCP] JSON parse error on input line:', parseError.message);
      sendError(null, -32700, 'Parse error');
    }
  });

  rl.on('close', () => {
    console.error('[PaperQuay MCP] Stdio stream closed, shutting down.');
    closeService();
    process.exit(0);
  });

  console.error(`[PaperQuay MCP] Server started (version: ${SERVER_VERSION}, dataDir: ${service.appPaths.dataDir})`);
}

if (require.main === module) {
  main();
}

module.exports = { assertSupportedNodeVersion, parseArgs, main };
