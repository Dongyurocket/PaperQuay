import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  auditMcpBundle,
  readMcpBundleManifest,
  writeMcpBundleManifest,
} = require('../electron/mcpBundleManifest.cjs');

/**
 * D3-13：bundle manifest 必须阻止 stale bundle 被打包。
 * 用临时目录模拟 repo 根 + packaging/mcp，不触碰真实打包产物或用户数据。
 */

function createFixture() {
  const root = path.join(tmpdir(), `paperquay-mcp-manifest-${process.pid}-${Math.random().toString(16).slice(2)}`);
  const bundleDir = path.join(root, 'packaging', 'mcp');
  mkdirSync(path.join(root, 'bin'), { recursive: true });
  mkdirSync(bundleDir, { recursive: true });
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'paperquay-fixture', version: '1.2.3' }));
  writeFileSync(path.join(root, 'bin', 'paperquay-mcp.cjs'), "'use strict';\n// entry\n");
  writeFileSync(path.join(bundleDir, 'server.cjs'), "'use strict';\n// server\n");
  writeFileSync(path.join(bundleDir, 'ragWorker.cjs'), "'use strict';\n// worker\n");
  return { root, bundleDir };
}

test('a fresh MCP bundle passes the manifest audit', () => {
  const { root, bundleDir } = createFixture();
  try {
    const manifest = writeMcpBundleManifest({ root, outDir: bundleDir });
    assert.equal(manifest.version, '1.2.3');
    assert.equal(manifest.toolCount, 28);
    assert.deepEqual(auditMcpBundle({ root, outDir: bundleDir }), []);
    assert.deepEqual(readMcpBundleManifest({ root, outDir: bundleDir }), manifest);

    const stored = JSON.parse(readFileSync(path.join(bundleDir, 'bundle-manifest.json'), 'utf8'));
    assert.deepEqual(stored, manifest);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a stale bundle is rejected when the source entry or outputs changed', () => {
  const { root, bundleDir } = createFixture();
  try {
    writeMcpBundleManifest({ root, outDir: bundleDir });

    appendFileSync(path.join(root, 'bin', 'paperquay-mcp.cjs'), '// changed after bundling\n');
    let problems = auditMcpBundle({ root, outDir: bundleDir });
    assert.ok(problems.some((problem) => /source entry changed/.test(problem)), problems.join('\n'));

    writeFileSync(path.join(root, 'bin', 'paperquay-mcp.cjs'), "'use strict';\n// entry\n");
    appendFileSync(path.join(bundleDir, 'server.cjs'), '// tampered\n');
    problems = auditMcpBundle({ root, outDir: bundleDir });
    assert.ok(problems.some((problem) => /server\.cjs does not match/.test(problem)), problems.join('\n'));

    writeFileSync(path.join(bundleDir, 'server.cjs'), "'use strict';\n// server\n");
    appendFileSync(path.join(bundleDir, 'ragWorker.cjs'), '// tampered\n');
    problems = auditMcpBundle({ root, outDir: bundleDir });
    assert.ok(problems.some((problem) => /ragWorker\.cjs does not match/.test(problem)), problems.join('\n'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a bundle missing the worker or manifest is rejected', () => {
  const { root, bundleDir } = createFixture();
  try {
    let problems = auditMcpBundle({ root, outDir: bundleDir });
    assert.ok(problems.some((problem) => /missing bundle-manifest\.json/.test(problem)), problems.join('\n'));

    writeMcpBundleManifest({ root, outDir: bundleDir });
    rmSync(path.join(bundleDir, 'ragWorker.cjs'));
    problems = auditMcpBundle({ root, outDir: bundleDir });
    assert.ok(problems.some((problem) => /missing ragWorker\.cjs/.test(problem)), problems.join('\n'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a version bump without rebundling is rejected', () => {
  const { root, bundleDir } = createFixture();
  try {
    writeMcpBundleManifest({ root, outDir: bundleDir });
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'paperquay-fixture', version: '1.2.4' }));
    const problems = auditMcpBundle({ root, outDir: bundleDir });
    assert.ok(problems.some((problem) => /does not match package\.json 1\.2\.4/.test(problem)), problems.join('\n'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a tool-count drift is rejected even when the hashes still match', () => {
  const { root, bundleDir } = createFixture();
  try {
    writeMcpBundleManifest({ root, outDir: bundleDir });
    const manifestPath = path.join(bundleDir, 'bundle-manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.toolCount = 27;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const problems = auditMcpBundle({ root, outDir: bundleDir });
    assert.ok(problems.some((problem) => /bundle exposes 27 tools, source exposes 28/.test(problem)), problems.join('\n'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
