import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const addinDir = path.join(rootDir, 'office-addin');

function readAddin(relativePath) {
  return fs.readFileSync(path.join(addinDir, relativePath), 'utf8');
}

/** 在沙箱里加载 IIFE 产物，取回 window.PaperQuayCitation。 */
function loadSharedBundle() {
  const bundlePath = path.join(addinDir, 'dist', 'citation-shared.js');
  assert.ok(fs.existsSync(bundlePath), '缺少 office-addin/dist/citation-shared.js，请先运行 npm run office-addin:build');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(readAddin(path.join('dist', 'citation-shared.js')), sandbox);
  assert.ok(sandbox.PaperQuayCitation, 'IIFE 产物没有暴露全局 PaperQuayCitation');
  return sandbox.PaperQuayCitation;
}

const shared = loadSharedBundle();

test('加载项共享产物暴露任务窗格依赖的全部 API', () => {
  const expected = [
    'CITATION_CONTROL_TAG_PREFIX',
    'BIBLIOGRAPHY_CONTROL_TAG',
    'CITATION_CONTROL_TITLE',
    'BIBLIOGRAPHY_CONTROL_TITLE',
    'DEFAULT_BIBLIOGRAPHY_TITLE',
    'DOCUMENT_SCHEMA_VERSION',
    'DOCUMENT_SETTINGS_KEYS',
    'DEFAULT_CITATION_STYLE',
    'CITATION_STYLES',
    'CITATION_STYLE_IDS',
    'normalizeCitationStyle',
    'createCitationId',
    'encodeCitationControlTag',
    'parseCitationControlTag',
    'isBibliographyControlTag',
    'normalizeStoredCitations',
    'serializeStoredCitations',
    'upsertStoredCitation',
    'removeStoredCitation',
    'findStoredCitation',
    'extractCitationControlTagsFromOoxml',
    'hasBibliographyControlInOoxml',
    'renderCitations',
  ];
  for (const name of expected) {
    assert.ok(name in shared, `共享产物缺少导出：${name}`);
  }
});

test('任务窗格使用的 shared.* 成员都存在于共享产物中', () => {
  const source = readAddin('taskpane.js');
  const used = new Set();
  const pattern = /(?<![\w$.\-/])shared\.([A-Za-z_$][\w$]*)/g;
  let match = pattern.exec(source);
  while (match) {
    used.add(match[1]);
    match = pattern.exec(source);
  }
  assert.ok(used.size > 10, `taskpane.js 里 shared.* 引用过少（${used.size}），测试可能失效`);
  const missing = [...used].filter((name) => !(name in shared));
  assert.deepEqual(missing, [], `taskpane.js 引用了共享产物里不存在的成员：${missing.join(', ')}`);
});

test('共享产物在加载项环境里能完成一次 GB/T 顺序编码制渲染', () => {
  const papers = new Map([
    ['p1', { id: 'p1', title: '深度学习综述', itemType: 'journalArticle', publication: '计算机学报', year: 2021, volume: '44', issue: '3', pages: '1-25', authors: [{ name: '张三' }] }],
    ['p2', { id: 'p2', title: 'Attention Is All You Need', itemType: 'conferencePaper', publication: 'NeurIPS', year: 2017, authors: [{ name: 'Ashish Vaswani' }] }],
  ]);
  const result = shared.renderCitations(
    { style: 'gbt7714', groups: [{ citeId: 'aaaa1111', items: [{ paperId: 'p1' }] }, { citeId: 'bbbb2222', items: [{ paperId: 'p2' }] }] },
    (paperId) => papers.get(paperId),
  );
  assert.equal(result.kind, 'numeric');
  assert.deepEqual(
    [...result.groups].map((group) => group.inline),
    ['[1]', '[2]'],
  );
  assert.deepEqual(
    [...result.entries].map((entry) => entry.seq),
    [1, 2],
  );
  const lines = result.bibliography.split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0], '[1] 张三. 深度学习综述[J]. 计算机学报, 2021, 44(3): 1-25.');
  assert.match(lines[1], /^\[2\] Ashish Vaswani\. Attention Is All You Need\[C\]\/\/NeurIPS\. 2017\.$/);
  assert.equal(result.missingPaperIds.length, 0);
});

