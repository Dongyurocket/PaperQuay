import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { findEs2015Syntax } from '../scripts/build-office-addin.mjs';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const addinDir = path.join(rootDir, 'office-addin');

function readAddin(relativePath: string): string {
  return fs.readFileSync(path.join(addinDir, relativePath), 'utf8');
}

/** 在「没有现代 API」的沙箱里加载 ES5 产物 dist/core.js，取回全局 PaperQuayWord。 */
function loadCoreBundle() {
  const bundlePath = path.join(addinDir, 'dist', 'core.js');
  assert.ok(fs.existsSync(bundlePath), '缺少 office-addin/dist/core.js，请先运行 npm run build:office-addin');
  const sandbox: Record<string, unknown> = { console, setTimeout, clearTimeout };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readAddin(path.join('dist', 'core.js')), sandbox);
  assert.ok(sandbox.PaperQuayWord, 'IIFE 产物没有暴露全局 PaperQuayWord');
  return sandbox.PaperQuayWord as Record<string, any>;
}

test('加载项产物全部是 ES5（Word 2016 IE11 内核可执行）', () => {
  for (const file of ['taskpane.js', 'dialog.js', 'core.js']) {
    const code = readAddin(path.join('dist', file));
    assert.deepEqual(findEs2015Syntax(code), [], `dist/${file} 含 ES2015+ 语法，需重新运行 npm run build:office-addin`);
  }
  assert.ok(fs.existsSync(path.join(addinDir, 'sw.js')), '缺少离线壳 Service Worker office-addin/sw.js');
});

