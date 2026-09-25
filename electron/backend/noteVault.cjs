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
      lines.push(`${key}: ${/[:#\[\]{}"\n]/.test(text) ? JSON.stringify(text) : text}`);
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

function loadManifest(vaultDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(vaultDir, VAULT_MANIFEST_NAME), 'utf8'));
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

function saveManifest(vaultDir, manifest) {
  fs.writeFileSync(
    path.join(vaultDir, VAULT_MANIFEST_NAME),
    JSON.stringify({ version: 2, files: manifest.files, metadata: manifest.metadata, updatedAt: now() }, null, 2),
  );
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

function listMarkdownFiles(rootDir) {
  const result = [];
  const stack = [''];
  while (stack.length > 0) {
    const rel = stack.pop();
    const abs = rel ? path.join(rootDir, rel) : rootDir;
    let entries = [];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
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
    const label = cleanString(node.attrs?.label) || cleanString(node.attrs?.title) || '';
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
    const isCjk = names[0] && !/\s/.test(names[0]) && /[　-鿿豈-﫿]/.test(names[0]);
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

// 笔记正文 Markdown：优先从 contentJson 序列化（保引用编号/锚点链接），无 JSON 时用纯文本。
function serializeNoteMarkdown(note, papersById) {
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
  const ctx = { refNumberByPaperId: new Map(), refs: [] };
  const body = serializeBlocks(json.content, ctx);
  if (ctx.refs.length === 0) return body;
  // 文末追加规范参考文献列表（编号与内联 [n] 同源同序）。
  const lines = ctx.refs.map(
    (ref, index) => `${index + 1}. ${formatGbt7714Entry(papersById.get(ref.paperId), ref.label)}`,
  );
  return `${body}\n\n## 参考文献\n\n${lines.join('\n')}`;
}

function buildNoteFileContent(note, folderPath, papersById) {
  const frontmatter = encodeFrontmatter({
    id: note.id,
    type: note.type,
    paperId: note.paperId,
    folder: folderPath || null,
    tags: Array.isArray(note.tags) ? note.tags : [],
    sources: Array.isArray(note.linkedPaperIds) ? note.linkedPaperIds : [],
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    anchors: Array.isArray(note.anchors) ? note.anchors : [],
  });
  const body = serializeNoteMarkdown(note, papersById);
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
    await store.save(library);
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

  function syncNow() {
    const settings = getSettings();
    const vaultDir = settings.dir;
    if (!vaultDir) {
      throw new Error('笔记 vault 目录未配置，请先在设置中选择目录。');
    }
    fs.mkdirSync(vaultDir, { recursive: true });

    const manifest = loadManifest(vaultDir);
    const stats = {
      vaultDir,
      exported: 0,
      imported: 0,
      created: 0,
      updated: 0,
      removed: 0,
      skipped: 0,
      conflicts: 0,
    };
    const createdFolders = [];
    const conflictNotes = new Set();
    const libraryPapers = store.load()?.papers;
    const papersById = new Map(
      (Array.isArray(libraryPapers) ? libraryPapers : []).map((paper) => [paper.id, paper]),
    );

    // ---- 阶段 1：导入（vault → DB）----
    const files = listMarkdownFiles(vaultDir);
    let folders = noteStore.listFolders();
    let notes = noteStore.listNotes({ includeDeleted: false });
    for (const rel of files) {
      const abs = path.join(vaultDir, rel);
      let raw;
      let stat;
      try {
        raw = fs.readFileSync(abs, 'utf8');
        stat = fs.statSync(abs);
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
          serializeNoteMarkdown(existing, papersById) !== contentText ||
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
          fs.mkdirSync(path.dirname(conflictAbs), { recursive: true });
          fs.writeFileSync(conflictAbs, raw);
          stats.conflicts += 1;
          stats.skipped += 1;
          conflictNotes.add(noteId);
        } else if (contentChanged && (fileIsNewer || fileChangedSinceExport)) {
          const folderId = resolveFolderByPath(dirSegments, folders, createdFolders);
          noteStore.updateNote({
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
              folderId,
            },
          });
          stats.imported += 1;
          stats.updated += 1;
          notes = noteStore.listNotes({ includeDeleted: false });
        } else {
          stats.skipped += 1;
        }
      } else {
        // 无 id 的新文件 → 新笔记。
        const folderId = resolveFolderByPath(dirSegments, folders, createdFolders);
        const created = noteStore.createNote({
          paperId: 'global-notes',
          type: 'standalone',
          title: titleFromFile || '未命名笔记',
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
        notes = noteStore.listNotes({ includeDeleted: false });
      }
    }

    // ---- 阶段 2：导出（DB → vault）----
    folders = noteStore.listFolders();
    const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
    notes = noteStore.listNotes({ includeDeleted: false });

    for (const note of notes) {
      if (conflictNotes.has(note.id)) continue;
      const folderPath = buildFolderPath(note.folderId, foldersById);
      const baseName = sanitizeFileName(note.title);
      const expectedPrefix = folderPath ? `${folderPath}/` : '';
      // 标题或文件夹变化都让文件名跟随，旧文件在下方按 manifest 清理。
      let rel = `${expectedPrefix}${baseName}.md`;

      const content = buildNoteFileContent(note, folderPath, papersById);
      let existingContent = null;
      try {
        existingContent = fs.readFileSync(path.join(vaultDir, rel), 'utf8');
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
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content);
        // mtime 对齐 updatedAt，让阶段 1 的新旧比较在下次同步时稳定。
        const mtime = new Date(Number(note.updatedAt) || Date.now());
        try {
          fs.utimesSync(abs, mtime, mtime);
        } catch {
          // utimes 失败不影响正确性，只是下次同步可能多一次导入判断。
        }
        stats.exported += 1;
      }

      // 旧路径（重命名/移动后）清理。
      const previousRel = manifest.files[note.id];
      if (previousRel && previousRel !== rel) {
        try {
          fs.rmSync(path.join(vaultDir, previousRel), { force: true });
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
    for (const [noteId, rel] of Object.entries(manifest.files)) {
      if (!notes.some((note) => note.id === noteId)) {
        try {
          fs.rmSync(path.join(vaultDir, rel), { force: true });
          stats.removed += 1;
        } catch {
          // 忽略清理失败。
        }
        delete manifest.files[noteId];
        delete manifest.metadata[noteId];
      }
    }

    saveManifest(vaultDir, manifest);
    stats.total = notes.length;
    stats.createdFolders = createdFolders.length;
    return stats;
  }

  return {
    getSettings,
    syncNow,
    updateSettings,
  };
}

module.exports = {
  createNoteVault,
  decodeFrontmatter,
  encodeFrontmatter,
  sanitizeFileName,
  serializeNoteMarkdown,
};
