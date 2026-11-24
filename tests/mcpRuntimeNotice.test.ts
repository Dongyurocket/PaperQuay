import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describeMcpRuntimeNotice } from '../src/app/settings/mcpRuntimeNotice.ts';

const zh = <T>(zhText: T, _enText: T): T => zhText;
const en = <T>(_zhText: T, enText: T): T => enText;

test('mount mode with an unprepared runtime shows an actionable bilingual warning', () => {
  const runtime = {
    mode: 'mount' as const,
    prepared: false,
    reason: 'entry-missing',
    // 后端的英文原文只用于诊断日志；UI 不能直接回显。
    warning: 'stable MCP runtime was not prepared (entry-missing); the config uses the temporary AppImage mount entry and will stop working after the AppImage is remounted.',
  };

  const zhText = describeMcpRuntimeNotice(runtime, zh);
  assert.ok(zhText);
  assert.match(zhText, /稳定运行时/);
  assert.match(zhText, /稳定目录缺少服务入口/);
  assert.match(zhText, /临时挂载路径/);
  assert.equal(zhText.includes('stable MCP runtime was not prepared'), false);
  assert.equal(zhText.includes('AppImage mount entry'), false);

  const enText = describeMcpRuntimeNotice(runtime, en);
  assert.ok(enText);
  assert.match(enText, /stable MCP runtime/i);
  assert.match(enText, /missing the service entry/i);
  assert.match(enText, /temporary mount/i);
  assert.equal(enText.includes('stable MCP runtime was not prepared'), false);
});

test('appdir mode warns that command still points at the temporary mount', () => {
  const runtime = { mode: 'appdir' as const, prepared: true };

  const zhText = describeMcpRuntimeNotice(runtime, zh);
  assert.ok(zhText);
  assert.match(zhText, /APPIMAGE/);
  assert.match(zhText, /临时挂载/);

  const enText = describeMcpRuntimeNotice(runtime, en);
  assert.ok(enText);
  assert.match(enText, /APPIMAGE/i);
  assert.match(enText, /temporary APPDIR mount/i);
});

test('unknown or missing reasons fall back to a readable explanation', () => {
  const runtime = {
    mode: 'mount' as const,
    prepared: false,
    reason: 'runtime-not-prepared',
    warning: 'APPDIR is a temporary AppImage mount, so command still points into the mount directory.',
  };

  const zhText = describeMcpRuntimeNotice(runtime, zh);
  assert.ok(zhText);
  assert.match(zhText, /稳定目录未准备好/);
  assert.equal(zhText.includes('APPDIR'), false);

  const unknown = describeMcpRuntimeNotice({ mode: 'mount', prepared: false, reason: 'some-new-reason' }, zh);
  assert.ok(unknown);
  assert.match(unknown, /稳定目录未准备好/);

  const missing = describeMcpRuntimeNotice({ mode: 'mount', prepared: false }, en);
  assert.ok(missing);
  assert.match(missing, /not ready/i);
});

test('stable, installed and source runtimes produce no notice', () => {
  assert.equal(describeMcpRuntimeNotice({ mode: 'stable', prepared: true }, zh), null);
  // 普通安装包的 resources 入口本身稳定，不能在设置页误报 AppImage 告警。
  assert.equal(describeMcpRuntimeNotice({ mode: 'installed', prepared: true }, zh), null);
  // 开发/源码模式直接用仓库入口，不受 AppImage 挂载影响。
  assert.equal(describeMcpRuntimeNotice({ mode: 'source', prepared: false }, zh), null);
  assert.equal(describeMcpRuntimeNotice(null, zh), null);
  assert.equal(describeMcpRuntimeNotice(undefined, en), null);
});

test('McpSettingsSection renders the runtime notice from describeMcpRuntimeNotice', () => {
  const source = readFileSync(path.resolve('src/app/settings/McpSettingsSection.tsx'), 'utf8');

  assert.match(
    source,
    /import\s*\{[^}]*describeMcpRuntimeNotice[^}]*\}\s*from\s*'\.\/mcpRuntimeNotice'/,
    'McpSettingsSection must import describeMcpRuntimeNotice',
  );
  assert.match(source, /mcpRuntime\?:/, 'McpClientConfig must expose the optional mcpRuntime payload');
  assert.match(source, /describeMcpRuntimeNotice\(/, 'the section must call describeMcpRuntimeNotice');
  assert.match(source, /role="status"/, 'the runtime warning must be announced as a status message');
});
