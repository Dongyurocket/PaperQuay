import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const source = readFileSync(path.resolve('installer.nsh'), 'utf8');

test('installer process matching uses an $INSTDIR boundary, not a path prefix', () => {
  // 同前缀目录（PaperQuay Beta / PaperQuay-old）不能被当成当前安装目录。
  assert.match(
    source,
    /\[IO\.Path\]::GetDirectoryName\(\$\$_\.Path\) -ieq '\$INSTDIR'/,
    'must compare the executable directory with $INSTDIR',
  );
  assert.equal(
    /\.Path\.StartsWith\('\$INSTDIR'/.test(source),
    false,
    'prefix StartsWith would match PaperQuay Beta',
  );
});

test('installer never falls back to killing by process name', () => {
  assert.equal(/KillProcess\s+.*PaperQuay\.exe/.test(source), false);
  assert.match(source, /Stop-Process -Id \$\$_\.ProcessId/);
});
