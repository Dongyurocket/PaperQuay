const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { cleanString, now } = require('./utils.cjs');
const { parseMarkdownToTiptap } = require('../../src/shared/markdownToTiptap.cjs');

// PaperQuay 笔记 Markdown vault 双向同步。
//
// 设计约束（见 docs/notes-charter.md）：
// - Tiptap JSON 是唯一事实源；vault 里的 .md 是外部可编辑的镜像，不是存储格式。
// - frontmatter 的 id 是同步锚；Obsidian 侧禁止改 id，无 id 的文件视为新笔记。
// - 锚点（anchors）以 JSON 原样写入 frontmatter；正文中的已知锚点链接由共享解析器恢复。
// - 只管理 manifest 记录过的文件：用户自己的 Obsidian 文件（无 id 且未被导入过）不会被删除。

const VAULT_MANIFEST_NAME = '.paperquay-vault.json';
// 文件系统保留字符 + 控制字符（必须写成转义，否则源码会被误识别为二进制）。
// eslint-disable-next-line no-control-regex -- 需要匹配并剔除不可见控制字符，保持原有字节级语义
const UNSAFE_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

function sanitizeFileName(value, fallback = 'untitled') {
  const cleaned = cleanString(value)
    .replace(UNSAFE_FILENAME_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return (cleaned || fallback).slice(0, 80);
}

function sanitizePathSegment(value) {
  return sanitizeFileName(value, 'folder');
}

// ---- 极简 frontmatter 编解码：只负责我们自己生成的字段 ----
// 值为单行；数组/对象用 JSON flow 形式（[...] / {...}），字符串原样。
function encodeFrontmatter(fields) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (value === null) {
      lines.push(`${key}: null`);
    } else if (Array.isArray(value) || typeof value === 'object') {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else if (typeof value === 'number') {
      lines.push(`${key}: ${value}`);
    } else {
      const text = String(value);
      lines.push(`${key}: ${/[[\]:#{}"\n]/.test(text) ? JSON.stringify(text) : text}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

function decodeFrontmatter(text) {
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return { fields: {}, body: text };
  const end = text.indexOf('\n---', 3);
  if (end < 0) return { fields: {}, body: text };

  const raw = text.slice(3, end).replace(/\r/g, '');
  const body = text.slice(text.indexOf('\n', end + 1) + 1);
  const fields = {};
  for (const line of raw.split('\n')) {
    const match = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue.trim();
    if (value === 'null' || value === '') {
      fields[key] = null;
    } else if (/^[[{"]/.test(value) || /^-?\d+(\.\d+)?$/.test(value)) {
      try {
        fields[key] = JSON.parse(value);
      } catch {
        fields[key] = value;
      }
    } else {
      fields[key] = value;
    }
  }
  return { fields, body };
}

// ---- 可暂停的文件系统流程 ----
// syncNow 在 Electron 主线程运行。为此把文件扫描/读写写成 generator：把每个 IO
// 作为 operation 交还驱动层。
// - 手动同步（默认）：小 vault 由同步驱动一次跑完（保持旧 API 行为），超过
//   SYNC_IO_BUDGET 个 IO 后交给异步驱动。
// - 后台同步（options.background）：从第一个 IO 起就走异步驱动（调用栈内不做
//   文件 IO），每 ASYNC_CHUNK_IO 次 IO 用 setImmediate 让出事件循环，使 1000
//   文件基准下每块连续 CPU（解析/序列化/DB 写入）保持在 16ms 以内。
// - 取消：options.shouldCancel() 或 AbortSignal。驱动在每个 IO 前检查，取消后
//   不再执行任何 IO（不写 manifest、不删文件），返回 cancelled:true 的 stats。
// 预算按「文件系统操作数」计。一个导入文件约 2 个 IO（读 + stat），
// 一个导出文件约 3 个 IO。同步前缀 20 个 IO 足够覆盖 1-2 篇笔记的小 vault
// （保持旧调用方直接读 stats）；异步每 8 个 IO 让出一次事件循环。
const SYNC_IO_BUDGET = 20;
const ASYNC_CHUNK_IO = 8;

function createCancellationCheck(options = {}) {
  const signal = options.signal;
  const shouldCancel = typeof options.shouldCancel === 'function' ? options.shouldCancel : null;
  if (!signal && !shouldCancel) return null;
  return () => Boolean((signal && signal.aborted) || (shouldCancel && shouldCancel()));
}

function createSyncStats(vaultDir) {
  return {
    vaultDir,
    exported: 0,
    imported: 0,
    created: 0,
    updated: 0,
    removed: 0,
    skipped: 0,
    conflicts: 0,
    total: 0,
    createdFolders: 0,
    cancelled: false,
  };
}

// 取消时生成器可能停在任意 yield 上：return() 让它在不执行剩余 IO 的情况下结束，
// stats 保留已完成的计数并标记 cancelled。
function finishCancelledFlow(flow, stats) {
  if (stats) stats.cancelled = true;
  try {
    flow.return(stats);
  } catch {
    // 生成器已被关闭时忽略。
  }
  return stats;
}

// 阶段边界（例如全量笔记水合）是同步大块 CPU；插入 yield 操作让异步驱动在它们
// 前后各让出一次事件循环，避免与相邻分片的 CPU 叠加成一次 >16ms 的停顿。
const YIELD_OPERATION = { type: 'yield' };

function* loadManifestFlow(vaultDir) {
  try {
    const raw = JSON.parse(
      yield { type: 'readFile', abs: path.join(vaultDir, VAULT_MANIFEST_NAME), encoding: 'utf8' },
    );
    const files = raw && typeof raw.files === 'object' && raw.files ? raw.files : {};
    const normalizedFiles = {};
    const metadata = {};
    for (const [noteId, value] of Object.entries(files)) {
      if (typeof value === 'string') {
        normalizedFiles[noteId] = value;
      } else if (value && typeof value === 'object') {
        normalizedFiles[noteId] = cleanString(value.path);
        metadata[noteId] = {
          exportedUpdatedAt: Number(value.exportedUpdatedAt) || 0,
          contentHash: cleanString(value.contentHash),
        };
      }
    }
    return {
      files: normalizedFiles,
      metadata: raw && typeof raw.metadata === 'object' && raw.metadata ? raw.metadata : metadata,
    };
  } catch {
    return { files: {}, metadata: {} };
  }
}

function* saveManifestFlow(vaultDir, manifest) {
  yield {
    type: 'writeFile',
    abs: path.join(vaultDir, VAULT_MANIFEST_NAME),
    data: JSON.stringify({ version: 2, files: manifest.files, metadata: manifest.metadata, updatedAt: now() }, null, 2),
  };
}

function contentHash(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function conflictPath(rel, timestamp) {
  const extension = path.extname(rel);
  const base = rel.slice(0, -extension.length);
  const stamp = new Date(timestamp).toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15);
  return `${base}--conflict-${stamp}${extension || '.md'}`;
}

function* listMarkdownFilesFlow(rootDir) {
  const result = [];
  const stack = [''];
  while (stack.length > 0) {
    const rel = stack.pop();
    const abs = rel ? path.join(rootDir, rel) : rootDir;
    let entries = [];
    try {
      entries = yield { type: 'readdir', abs };
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        stack.push(entryRel);
      } else if (/\.md$/i.test(entry.name)) {
        result.push(entryRel);
      }
    }
  }
  return result;
}

function executeIo(operation) {
  switch (operation.type) {
    case 'readFile':
      return fs.readFileSync(operation.abs, operation.encoding || 'utf8');
    case 'stat':
      return fs.statSync(operation.abs);
    case 'readdir':
      return fs.readdirSync(operation.abs, { withFileTypes: true });
    case 'mkdir':
      return fs.mkdirSync(operation.dir, { recursive: true });
    case 'writeFile':
      return fs.writeFileSync(operation.abs, operation.data, operation.encoding || 'utf8');
    case 'remove':
      return fs.rmSync(operation.abs, { force: true });
    case 'utimes':
      return fs.utimesSync(operation.abs, operation.mtime, operation.mtime);
    default:
      throw new Error(`Unsupported vault IO operation: ${operation.type}`);
  }
}

async function executeIoAsync(operation) {
  switch (operation.type) {
    case 'readFile':
      return fs.promises.readFile(operation.abs, operation.encoding || 'utf8');
    case 'stat':
      return fs.promises.stat(operation.abs);
    case 'readdir':
      return fs.promises.readdir(operation.abs, { withFileTypes: true });
    case 'mkdir':
      return fs.promises.mkdir(operation.dir, { recursive: true });
    case 'writeFile':
      return fs.promises.writeFile(operation.abs, operation.data, operation.encoding || 'utf8');
    case 'remove':
      return fs.promises.rm(operation.abs, { force: true });
    case 'utimes':
      return fs.promises.utimes(operation.abs, operation.mtime, operation.mtime);
    default:
      throw new Error(`Unsupported vault IO operation: ${operation.type}`);
  }
}

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function driveFlowAsync(flow, firstOperation, options = {}) {
  const {
    stats = null,
    shouldCancel = null,
    asyncChunkIo = ASYNC_CHUNK_IO,
    executeAsync = executeIoAsync,
    yieldToLoop = yieldToEventLoop,
  } = options;
  let operation = firstOperation;
  let input;
  let error = null;
  let executed = 0;

  for (;;) {
    if (operation) {
      if (shouldCancel && shouldCancel()) return finishCancelledFlow(flow, stats);
      if (operation.type === 'yield') {
        // 只让出事件循环，不算一次文件 IO，也不占用分片预算。
        await yieldToLoop();
        operation = null;
      } else {
        executed += 1;
        try {
          input = await executeAsync(operation);
          error = null;
        } catch (caught) {
          error = caught;
        }
        operation = null;
        if (executed % asyncChunkIo === 0) await yieldToLoop();
      }
    }

    let step = error ? flow.throw(error) : flow.next(input);
    error = null;
    input = undefined;
    if (step.done) return step.value;
    operation = step.value;
  }
}

// 小负载同步跑完（保持 syncNow 的旧返回值，测试和直接调用方无需 await）；
// 超过预算或 background 模式切换为异步驱动，避免一次性阻塞主线程。
function driveFlow(flow, options = {}) {
  const {
    background = false,
    stats = null,
    shouldCancel = null,
    syncIoBudget = SYNC_IO_BUDGET,
    asyncChunkIo = ASYNC_CHUNK_IO,
    executeSync = executeIo,
    executeAsync = executeIoAsync,
    yieldToLoop = yieldToEventLoop,
  } = options;

  let step = flow.next();
  if (step.done) return step.value;

  const asyncOptions = { stats, shouldCancel, asyncChunkIo, executeAsync, yieldToLoop };

  // 后台模式不在调用栈内执行任何 IO：首个 mkdir 也交给异步驱动。
  if (background) {
    return driveFlowAsync(flow, step.value, asyncOptions);
  }

  let operation = step.value;
  let input;
  let error = null;
  let executed = 0;

  while (executed < syncIoBudget) {
    if (shouldCancel && shouldCancel()) return finishCancelledFlow(flow, stats);
    if (operation.type === 'yield') {
      // 同步驱动无法让出主线程；边界 yield 直接跳过，语义与异步驱动一致。
      step = flow.next(undefined);
      if (step.done) return step.value;
      operation = step.value;
      continue;
    }
    executed += 1;
    try {
      input = executeSync(operation);
      error = null;
    } catch (caught) {
      error = caught;
    }
    step = error ? flow.throw(error) : flow.next(input);
    error = null;
    input = undefined;
    if (step.done) return step.value;
    operation = step.value;
  }

  return driveFlowAsync(flow, operation, asyncOptions);
}

function noteBody(note) {
  return (note.contentText || note.content || '').replace(/\s+$/u, '');
}

// ---- Tiptap JSON → Markdown 序列化（痛点 7 导出约定）----
// 内联 paperReference 渲染为顺序编码 [n]（按首次出现编号、同 paperId 同号），文末追加
// GB/T 7714 参考文献列表；锚点块序列化为 paperquay://anchor/<id> 链接，锚点 ID 不丢。
// Tiptap JSON 是唯一事实源；Markdown 导出和共享解析器只负责交换格式。

function escapeMarkdownText(text) {
  return String(text).replace(/([\\`*_[\]])/g, '\\$1');
}

