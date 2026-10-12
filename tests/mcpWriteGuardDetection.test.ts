import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { detectDesktopAppRunning } = require('../electron/mcp/knowledgeMcpService.cjs');

const SELF_PID = 4100;
const OTHER_MCP_PID = 4200;
const DESKTOP_PID = 4300;

function tasklistCsv(pids) {
  if (pids.length === 0) {
    return 'INFO: No tasks are running which match the specified criteria.\r\n';
  }
  return pids
    .map((pid) => `"PaperQuay.exe","${pid}","Console","1","100,000 K"`)
    .join('\r\n') + '\r\n';
}

// 模拟命令行过滤：命令行含 paperquay-mcp 的进程被 Where-Object 剔除，
// CommandLine 读不到的进程（cross-user）保守保留为桌面端。
function makeExecFileSync({ tasklistPids, mcpPids = [] }) {
  const calls = [];
  const exec = (command, args) => {
    calls.push(command);
    if (command === 'tasklist') {
      return tasklistCsv(tasklistPids);
    }
    if (command === 'powershell') {
      // PowerShell 输出被过滤后剩余的桌面端 PID。
      return tasklistPids
        .filter((pid) => !mcpPids.includes(pid))
        .map((pid) => `${pid}\r\n`)
        .join('');
    }
    throw new Error(`unexpected command: ${command} ${args}`);
  };
  exec.calls = calls;
  return exec;
}

test('win32: only the MCP self process matches PaperQuay.exe and does not trip the guard', () => {
  const exec = makeExecFileSync({ tasklistPids: [SELF_PID] });
  const result = detectDesktopAppRunning({ execFileSync: exec, selfPid: SELF_PID, platform: 'win32' });
  assert.equal(result, false);
  assert.deepEqual(exec.calls, ['tasklist'], 'fast path must not spawn powershell');
});

test('win32: a real desktop process alongside the MCP self process still blocks writes', () => {
  const exec = makeExecFileSync({ tasklistPids: [SELF_PID, DESKTOP_PID] });
  const result = detectDesktopAppRunning({ execFileSync: exec, selfPid: SELF_PID, platform: 'win32' });
  assert.equal(result, true);
  assert.deepEqual(exec.calls, ['tasklist', 'powershell']);
});

test('win32: another MCP client process (paperquay-mcp command line) is not a desktop app', () => {
  const exec = makeExecFileSync({ tasklistPids: [SELF_PID, OTHER_MCP_PID], mcpPids: [OTHER_MCP_PID] });
  const result = detectDesktopAppRunning({ execFileSync: exec, selfPid: SELF_PID, platform: 'win32' });
  assert.equal(result, false);
});

test('win32: no PaperQuay.exe process at all means the desktop app is not running', () => {
  const exec = makeExecFileSync({ tasklistPids: [] });
  const result = detectDesktopAppRunning({ execFileSync: exec, selfPid: SELF_PID, platform: 'win32' });
  assert.equal(result, false);
  assert.deepEqual(exec.calls, ['tasklist']);
});

test('win32: tasklist failure is reported as unknown instead of blocking writes', () => {
  const exec = () => {
    const error = new Error('spawn tasklist ENOENT');
    error.code = 'ENOENT';
    throw error;
  };
  const result = detectDesktopAppRunning({ execFileSync: exec, selfPid: SELF_PID, platform: 'win32' });
  assert.equal(result, null);
});

test('linux: pgrep output containing only the MCP self pid means not running', () => {
  const exec = (command) => {
    assert.equal(command, 'pgrep');
    return `${SELF_PID}\n`;
  };
  const result = detectDesktopAppRunning({ execFileSync: exec, selfPid: SELF_PID, platform: 'linux' });
  assert.equal(result, false);
});

test('linux: pgrep output with another PaperQuay process still blocks writes', () => {
  const exec = () => `${SELF_PID}\n${DESKTOP_PID}\n`;
  const result = detectDesktopAppRunning({ execFileSync: exec, selfPid: SELF_PID, platform: 'linux' });
  assert.equal(result, true);
});

test('linux: pgrep exit code 1 (no match) means not running', () => {
  const exec = () => {
    const error = new Error('Command failed: pgrep -x PaperQuay');
    error.status = 1;
    throw error;
  };
  const result = detectDesktopAppRunning({ execFileSync: exec, selfPid: SELF_PID, platform: 'linux' });
  assert.equal(result, false);
});
