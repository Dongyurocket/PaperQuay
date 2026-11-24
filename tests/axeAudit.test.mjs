import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  launchPaperQuay,
  makeUserDataDir,
} from './support/electronCdp.mjs';
import { writePdfFixtures } from './support/pdfFixtures.mjs';

const ENABLED = process.env.PAPERQUAY_AXE === '1';
const ASSET_DIR = path.resolve('docs/assets/audit-2026-11-24');
const REPORT_PATH = path.join(ASSET_DIR, 'axe-report.json');

/**
 * E4/E1：真实 Electron 渲染下的 axe 扫描与浅/深主题截图。
 *
 * 默认跳过（启动 Electron + 双主题扫描约 1 分钟），发布前用
 *   PAPERQUAY_AXE=1 node --test tests/axeAudit.test.mjs
 * 运行；结果写入 docs/assets/audit-2026-11-24/。
 */

async function clickAria(app, label) {
  const clicked = await app.evaluate(`(() => {
    const el = [...document.querySelectorAll('button,[role="button"]')]
      .find((node) => node.getAttribute('aria-label') === ${JSON.stringify(label)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
  assert.equal(clicked, true, `missing control with aria-label ${label}`);
}

async function clickText(app, text) {
  const clicked = await app.evaluate(`(() => {
    const el = [...document.querySelectorAll('button,[role="button"]')]
      .find((node) => (node.textContent || '').includes(${JSON.stringify(text)}));
    if (!el) return false;
    el.click();
    return true;
  })()`);
  assert.equal(clicked, true, `missing control with text ${text}`);
}

async function openLibrary(app) {
  await clickAria(app, '文库');
  await app.waitFor(`Boolean(document.querySelector('[data-paper-row-id]')) || document.body.innerText.includes('导入')`);
}

async function openReader(app) {
  await openLibrary(app);
  const opened = await app.evaluate(`(() => {
    const row = document.querySelector('[data-paper-row-id]');
    if (!row) return false;
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
    return true;
  })()`);
  assert.equal(opened, true, 'no imported paper row to open');
  await app.waitFor(`Boolean(document.querySelector('.paperquay-pdf-linked[data-pdf-phase="page-rendered"]'))`, {
    timeoutMs: 60_000,
  });
}

async function openNotes(app) {
  await clickAria(app, '笔记');
  await app.waitFor(`Boolean(document.querySelector('[aria-label="新建笔记"]'))`, { timeoutMs: 30_000 });
  // 扫描列表 + 已打开的编辑器，而不是只扫空态。
  await clickAria(app, '新建笔记');
  await app.waitFor(`Boolean(document.querySelector('.ProseMirror,[contenteditable="true"]'))`, { timeoutMs: 30_000 });
}

async function openGraph(app) {
  await clickAria(app, '图谱');
  await app.waitFor(`Boolean(document.querySelector('[aria-label="放大"]'))`, { timeoutMs: 30_000 });
}

async function openSettings(app) {
  await clickAria(app, '设置');
  await app.waitFor(`Boolean(document.querySelector('#pq-app-settings-title'))`, { timeoutMs: 30_000 });
}

async function openSettingsSection(app, label, readyText) {
  await clickText(app, label);
  await app.waitFor(
    `document.body.innerText.includes(${JSON.stringify(readyText)})`,
    { timeoutMs: 30_000 },
  );
}

async function closeSettings(app) {
  await app.evaluate(`(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return true;
  })()`);
  await app.waitFor(`!document.querySelector('#pq-app-settings-title')`, { timeoutMs: 15_000 });
}

function serious(violations) {
  return violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
}

/**
 * Library/Reader 会显示夹具的绝对路径。截图前把用户目录替换为占位符，
 * 审计资产因此不含个人路径；只改可见文本，不影响此前的 axe 扫描结果。
 */
async function redactPersonalPaths(app) {
  await app.evaluate(`(() => {
    // 整个盘符绝对路径都替换掉：只去用户名仍会暴露仓库/夹具目录。
    const pattern = /[A-Za-z]:\\\\+[^\\s"'<>]+/g;
    const replacement = 'C:\\\\PaperQuayAudit';
    const replace = (text) => String(text ?? '').replace(pattern, replacement);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const next = replace(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
      node = walker.nextNode();
    }
    // textarea/input 的值是属性而不是文本节点；MCP 配置片段里含 JSON 转义路径。
    for (const field of document.querySelectorAll('textarea,input')) {
      const proto = field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter && typeof field.value === 'string') setter.call(field, replace(field.value));
    }
    for (const element of document.querySelectorAll('*')) {
      for (const attribute of ['title', 'aria-label', 'alt', 'placeholder']) {
        const value = element.getAttribute(attribute);
        if (!value) continue;
        const next = replace(value);
        if (next !== value) element.setAttribute(attribute, next);
      }
    }
    return true;
  })()`);
}

function sanitizeReportValue(value) {
  if (typeof value === 'string') {
    return value
      .split(process.cwd()).join('<repo>')
      // JSON 里的路径可能是双反斜杠转义；匹配一到多个反斜杠后的整段路径。
      .replace(/[A-Za-z]:\\+[^\s"'<>]*/g, '<path>')
      .replace(/C:\\Users\\[^\\\s"']+/gi, '<user>');
  }
  if (Array.isArray(value)) return value.map(sanitizeReportValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeReportValue(item)]),
    );
  }
  return value;
}

test('E4/E1: axe scan and light/dark screenshots of main workspaces', { skip: !ENABLED && 'set PAPERQUAY_AXE=1 to run' }, async () => {
  await fs.mkdir(ASSET_DIR, { recursive: true });
  const userDataDir = await makeUserDataDir('pq-axe-');
  const fixtureDir = path.join(userDataDir, 'PaperQuay');
  const { simplePath } = await writePdfFixtures(fixtureDir);
  const app = await launchPaperQuay({
    userDataDir,
    port: 9444,
    // 本机以管理员/远程会话运行时 Chromium OS 沙箱在 app ready 前崩溃
    // (0x80000003)；渲染器仍由 webPreferences.sandbox 限制 preload 的
    // Node 访问。此限制记录在验收文档中。
    extraArgs: ['--no-sandbox'],
  });

  const report = { generatedAt: new Date().toISOString(), electron: '42.2.0', views: {}, totals: {} };

  try {
    await app.waitFor(`document.readyState === 'complete' && Boolean(window.paperquay)`);
    const imported = await app.evaluate(`window.paperquay.invoke('library_import_pdfs', {
      request: { paths: [${JSON.stringify(simplePath)}], importMode: 'copy' },
    })`);
    assert.ok(Array.isArray(imported) && imported.some((item) => item.status === 'imported'), 'fixture import failed');

    for (const theme of ['light', 'dark']) {
      await app.setTheme(theme);
      // setTheme 会 reload，window.axe 需要在每次导航后重新注入。
      await app.injectAxe();
      report.views[theme] = {};

      const scan = async (view, fileSuffix, open) => {
        await open(app);
        // 等入场动画（如 pq-msg-in）结束：动画中间态的 opacity 会压低对比度，
        // axe 会把过渡帧误报为 serious color-contrast。
        await new Promise((resolve) => setTimeout(resolve, 700));
        const result = await app.runAxe('body');
        report.views[theme][view] = { ...result };
        console.log(`[axe] ${theme}/${view}: ${result.violations.length} violations`);
        for (const violation of result.violations) {
          console.log(`  - ${violation.impact} ${violation.id} (${violation.nodes} nodes)`);
          for (const detail of violation.details ?? []) {
            console.log(`      ${detail.target}`);
            if (detail.summary) console.log(`      ${detail.summary.replace(/\n/g, ' | ').slice(0, 400)}`);
          }
        }
        for (const item of result.incomplete ?? []) {
          console.log(`  [incomplete] ${item.impact} ${item.id} (${item.nodes} nodes)`);
          for (const detail of item.details ?? []) {
            console.log(`      ${detail.target} :: ${(detail.html ?? '').slice(0, 160)}`);
          }
        }
        await redactPersonalPaths(app);
        const screenshot = path.join(ASSET_DIR, `${view}-${theme}${fileSuffix}.png`);
        await app.screenshot(screenshot);
        report.views[theme][view].screenshot = path.relative(process.cwd(), screenshot);

        const blocking = serious(result.violations);
        assert.deepEqual(blocking, [], `serious/critical axe violations in ${theme}/${view}`);
        // 未决的「可见文字与可访问名称不一致」同样按 serious 处理：修复前已复现两处。
        const unresolvedNames = (result.incomplete ?? [])
          .filter((item) => item.id === 'label-content-name-mismatch')
          .filter((item) => item.impact === 'serious' || item.impact === 'critical');
        assert.deepEqual(unresolvedNames, [], `unresolved label-content-name-mismatch in ${theme}/${view}`);

        // 允许的 serious incomplete 只有 axe 对 canvas/合成背景的 color-contrast 未决项；
        // 新增其它 serious/critical incomplete 必须在这里失败并复核。
        const unexpectedIncomplete = (result.incomplete ?? [])
          .filter((item) => item.impact === 'serious' || item.impact === 'critical')
          .filter((item) => item.id !== 'color-contrast');
        assert.deepEqual(unexpectedIncomplete, [], `unexpected serious/critical incomplete in ${theme}/${view}`);
      };

      await scan('library', '', openLibrary);
      await scan('notes', '', openNotes);
      await scan('graph', '', openGraph);
      await scan('settings', '', openSettings);
      await scan('settings-backup', '', (app) => openSettingsSection(app, '备份与迁移', '加密备份包'));
      await scan('settings-mcp', '', (app) => openSettingsSection(app, 'MCP 服务', '复制配置'));
      await scan('settings-updates', '', (app) => openSettingsSection(app, '软件更新', '检查更新'));
      await closeSettings(app);
      await scan('reader', '', openReader);
    }

    const all = Object.values(report.views).flatMap((views) => Object.values(views));
    report.totals = {
      views: all.length,
      violations: all.reduce((sum, view) => sum + view.violations.length, 0),
      seriousCritical: all.reduce((sum, view) => sum + serious(view.violations).length, 0),
      incomplete: all.reduce((sum, view) => sum + view.incomplete.length, 0),
      seriousCriticalIncomplete: all.reduce(
        (sum, view) => sum + (view.incomplete ?? []).filter(
          (item) => item.impact === 'serious' || item.impact === 'critical',
        ).length,
        0,
      ),
    };
    assert.equal(app.exceptions.length, 0, `renderer exceptions: ${app.exceptions.join('\n')}`);
  } finally {
    report.app = {
      stdoutTail: app.stdout.split('\n').slice(-40).join('\n'),
      stderrTail: app.stderr.split('\n').slice(-40).join('\n'),
      consoleTail: app.consoleLines.slice(-40),
      exceptions: app.exceptions,
    };
    await fs.writeFile(REPORT_PATH, `${JSON.stringify(sanitizeReportValue(report), null, 2)}\n`, 'utf8');
    await app.stop();
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
});