function serializeInline(node, ctx) {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'text') {
    let text = escapeMarkdownText(node.text ?? '');
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') text = `**${text}**`;
      else if (mark.type === 'italic') text = `*${text}*`;
      else if (mark.type === 'strike') text = `~~${text}~~`;
      else if (mark.type === 'code') text = `\`${String(node.text ?? '')}\``;
      else if (mark.type === 'link' && mark.attrs?.href) text = `[${text}](${mark.attrs.href})`;
    }
    return text;
  }
  if (node.type === 'hardBreak') return '  \n';
  if (node.type === 'inlineMath') {
    const latex = String(node.attrs?.latex ?? '').trim();
    return latex ? `$${latex}$` : '';
  }
  if (node.type === 'paperReference') {
    const paperId = cleanString(node.attrs?.paperId);
    const label = cleanString(node.attrs?.label) || paperId;
    if (!paperId) return `@${label}`;
    if (!ctx.refNumberByPaperId.has(paperId)) {
      ctx.refNumberByPaperId.set(paperId, ctx.refNumberByPaperId.size + 1);
      ctx.refs.push({ paperId, label });
    }
    return `[${ctx.refNumberByPaperId.get(paperId)}]`;
  }
  if (node.type === 'noteAnchorLink') {
    const anchorId = cleanString(node.attrs?.anchorId);
    const label = cleanString(node.attrs?.label) || '锚点';
    return anchorId ? `[${label}](paperquay://anchor/${anchorId})` : label;
  }
  if (node.type === 'wikiLink') {
    const noteId = cleanString(node.attrs?.noteId);
    const currentTitle = noteId ? ctx.notesById?.get(noteId)?.title : '';
    const label = cleanString(currentTitle) || cleanString(node.attrs?.label) || cleanString(node.attrs?.title) || cleanString(node.attrs?.id) || '';
    return label ? `[[${label}]]` : '';
  }
  if (node.type === 'hashTag') {
    const tag = cleanString(node.attrs?.tag) || cleanString(node.attrs?.label) || '';
    return tag ? `#${tag}` : '';
  }
  return serializeChildrenInline(node, ctx);
}