test('ES5 产物在沙箱里能完成一次带跳转链接的 GB/T 渲染', () => {
  const core = loadCoreBundle();
  const model = {
    schemaVersion: 2,
    documentId: 'doc-x',
    rev: 0,
    prefs: { style: 'gbt7714', bibliographyTitle: '参考文献', bibHeading: true, superscript: false, punctuation: 'full', links: true, bibliographyOrder: 'alpha' },
    citations: [
      { citeId: 'aaaa1111', items: [{ paperId: 'p1' }], updatedAt: 1 },
      { citeId: 'bbbb2222', items: [{ paperId: 'p2' }, { paperId: 'p1' }], updatedAt: 2 },
    ],
    items: {
      p1: { paper: { id: 'p1', title: '深度学习综述', itemType: 'journalArticle', publication: '计算机学报', year: 2021, volume: '44', issue: '3', pages: '1-25', authors: [{ name: '张三' }] }, fetchedAt: 1 },
      p2: { paper: { id: 'p2', title: 'Attention Is All You Need', itemType: 'conferencePaper', publication: 'NeurIPS', year: 2017, authors: [{ name: 'Ashish Vaswani' }] }, fetchedAt: 1 },
    },
  };
  const plan = core.planRender(model, ['aaaa1111', 'bbbb2222'], { hasBibliography: true });
  // 沙箱里的数组原型与宿主不同，先展开成宿主数组再做严格比较。
  assert.deepEqual(
    [...plan.citations].map((citation: { text: string }) => citation.text),
    ['[1]', '[1-2]'],
  );
  assert.equal(plan.linked, true);
  assert.match(plan.citations[1].ooxml, /<pkg:package /);
  assert.match(plan.citations[1].ooxml, /<w:hyperlink w:anchor="_PQ_/);
  assert.match(plan.bibliographyOoxml, /<w:bookmarkStart w:id="\d+" w:name="_PQ_/);
  const restored = core.parseModelXml(core.serializeModelXml(model));
  assert.equal(restored.citations.length, 2);
});

test('manifest.xml：Word 任务窗格、WordApi 1.1 底线、自定义选项卡按钮都打开任务窗格', () => {
  const manifest = readAddin('manifest.xml');
  assert.match(manifest, /xsi:type="TaskPaneApp"/);
  assert.match(manifest, /<Host Name="Document" \/>/);
  assert.match(manifest, /<Permissions>ReadWriteDocument<\/Permissions>/);
  assert.match(manifest, /<Set Name="WordApi" MinVersion="1\.1" \/>/);
  assert.match(manifest, /<Version>0\.4\.0\.0<\/Version>/);
  assert.match(manifest, /<CustomTab id="PaperQuay\.Tab">/);
  for (const id of ['CiteButton', 'BibButton', 'RefreshButton', 'PrefsButton', 'PaneButton']) {
    assert.match(manifest, new RegExp(`id="PaperQuay\\.${id}"`), `缺少按钮 ${id}`);
  }
  // 单一写入运行时：所有按钮都是 ShowTaskpane，不用 ExecuteFunction。
  assert.doesNotMatch(manifest, /ExecuteFunction/);
  for (const action of ['cite', 'bib', 'refresh', 'prefs']) {
    assert.ok(manifest.includes(`taskpane.html?action=${action}`), `缺少 ?action=${action}`);
  }

  const referenced = new Set<string>();
  const pattern = /https:\/\/localhost:3000\/([^"<>\s?]+)/g;
  let match = pattern.exec(manifest);
  while (match) {
    referenced.add(match[1]);
    match = pattern.exec(manifest);
  }
  assert.ok(referenced.has('taskpane.html'), '清单必须声明 taskpane.html');
  const missing = [...referenced].filter((relative) => !fs.existsSync(path.join(addinDir, relative)));
  assert.deepEqual(missing, [], `清单引用了不存在的资源：${missing.join(', ')}`);
});

test('页面入口：taskpane/dialog 引用 office.js 与各自的 ES5 产物，页面元素与脚本一致', () => {
  const html = readAddin('taskpane.html');
  assert.match(html, /appsforoffice\.microsoft\.com\/lib\/1\/hosted\/office\.js/);
  assert.match(html, /<script src="dist\/taskpane\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="taskpane\.css" \/>/);
  assert.doesNotMatch(html, /connection-input/, 'v2 不再需要手动粘贴连接信息');
  const dialog = readAddin('dialog.html');
  assert.match(dialog, /<script src="dist\/dialog\.js"><\/script>/);
  assert.match(readAddin('commands.html'), /appsforoffice\.microsoft\.com/);

  // taskpane.ts 里 byId('x') 引用的元素都要在 HTML 里存在。
  for (const [source, page] of [
    ['src/taskpane.ts', html],
    ['src/dialog.ts', dialog],
  ]) {
    const code = readAddin(source);
    const ids = new Set<string>();
    const idPattern = /byId(?:<[^>]+>)?\('([\w-]+)'\)/g;
    let idMatch = idPattern.exec(code);
    while (idMatch) {
      ids.add(idMatch[1]);
      idMatch = idPattern.exec(code);
    }
    assert.ok(ids.size > 3, `${source} 的 byId 引用过少，测试可能失效`);
    const absent = [...ids].filter((id) => !page.includes(`id="${id}"`));
    assert.deepEqual(absent, [], `${source} 引用了页面里不存在的元素：${absent.join(', ')}`);
  }
});

test('图标尺寸与清单要求一致', () => {
  for (const size of [16, 32, 64, 80]) {
    const buffer = fs.readFileSync(path.join(addinDir, 'assets', `icon-${size}.png`));
    assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG', `icon-${size}.png 不是 PNG`);
    assert.equal(buffer.readUInt32BE(16), size, `icon-${size}.png 宽度不符`);
    assert.equal(buffer.readUInt32BE(20), size, `icon-${size}.png 高度不符`);
  }
});

test('package.json 注册了加载项的构建/托管/侧载脚本，且 build 会产出加载项', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['build:office-addin'], 'node scripts/build-office-addin.mjs');
  assert.ok(pkg.scripts.build.includes('npm run build:office-addin'), 'npm run build 必须重建加载项产物');
  assert.equal(pkg.scripts['office-addin:build'], 'npm run build:office-addin && node scripts/generate-office-addin-icons.mjs');
  assert.equal(pkg.scripts['office-addin:serve'], 'node scripts/office-addin-server.mjs');
  assert.ok(pkg.scripts['office-addin:install'].includes('scripts/Install-OfficeAddin.ps1'));
  assert.equal(pkg.scripts['office-addin:smoke'], 'node scripts/office-addin-smoke.mjs');
  assert.ok(fs.existsSync(path.join(rootDir, 'scripts', 'Build-OfficeAddin.ps1')));
  assert.ok(fs.existsSync(path.join(rootDir, 'scripts', 'Install-OfficeAddin.ps1')));
  assert.ok(pkg.devDependencies['core-js'], 'ES5 polyfill 依赖 core-js');
});

test('exe 安装器：源码、构建脚本与 npm 入口齐备', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  assert.ok(pkg.scripts['office-addin:installer'].includes('scripts/Build-OfficeAddinInstaller.ps1'));
  assert.ok(fs.existsSync(path.join(rootDir, 'scripts', 'Build-OfficeAddinInstaller.ps1')));
  const source = fs.readFileSync(path.join(addinDir, 'installer', 'PaperQuayOfficeAddinInstaller.cs'), 'utf8');
  // 安装器与本体共用的约定：安装目录、注册表键、嵌入资源名、默认源站端口。
  assert.match(source, /PaperQuay",\s*"OfficeAddin/);
  assert.match(source, /Software\\Microsoft\\Office\\16\.0\\WEF\\Developer/);
  assert.match(source, /PQAddin\.manifest\.xml/);
  assert.match(source, /PQAddin\.icon\.png/);
  assert.match(source, /https:\/\/localhost:3000/);
  const manifest = readAddin('manifest.xml');
  assert.ok(manifest.includes('https://localhost:3000'), 'manifest.xml 默认源站应为 https://localhost:3000');
});