test('引用控件标签与文档设置键在加载项内可往返', () => {
  const citeId = shared.createCitationId(() => 0.5);
  const tag = shared.encodeCitationControlTag(citeId);
  assert.equal(shared.parseCitationControlTag(tag), citeId);
  assert.equal(shared.parseCitationControlTag(shared.BIBLIOGRAPHY_CONTROL_TAG), null);
  assert.equal(shared.isBibliographyControlTag(shared.BIBLIOGRAPHY_CONTROL_TAG), true);

  const citations = shared.upsertStoredCitation([], { citeId, items: [{ paperId: 'p1', label: '标题' }], updatedAt: 1 });
  const restored = shared.normalizeStoredCitations(shared.serializeStoredCitations(citations));
  assert.equal(shared.findStoredCitation(restored, citeId).items[0].paperId, 'p1');
  assert.equal(shared.DOCUMENT_SETTINGS_KEYS.citations, 'pq:citations');

  const ooxml = `<w:document><w:sdt><w:sdtPr><w:tag w:val="${tag}"/></w:sdtPr></w:sdt>`
    + `<w:sdt><w:sdtPr><w:tag w:val="${shared.BIBLIOGRAPHY_CONTROL_TAG}"/></w:sdtPr></w:sdt>`;
  assert.deepEqual([...shared.extractCitationControlTagsFromOoxml(ooxml)], [citeId]);
  assert.equal(shared.hasBibliographyControlInOoxml(ooxml), true);
});

test('manifest.xml 声明 Word 任务窗格加载项且引用的本地资源都存在', () => {
  const manifest = readAddin('manifest.xml');
  assert.match(manifest, /xsi:type="TaskPaneApp"/);
  assert.match(manifest, /<Host Name="Document" \/>/);
  assert.match(manifest, /<Permissions>ReadWriteDocument<\/Permissions>/);
  assert.match(manifest, /<Set Name="WordApi" MinVersion="1\.1" \/>/);
  assert.match(manifest, /PaperQuay\.CiteButton/);
  assert.match(manifest, /ShowTaskpane/);

  const referenced = new Set();
  const pattern = /https:\/\/localhost:3000\/([^"<>\s]+)/g;
  let match = pattern.exec(manifest);
  while (match) {
    referenced.add(match[1]);
    match = pattern.exec(manifest);
  }
  assert.ok([...referenced].includes('taskpane.html'), '清单必须声明 taskpane.html');
  const missing = [...referenced].filter((relative) => !fs.existsSync(path.join(addinDir, relative)));
  assert.deepEqual(missing, [], `清单引用了不存在的资源：${missing.join(', ')}`);
});

test('任务窗格页面引用了本地脚本与样式，且与清单资源一致', () => {
  const html = readAddin('taskpane.html');
  assert.match(html, /<script src="dist\/citation-shared\.js"><\/script>/);
  assert.match(html, /<script src="taskpane\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="taskpane\.css" \/>/);
  assert.match(html, /appsforoffice\.microsoft\.com\/lib\/1\/hosted\/office\.js/);
  assert.match(readAddin('commands.html'), /appsforoffice\.microsoft\.com/);
});

test('图标尺寸与清单要求一致', () => {
  for (const size of [16, 32, 64, 80]) {
    const buffer = fs.readFileSync(path.join(addinDir, 'assets', `icon-${size}.png`));
    assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG', `icon-${size}.png 不是 PNG`);
    assert.equal(buffer.readUInt32BE(16), size, `icon-${size}.png 宽度不符`);
    assert.equal(buffer.readUInt32BE(20), size, `icon-${size}.png 高度不符`);
  }
});

test('package.json 注册了加载项的构建/托管/侧载脚本', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['office-addin:build'], 'npm run build:citation -- --addin-only && node scripts/generate-office-addin-icons.mjs');
  assert.equal(pkg.scripts['office-addin:serve'], 'node scripts/office-addin-server.mjs');
  assert.ok(pkg.scripts['office-addin:install'].includes('scripts/Install-OfficeAddin.ps1'));
  assert.equal(pkg.scripts['office-addin:smoke'], 'node scripts/office-addin-smoke.mjs');
  assert.ok(fs.existsSync(path.join(rootDir, 'scripts', 'Build-OfficeAddin.ps1')));
  assert.ok(fs.existsSync(path.join(rootDir, 'scripts', 'Install-OfficeAddin.ps1')));
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
  // 安装器写入的清单必须以内嵌 manifest.xml 为模板，与源站默认端口保持一致。
  const manifest = readAddin('manifest.xml');
  assert.ok(manifest.includes('https://localhost:3000'), 'manifest.xml 默认源站应为 https://localhost:3000');
});