function serializeChildrenInline(node, ctx) {
  return (node.content ?? []).map((child) => serializeInline(child, ctx)).join('');
}

function serializeBlock(node, ctx, indent = '') {
  if (!node || typeof node !== 'object') return '';
  switch (node.type) {
    case 'paragraph': {
      const text = serializeChildrenInline(node, ctx);
      return text ? `${indent}${text}` : '';
    }
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1));
      return `${indent}${'#'.repeat(level)} ${serializeChildrenInline(node, ctx)}`;
    }
    case 'blockquote': {
      const inner = serializeBlocks(node.content, ctx, '');
      return inner
        .split('\n')
        .map((line) => (line ? `${indent}> ${line}` : `${indent}>`))
        .join('\n');
    }
    case 'codeBlock': {
      const lang = cleanString(node.attrs?.language);
      const code = (node.content ?? []).map((child) => child.text ?? '').join('');
      return `${indent}\`\`\`${lang}\n${code}\n${indent}\`\`\``;
    }
    case 'horizontalRule':
      return `${indent}---`;
    case 'blockMath': {
      const latex = String(node.attrs?.latex ?? '').trim();
      if (!latex) return '';
      const lines = latex.split('\n').map((line) => `${indent}${line}`);
      return [`${indent}$$`, ...lines, `${indent}$$`].join('\n');
    }
    case 'bulletList':
    case 'orderedList': {
      const ordered = node.type === 'orderedList';
      return (node.content ?? [])
        .map((item, index) => {
          const marker = ordered ? `${index + 1}. ` : '- ';
          const inner = serializeBlocks(item.content, ctx, `${indent}  `);
          const lines = inner.split('\n');
          const first = lines[0]?.replace(new RegExp(`^${indent}  `), '') ?? '';
          const rest = lines.slice(1).filter((line) => line !== '');
          return [`${indent}${marker}${first}`, ...rest].join('\n');
        })
        .filter(Boolean)
        .join('\n');
    }
    case 'noteAnchorBlock': {
      // 锚点块：保留 anchorId 于 URI，label 可见；导入侧不解析，锚点数据以 frontmatter 为准。
      const anchorId = cleanString(node.attrs?.anchorId);
      const label = cleanString(node.attrs?.label) || cleanString(node.attrs?.sourceTitle) || '锚点';
      const inner = serializeBlocks(node.content, ctx, '');
      const head = anchorId ? `> 📎 [${label}](paperquay://anchor/${anchorId})` : `> 📎 ${label}`;
      return inner ? `${head}\n${inner.split('\n').map((line) => `> ${line}`).join('\n')}` : head;
    }
    case 'image': {
      const src = cleanString(node.attrs?.src);
      return src ? `${indent}![image](${src})` : '';
    }
    default: {
      // 未知块（table/noteComponentBlock 等）：退化为纯文本，保证内容不丢。
      const text = serializeChildrenInline(node, ctx) || (typeof node.text === 'string' ? node.text : '');
      return text ? `${indent}${text}` : '';
    }
  }
}

function serializeBlocks(content, ctx, indent = '') {
  return (content ?? [])
    .map((child) => serializeBlock(child, ctx, indent))
    .filter((block) => block !== '')
    .join('\n\n');
}

// GB/T 7714-2015 顺序编码制（与 src/features/notes/bibliography.ts 同规则的精简移植；
// 后端无法 import TS，改动时请同步两侧）。
function formatGbt7714Entry(paper, fallbackLabel) {
  const clean = (value) => String(value ?? '').trim().replace(/[.。]+$/, '');
  if (!paper) return `${clean(fallbackLabel)}.`;
  const names = (Array.isArray(paper.authors) ? paper.authors : [])
    .map((author) => clean(typeof author === 'string' ? author : author?.name))
    .filter(Boolean);
  let authors = names.slice(0, 3).join(', ');
  if (names.length > 3) {
    const isCjk = names[0] && !/\s/.test(names[0]) && /[\u3000-\u9fff\uf900-\ufaff]/.test(names[0]);
    authors += isCjk ? ', 等' : ', et al.';
  }
  const title = clean(paper.title) || clean(fallbackLabel);
  const mark =
    paper.itemType === 'conferencePaper' ? 'C'
      : paper.itemType === 'book' || paper.itemType === 'bookSection' ? 'M'
        : paper.itemType === 'thesis' ? 'D'
          : paper.itemType === 'report' ? 'R'
            : paper.itemType === 'preprint' ? 'EB/OL'
              : clean(paper.publication) ? 'J' : 'EB/OL';
  const year = clean(paper.year);
  const publication = clean(paper.publication);
  const volume = clean(paper.volume);
  const issue = clean(paper.issue);
  const pages = clean(paper.pages);
  const doi = clean(paper.doi);

  let entry = authors ? `${authors}. ${title}` : title;
  entry += `[${mark}]`;
  if (mark === 'M') {
    const tail = [clean(paper.publisher), year].filter(Boolean).join(', ');
    if (tail) entry += `. ${tail}`;
    if (pages) entry += `: ${pages}`;
  } else if (mark === 'EB/OL') {
    const tail = [publication || clean(paper.publisher), year].filter(Boolean).join(', ');
    if (tail) entry += `. ${tail}`;
  } else {
    const volumeIssue = issue ? `${volume}(${issue})` : volume;
    const tail = [publication, year, volumeIssue].filter(Boolean).join(', ');
    if (tail) entry += `. ${tail}`;
    if (pages) entry += `: ${pages}`;
  }
  if (doi) entry += `. DOI: ${doi}`;
  return `${entry.replace(/[.。]+$/, '')}.`;
}

const REFERENCE_HEADING_TEXTS = new Set(['参考文献', 'references']);
const FENCE_LINE_PATTERN = /^\s*(?:(?:[-*+]|\d+[.)])\s+)?(`{3,}|~{3,})(.*)$/;

/** 标题的纯文本：去掉行内强调/代码/链接标记与 HTML 标签，供参考文献标题识别。 */
function headingPlainText(line) {
  const match = String(line ?? '').match(/^#{1,6}\s+(.*)$/);
  if (!match) return null;
  return match[1]
    .replace(/<[^>]*>/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]+/g, '')
    .replace(/\s+#+\s*$/, '')
    .trim();
}

function isReferenceHeadingLine(line) {
  const text = headingPlainText(line);
  return text !== null && REFERENCE_HEADING_TEXTS.has(text.toLowerCase());
}

function referenceHeadingLanguage(line) {
  return headingPlainText(line).toLowerCase() === 'references' ? 'References' : '参考文献';
}

/** 代码围栏状态；长度不短于开启围栏且无 info string 的行才关闭（CommonMark）。 */
function advanceFence(fence, line) {
  const match = String(line ?? '').match(FENCE_LINE_PATTERN);
  if (!fence) {
    return match ? { char: match[1][0], length: match[1].length } : null;
  }
  if (
    match &&
    match[1][0] === fence.char &&
    match[1].length >= fence.length &&
    match[2].trim() === ''
  ) {
    return null;
  }
  return fence;
}

function listMarkerOf(line) {
  const match = String(line ?? '').match(/^(\s*)([-*+]|\d+[.)])\s+/);
  if (!match) return null;
  return { indent: match[1].length, ordered: /\d/.test(match[2]) };
}

/**
 * 从 list 起始行扫描到列表结束：同级换成另一种标记（有序 ↔ 无序）即视为
 * 另一份列表；空行后只有同级同类的下一个条目才继续。缩进续行与嵌套列表
 * 属于同一份列表。返回最后一行下标。
 */
function scanReferenceList(lines, start) {
  const first = listMarkerOf(lines[start]);
  if (!first) return null;
  const baseIndent = first.indent;
  let end = start;
  let fence = null;

  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    const nextFence = advanceFence(fence, line);
    if (fence) {
      fence = nextFence;
      end = index;
      continue;
    }
    if (nextFence) {
      const fenceMarker = listMarkerOf(line);
      // 顶格的普通围栏是列表之后的新代码块，不属于这份列表。
      if (!fenceMarker && !/^\s+/.test(line)) break;
      fence = nextFence;
      end = index;
      continue;
    }

    const marker = listMarkerOf(line);
    if (marker) {
      if (marker.indent < baseIndent) break;
      if (marker.indent === baseIndent && marker.ordered !== first.ordered) break;
      end = index;
      continue;
    }

    if (!line.trim()) {
      // serializeBlocks 用空行分隔两个列表块；同一列表的条目之间不会出现
      // 空行（条目的多段内容会被过滤成续行），因此空行后的列表是另一份列表。
      break;
    }

    // 列表项的续行；标题或新的代码围栏意味着列表已结束。
    if (/^#{1,6}\s+/.test(line)) break;
    end = index;
  }

  return { end };
}

/**
 * 导出前剔除已有的参考文献小节（标题 + 紧邻列表）。
 *
 * 旧导出把规范列表写进笔记正文，回导后它变成普通 heading/list；再次导出
 * 若不识别就会追加第二份列表，中英标题并存时还会同时出现两份。
 * 只处理「标题后紧跟列表」或空标题：标题后是正文时视为用户手写小节，
 * 保留正文并停止追加规范列表，避免出现两个同名标题。
 * 代码围栏内的同名标题是代码内容，必须跳过；围栏长度与 info string 按
 * CommonMark 处理，列表项内的代码块同样跳过。
 * 返回首个被删标题的语言，让规范列表沿用笔记原有语言（References/参考文献）。
 */
function stripExistingReferenceSections(markdown) {
  const lines = String(markdown ?? '').split('\n');
  const removed = new Set();
  let headingLanguage = null;
  let preserveExisting = false;
  let fence = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const nextFence = advanceFence(fence, line);
    if (fence || nextFence) {
      fence = nextFence;
      continue;
    }
    if (!isReferenceHeadingLine(line)) continue;

    let cursor = index + 1;
    while (cursor < lines.length && lines[cursor].trim() === '') cursor += 1;

    const emptySection = cursor >= lines.length || isReferenceHeadingLine(lines[cursor]);
    if (emptySection) {
      if (headingLanguage === null) headingLanguage = referenceHeadingLanguage(line);
      removed.add(index);
      continue;
    }

    if (!listMarkerOf(lines[cursor])) {
      // 标题后是正文：用户手写小节，原样保留，不再追加第二份规范列表。
      preserveExisting = true;
      continue;
    }

    const block = scanReferenceList(lines, cursor);
    if (!block) continue;
    if (headingLanguage === null) headingLanguage = referenceHeadingLanguage(line);
    for (let remove = index; remove <= block.end; remove += 1) removed.add(remove);
    index = block.end;
  }

  if (removed.size === 0) return { body: markdown, headingLanguage: null, preserveExisting };
  return {
    body: lines
      .filter((_, index) => !removed.has(index))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\s+$/u, ''),
    headingLanguage,
    preserveExisting,
  };
}

// 笔记正文 Markdown：优先从 contentJson 序列化（保引用编号/锚点链接），无 JSON 时用纯文本。
function serializeNoteMarkdown(note, papersById, notesById = new Map()) {
  let json = note.contentJson;
  if (typeof json === 'string') {
    try {
      json = JSON.parse(json);
    } catch {
      json = null;
    }
  }
  if (!json || typeof json !== 'object' || !Array.isArray(json.content)) {
    return noteBody(note);
  }
  const ctx = { refNumberByPaperId: new Map(), refs: [], notesById };
  const body = serializeBlocks(json.content, ctx);
  // ctx.refs 为空时保留用户手写的参考文献列表，不做任何剔除。
  if (ctx.refs.length === 0) return body;
  const { body: strippedBody, headingLanguage, preserveExisting } = stripExistingReferenceSections(body);
  // 已有手写参考文献正文时保留用户小节，不再追加第二份同名列表。
  if (preserveExisting) return strippedBody;
  // 文末追加规范参考文献列表（编号与内联 [n] 同源同序），标题沿用笔记已有语言。
  const lines = ctx.refs.map(
    (ref, index) => `${index + 1}. ${formatGbt7714Entry(papersById.get(ref.paperId), ref.label)}`,
  );
  const heading = headingLanguage ?? '参考文献';
  return `${strippedBody ? `${strippedBody}\n\n` : ''}## ${heading}\n\n${lines.join('\n')}`;
}

function buildNoteFileContent(note, folderPath, papersById, notesById = new Map()) {
  const frontmatter = encodeFrontmatter({
    id: note.id,
    type: note.type,
    pageKind: note.pageKind ?? null,
    paperId: note.paperId,
    folder: folderPath || null,
    tags: Array.isArray(note.tags) ? note.tags : [],
    sources: Array.isArray(note.linkedPaperIds) ? note.linkedPaperIds : [],
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    anchors: Array.isArray(note.anchors) ? note.anchors : [],
  });
  const body = serializeNoteMarkdown(note, papersById, notesById);
  return `${frontmatter}\n\n${body}${body ? '\n' : ''}`;
}

function buildFolderPath(folderId, foldersById) {
  const names = [];
  let current = folderId ? foldersById.get(folderId) : null;
  let guard = 32;
  while (current && guard > 0) {
    guard -= 1;
    names.unshift(sanitizePathSegment(current.name));
    current = current.parentId ? foldersById.get(current.parentId) : null;
  }
  return names.join('/');
}

function createNoteVault(context) {
  const { noteStore, store } = context;

  function getSettings() {
    const library = store.load();
    return {
      dir: cleanString(library.settings?.notesVaultDir),
      updatedAtMs: Number(library.settings?.notesVaultUpdatedAtMs) || 0,
    };
  }

  async function updateSettings(settings) {
    const library = store.load();
    library.settings = {
      ...library.settings,
      notesVaultDir: cleanString(settings?.dir),
      notesVaultUpdatedAtMs: now(),
    };
    // 只写设置；整库保存会用旧快照覆盖并发的桌面/MCP 写入。
    await store.saveSettings(library.settings);
    return {
      dir: library.settings.notesVaultDir,
      updatedAtMs: library.settings.notesVaultUpdatedAtMs,
    };
  }

  function resolveFolderByPath(segments, folders, createdFolders) {
    let parentId = null;
    for (const segment of segments) {
      const name = cleanString(segment);
      if (!name) continue;
      const existing = folders.find(
        (folder) =>
          (folder.parentId ?? null) === parentId &&
          folder.name.toLowerCase() === name.toLowerCase(),
      );
      if (existing) {
        parentId = existing.id;
        continue;
      }
      const created = noteStore.createFolder({ name, parentId });
      folders.push(created);
      createdFolders.push(created);
      parentId = created.id;
    }
    return parentId;
  }

  // 单次同步删除文件的熔断阈值：删除数超过受管文件总数的 5% 或超过 20 个时，
  // 必须由调用方带入 confirmRemoval 才真正删除，避免「截断列表/异常数据」造成批量误删。
  const REMOVAL_CONFIRM_MIN_COUNT = 20;
  const REMOVAL_CONFIRM_RATIO = 0.05;

  function* syncVaultFlow(vaultDir, options, stats) {
    yield { type: 'mkdir', dir: vaultDir };

    const manifest = yield* loadManifestFlow(vaultDir);
    const createdFolders = [];
    const conflictNotes = new Set();
    const libraryPapers = store.load()?.papers;
    const papersById = new Map(
      (Array.isArray(libraryPapers) ? libraryPapers : []).map((paper) => [paper.id, paper]),
    );

    // ---- 阶段 1：导入（vault → DB）----
    const files = yield* listMarkdownFilesFlow(vaultDir);
    yield YIELD_OPERATION;
    let folders = noteStore.listFolders();
    // 同步必须看到全量笔记：listNotes 默认只返回 500 条，用它做后续清理判断会误删文件。
    let notes = noteStore.listAllNotes({ includeDeleted: false });
    // 全量水合是同步大块，先让出事件循环再继续后续 CPU。
    yield YIELD_OPERATION;
    // 标题索引只给 wikiLink 解析用，增量维护；不再在每个文件里重建 O(N) 的 Map。
    const notesById = new Map(notes.map((item) => [item.id, item]));
    const noteIndexById = new Map(notes.map((item, index) => [item.id, index]));
    const upsertLocalNote = (note) => {
      const index = noteIndexById.get(note.id);
      if (index === undefined) {
        noteIndexById.set(note.id, notes.length);
        notes.push(note);
      } else {
        notes[index] = note;
      }
      notesById.set(note.id, note);
    };
    for (const rel of files) {
      const abs = path.join(vaultDir, rel);
      let raw;
      let stat;
      try {
        raw = yield { type: 'readFile', abs, encoding: 'utf8' };
        stat = yield { type: 'stat', abs };
      } catch {
        stats.skipped += 1;
        continue;
      }
      const { fields, body } = decodeFrontmatter(raw);
      const noteId = cleanString(fields.id);
      const titleFromFile = cleanString(
        path.basename(rel, path.extname(rel)).replace(/--[A-Za-z0-9_-]{4,}$/, ''),
      );
      const contentText = body.replace(/^\n+/, '').replace(/\s+$/u, '');
      const dirSegments = path.posix
        .dirname(rel)
        .split('/')
        .filter((seg) => seg && seg !== '.');
      const tags = Array.isArray(fields.tags)
        ? fields.tags.map((tag) => cleanString(String(tag)).replace(/^#/, '')).filter(Boolean)
        : [];

      if (noteId) {
        const existing = noteStore.getNote({ id: noteId });
        if (!existing) {
          // 笔记已在应用内删除；不复活，文件留给用户自行处理。
          stats.skipped += 1;
          continue;
        }
        const contentChanged =
          serializeNoteMarkdown(existing, papersById, notesById) !== contentText ||
          cleanString(existing.title) !== titleFromFile;
        const meta = manifest.metadata[noteId] || {};
        const fileHash = contentHash(raw);
        const fileChangedSinceExport = meta.contentHash
          ? meta.contentHash !== fileHash
          : contentChanged;
        const fileUpdatedAt = Number(fields.updatedAt) || stat.mtimeMs;
        const exportedUpdatedAt = Number(meta.exportedUpdatedAt) || Number(fields.updatedAt) || 0;
        const dbChangedSinceExport = Boolean(meta.exportedUpdatedAt) &&
          Number(existing.updatedAt) > exportedUpdatedAt;
        const fileIsNewer = fileUpdatedAt > Number(existing.updatedAt) + 1000 ||
          (!meta.exportedUpdatedAt && stat.mtimeMs > Number(existing.updatedAt) + 1000);

        if (contentChanged && fileChangedSinceExport && dbChangedSinceExport) {
          const conflictRel = conflictPath(rel, Date.now());
          const conflictAbs = path.join(vaultDir, conflictRel);
          yield { type: 'mkdir', dir: path.dirname(conflictAbs) };
          yield { type: 'writeFile', abs: conflictAbs, data: raw };
          stats.conflicts += 1;
          stats.skipped += 1;
          conflictNotes.add(noteId);
        } else if (contentChanged && (fileIsNewer || fileChangedSinceExport)) {
          const folderId = resolveFolderByPath(dirSegments, folders, createdFolders);
          const saved = noteStore.updateNote({
            id: noteId,
            patch: {
              title: titleFromFile || existing.title,
              content: contentText,
              contentText,
              contentJson: parseMarkdownToTiptap(contentText, {
                anchors: Array.isArray(fields.anchors) ? fields.anchors : existing.anchors,
                papers: Array.isArray(libraryPapers) ? libraryPapers : [],
                notes,
              }),
              contentHtml: null,
              tags: Array.isArray(fields.tags) ? tags : existing.tags,
              pageKind: fields.pageKind ?? existing.pageKind ?? null,
              folderId,
            },
          });
          stats.imported += 1;
          stats.updated += 1;
          upsertLocalNote(saved);
        } else {
          stats.skipped += 1;
        }
      } else {
        // 无 id 的新文件 → 新笔记。
        const folderId = resolveFolderByPath(dirSegments, folders, createdFolders);
        const created = noteStore.createNote({
          paperId: 'global-notes',
          type: 'standalone',
          pageKind: fields.pageKind ?? null,
          title: titleFromFile,
          content: contentText,
          contentText,
          contentJson: parseMarkdownToTiptap(contentText, {
            anchors: Array.isArray(fields.anchors) ? fields.anchors : [],
            papers: Array.isArray(libraryPapers) ? libraryPapers : [],
            notes,
          }),
          contentHtml: null,
          tags,
          folderId,
        });
        stats.imported += 1;
        stats.created += 1;
        manifest.files[created.id] = rel;
        upsertLocalNote(created);
      }
    }

    // ---- 阶段 2：导出（DB → vault）----
    yield YIELD_OPERATION;
    folders = noteStore.listFolders();
    const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
    notes = noteStore.listAllNotes({ includeDeleted: false });
    // 阶段 2 的 wikiLink 解析索引只建一次；notes 在本阶段不再变化。
    const exportNotesById = new Map(notes.map((item) => [item.id, item]));
    yield YIELD_OPERATION;

    for (const note of notes) {
      if (conflictNotes.has(note.id)) continue;
      const folderPath = buildFolderPath(note.folderId, foldersById);
      const baseName = sanitizeFileName(note.title);
      const expectedPrefix = folderPath ? `${folderPath}/` : '';
      // 标题或文件夹变化都让文件名跟随，旧文件在下方按 manifest 清理。
      let rel = `${expectedPrefix}${baseName}.md`;

      const content = buildNoteFileContent(note, folderPath, papersById, exportNotesById);
      let existingContent = null;
      try {
        existingContent = yield { type: 'readFile', abs: path.join(vaultDir, rel), encoding: 'utf8' };
      } catch {
        existingContent = null;
      }

      if (existingContent !== content) {
        // 同名冲突判定：文件已存在、且不属于本笔记（manifest 未登记、内容里也没有本笔记的
        // frontmatter id）时才追加短 id 后缀；刚导入的、还没来得及写 frontmatter 的文件
        // 是本笔记自己的文件，直接原地写入。
        const isOwnFile =
          manifest.files[note.id] === rel ||
          (existingContent !== null && existingContent.includes(`id: ${note.id}\n`));
        if (existingContent !== null && !isOwnFile) {
          rel = `${expectedPrefix}${baseName}--${note.id.slice(-6)}.md`;
        }
        const abs = path.join(vaultDir, rel);
        yield { type: 'mkdir', dir: path.dirname(abs) };
        yield { type: 'writeFile', abs, data: content };
        // mtime 对齐 updatedAt，让阶段 1 的新旧比较在下次同步时稳定。
        const mtime = new Date(Number(note.updatedAt) || Date.now());
        try {
          yield { type: 'utimes', abs, mtime };
        } catch {
          // utimes 失败不影响正确性，只是下次同步可能多一次导入判断。
        }
        stats.exported += 1;
      }

      // 旧路径（重命名/移动后）清理。
      const previousRel = manifest.files[note.id];
      if (previousRel && previousRel !== rel) {
        try {
          yield { type: 'remove', abs: path.join(vaultDir, previousRel) };
        } catch {
          // 忽略清理失败。
        }
      }

      manifest.files[note.id] = rel;
      manifest.metadata[note.id] = {
        exportedUpdatedAt: Number(note.updatedAt) || now(),
        contentHash: contentHash(content),
      };
    }

    // ---- 阶段 3：清理 manifest 里已不存在笔记对应的文件 ----
    // 只按 id 存在性判断，且 notes 来自 listAllNotes（全量），不会因为列表截断误删。
    const liveNoteIds = new Set(notes.map((note) => note.id));
    const pendingRemovals = Object.entries(manifest.files)
      .filter(([noteId]) => !liveNoteIds.has(noteId));
    const managedFileCount = Object.keys(manifest.files).length;
    const removalNeedsConfirmation =
      pendingRemovals.length > REMOVAL_CONFIRM_MIN_COUNT ||
      (managedFileCount > 0 &&
        pendingRemovals.length / managedFileCount > REMOVAL_CONFIRM_RATIO);
    stats.pendingRemovals = pendingRemovals.length;

    if (pendingRemovals.length > 0 && removalNeedsConfirmation && options.confirmRemoval !== true) {
      // 熔断：本轮不删文件、不改 manifest，保留待清理条目供用户确认后重试。
      stats.removalConfirmationRequired = true;
    } else {
      stats.removalConfirmationRequired = false;
      for (const [noteId, rel] of pendingRemovals) {
        try {
          yield { type: 'remove', abs: path.join(vaultDir, rel) };
          stats.removed += 1;
        } catch {
          // 忽略清理失败。
        }
        delete manifest.files[noteId];
        delete manifest.metadata[noteId];
      }
      stats.pendingRemovals = 0;
    }

    yield* saveManifestFlow(vaultDir, manifest);
    stats.total = notes.length;
    stats.createdFolders = createdFolders.length;
    return stats;
  }

  // 正在运行的调度器同步（background:true）。禁用自动同步时由 cancelAutoSync()
  // 请求中止；同一时刻只跟踪最新一次自动同步（重叠同步不应发生）。
  let activeAutoSync = null;

  // 返回 stats（小 vault，同步完成）或 Promise<stats>（大 vault / 后台模式）。
  // 调用方统一 await 即可兼容两种返回；直接读取属性的旧调用只在小 vault 下成立。
  function syncNow(options = {}) {
    const settings = getSettings();
    const vaultDir = settings.dir;
    if (!vaultDir) {
      throw new Error('笔记 vault 目录未配置，请先在设置中选择目录。');
    }

    const stats = createSyncStats(vaultDir);
    const externalCancelled = createCancellationCheck(options);
    const handle = {
      requested: false,
      cancel() {
        handle.requested = true;
      },
    };
    const shouldCancel = () =>
      handle.requested || Boolean(externalCancelled && externalCancelled());
    const driveOptions = {
      stats,
      shouldCancel,
      background: options.background === true,
    };
    const run = () => driveFlow(syncVaultFlow(vaultDir, options, stats), driveOptions);

    if (options.background === true) {
      // 后台（调度器）同步：登记到 activeAutoSync；从微任务 + 异步驱动起步，
      // 调用栈内不做文件 IO。
      activeAutoSync = handle;
      return Promise.resolve()
        .then(run)
        .finally(() => {
          if (activeAutoSync === handle) activeAutoSync = null;
        });
    }
    return run();
  }

  // 中止在跑的调度器同步；返回是否确有任务被请求取消。手动同步不受影响。
  function cancelAutoSync() {
    if (!activeAutoSync) return false;
    activeAutoSync.cancel();
    return true;
  }

  return {
    getSettings,
    syncNow,
    updateSettings,
    cancelAutoSync,
  };
}

module.exports = {
  createNoteVault,
  decodeFrontmatter,
  encodeFrontmatter,
  sanitizeFileName,
  serializeNoteMarkdown,
  // 驱动层导出供测试注入假 IO 基准（1000 文件让出断言）。
  driveFlow,
  ASYNC_CHUNK_IO,
  SYNC_IO_BUDGET,
};
