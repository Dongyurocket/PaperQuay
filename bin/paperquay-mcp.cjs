#!/usr/bin/env node

/**
 * PaperQuay Knowledge Base MCP Server (Stdio)
 *
 * Designed for Proma, Pi, Codex, Claude Code, and any Model Context Protocol compliant agents.
 * Read tools connect read-only to PaperQuay local SQLite databases for fast, conflict-free retrieval.
 * Write tools (import_pdfs, manage_category, set_paper_categories, update_paper, delete_papers)
 * go through the shared library store and are refused while the PaperQuay desktop app is running,
 * unless allowWhileAppRunning: true is passed explicitly.
 */

const readline = require('node:readline');
const { PaperQuayKnowledgeService } = require('../electron/mcp/knowledgeMcpService.cjs');

// ELECTRON_RUN_AS_NODE 模式下本进程的映像名仍是 PaperQuay.exe。改写进程标题让
// Linux/macOS 的 pgrep -x PaperQuay 不匹配本服务进程（写护栏自误报防护的一环；
// Windows 映像名不受 process.title 影响，由 detectDesktopAppRunning 按 PID/命令行排除）。
try {
  process.title = 'paperquay-mcp';
} catch {
  // 部分平台不支持改写进程标题，忽略。
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

const options = parseArgs();
const service = new PaperQuayKnowledgeService({ dataDir: options.dataDir });

const SERVER_NAME = 'paperquay-knowledge-mcp';
const SERVER_VERSION = require('../package.json').version;

const ALLOW_WHILE_APP_RUNNING_SCHEMA = {
  type: 'boolean',
  description:
    'Allow a checked parallel write while the PaperQuay desktop app is running (default false). When true, writes must carry the version they read (expectedUpdatedAt, expectedCategoryVersions, or previewVersion); a stale version is rejected with PAPER_CONFLICT/NOTE_CONFLICT instead of overwriting. Prefer closing the app when you cannot re-read versions.',
  default: false,
};

const EXPECTED_UPDATED_AT_SCHEMA = {
  type: ['number', 'object'],
  description:
    'The updatedAt value read from get_paper_details/list_categories. Required while PaperQuay is running. A single number applies to one record; an object maps paperId to updatedAt for batch tools. A mismatch is rejected with PAPER_CONFLICT and the current updatedAt.',
};

const TOOLS = [
  {
    name: 'search_papers',
    description:
      'Search papers in the PaperQuay literature library by title, Chinese title, authors, publication, DOI, tags, or keywords. Each paper includes ragEnabled: false means the paper is excluded from the local RAG index.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keywords to search in title, author, venue, abstract, or keywords.',
        },
        tag: {
          type: 'string',
          description: 'Filter by a specific tag name.',
        },
        categoryId: {
          type: 'string',
          description: 'Filter by a category ID (see list_categories). Non-system categories include their descendants; system categories all/recent/uncategorized/favorites follow the app semantics.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of papers to return (default 10, max 50).',
          default: 10,
        },
      },
    },
  },
  {
    name: 'get_paper_details',
    description:
      'Get complete bibliographic metadata, abstract, notes, citations, and attachments for a specific paper by its paperId. Includes ragEnabled (false means excluded from the local RAG index). attachments include id, kind, storedPath, relativePath, fileName, fileSize, and missing. kind "translated-pdf" is the single translated PDF attached for side-by-side reading; kind "pdf" is the original file.',
    inputSchema: {
      type: 'object',
      properties: {
        paperId: {
          type: 'string',
          description: 'The unique ID of the paper in PaperQuay.',
        },
      },
      required: ['paperId'],
    },
  },
  {
    name: 'search_knowledge_base',
    description:
      'Hybrid semantic + full-text search across the PaperQuay RAG knowledge base. Papers excluded from the local RAG index do not appear. When an embedding API is configured in PaperQuay reader settings, the query is vectorized and fused with FTS5 keyword results via reciprocal rank fusion; otherwise it falls back to keyword-only search. Returns grounded text snippets with paper title, page number, block ID, relevance score, and the retrieval channels that matched each snippet.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query or concept to look up in the parsed paper text.',
        },
        paperId: {
          type: 'string',
          description: 'Optional paper ID to narrow down search to a single document.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of evidence snippets to return (default 8, max 30).',
          default: 8,
        },
        mode: {
          type: 'string',
          enum: ['auto', 'hybrid', 'keyword'],
          description:
            "Retrieval mode. 'auto' (default) uses vector hybrid retrieval when an embedding API is configured, otherwise keyword-only. 'hybrid' requires vector retrieval and reports a warning when unavailable. 'keyword' forces FTS5 keyword-only search.",
          default: 'auto',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_paper_content',
    description:
      'Read structured content chunks from a paper in the knowledge base, optionally filtered by page index. Papers excluded from the local RAG index return no chunks.',
    inputSchema: {
      type: 'object',
      properties: {
        paperId: {
          type: 'string',
          description: 'The unique ID of the paper.',
        },
        pageIndex: {
          type: 'integer',
          description: '0-based page index to read chunks from a specific page.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum chunks to return (default 20, max 100).',
          default: 20,
        },
      },
      required: ['paperId'],
    },
  },
  {
    name: 'search_notes',
    description:
      'Search PaperQuay notes using vector + FTS5 + RRF when the reader Embedding API is configured; otherwise use keyword retrieval. Returns retrievalMode, channels and degradation warning.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural-language question or keywords to search in note titles and editable contents.',
        },
        mode: {
          type: 'string', enum: ['auto', 'hybrid', 'keyword'], default: 'auto',
          description: 'Retrieval mode; keyword never calls the Embedding API.',
        },
        pageKind: {
          type: 'string',
          enum: ['paper-card', 'concept', 'synthesis', 'qa', 'excerpt', 'index', 'log', 'overview'],
          description: 'Filter notes by page kind in both retrieval channels.',
        },
        paperId: {
          type: 'string',
          description: 'Filter notes linked to a specific paper ID.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum notes to return (default 10).',
          default: 10,
        },
      },
    },
  },
  {
    name: 'get_note',
    description: 'Read a note and its source metadata. Text is paginated; use nextOffset until null.',
    inputSchema: {
      type: 'object',
      properties: {
        noteId: { type: 'string', description: 'Note ID returned by search_notes.' },
        offset: { type: 'integer', minimum: 0, default: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 20000, default: 12000 },
      },
      required: ['noteId'],
    },
  },
  {
    name: 'create_note',
    description:
      'Create a new PaperQuay note. Tags and [[wiki-links]] inside the content are extracted automatically, the full-text index is updated, and the note is linked to a paper when paperId is given (otherwise it becomes a global note). Refused while the PaperQuay desktop app is running unless allowWhileAppRunning is true (the app UI holds an in-memory snapshot and will not show external writes until reload).',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Note title. Falls back to "Untitled Note" when empty but content is given.',
        },
        content: {
          type: 'string',
          description: 'Note body as Markdown/plain text. #tags and [[note titles]] inside are parsed into tags and wiki links.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Explicit tags (leading # is stripped). Merged with #tags found in the content.',
        },
        paperId: {
          type: 'string',
          description: 'Paper ID to attach the note to. Omit for a global note.',
        },
        type: {
          type: 'string',
          enum: ['standalone', 'highlight', 'area', 'ai-chat'],
          description: 'Note type; defaults to standalone.',
        },
        pageKind: {
          type: 'string',
          enum: ['paper-card', 'concept', 'synthesis', 'qa', 'excerpt', 'index', 'log', 'overview'],
          description: 'Structural page kind.',
        },
        folderId: {
          type: 'string',
          description: 'Note folder ID (see list_note_folders). Omit for uncategorized.',
        },
        allowWhileAppRunning: ALLOW_WHILE_APP_RUNNING_SCHEMA,
      },
    },
  },
  {
    name: 'update_note',
    description:
      'Update an existing note by noteId. Only the provided fields change: title, content (Markdown/plain text; the shared Markdown parser rebuilds the stored rich-text JSON and clears the HTML cache), tags (full replacement, leading # stripped), pageKind (pass an empty string to clear it), and/or folderId (pass an empty string to move the note to uncategorized). If the note already has anchors, a content update MUST keep every paperquay://anchor/<id> link; otherwise the write is rejected with NOTE_ANCHOR_MISSING and only metadata fields may change. Pass expectedUpdatedAt from get_note while PaperQuay is running; a mismatch returns NOTE_CONFLICT. At least one field is required.',
    inputSchema: {
      type: 'object',
      properties: {
        noteId: { type: 'string', description: 'The unique ID of the note (see search_notes).' },
        title: { type: 'string' },
        content: { type: 'string', description: 'New note body as Markdown/plain text; rebuilt into rich-text JSON at write time.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Full tag list, replacing the existing one.' },
        pageKind: {
          type: 'string',
          enum: ['paper-card', 'concept', 'synthesis', 'qa', 'excerpt', 'index', 'log', 'overview'],
          description: 'Structural page kind; pass an empty string to clear it.',
        },
        folderId: { type: 'string', description: 'Move the note into this folder (see list_note_folders); empty string moves it to uncategorized.' },
        expectedUpdatedAt: {
          type: 'number',
          description: 'Note updatedAt from get_note. Required while PaperQuay is running; a mismatch returns NOTE_CONFLICT with the current updatedAt.',
        },
        allowWhileAppRunning: ALLOW_WHILE_APP_RUNNING_SCHEMA,
      },
      required: ['noteId'],
    },
  },
  {
    name: 'delete_note',
    description:
      'Soft-delete a note by noteId (the note is marked deleted and removed from the full-text index). Refused while the PaperQuay desktop app is running unless allowWhileAppRunning is true.',
    inputSchema: {
      type: 'object',
      properties: {
        noteId: { type: 'string', description: 'The unique ID of the note (see search_notes).' },
        expectedUpdatedAt: {
          type: 'number',
          description: 'Note updatedAt from get_note. Required while PaperQuay is running.',
        },
        allowWhileAppRunning: ALLOW_WHILE_APP_RUNNING_SCHEMA,
      },
      required: ['noteId'],
    },
  },
  {
    name: 'list_note_tags',
    description:
      'List all note tags with usage counts, optionally filtered to notes of one paper. Read-only. Use it to discover existing tags before create_note/update_note.',
    inputSchema: {
      type: 'object',
      properties: {
        paperId: {
          type: 'string',
          description: 'Optional paper ID to only count tags on that paper\'s notes.',
        },
      },
    },
  },
  {
    name: 'list_note_folders',
    description:
      'List the note folder tree (id, name, parentId, sortOrder, updatedAt). Read-only. Use it to discover folderId values and version snapshots before create_note/update_note/create_note_folder/rename_note_folder/delete_note_folder.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'create_note_folder',
    description:
      'Create a note folder, optionally nested under parentId. Refused while the PaperQuay desktop app is running unless allowWhileAppRunning is true.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Folder name.' },
        parentId: { type: 'string', description: 'Optional parent folder ID (see list_note_folders).' },
        allowWhileAppRunning: ALLOW_WHILE_APP_RUNNING_SCHEMA,
      },
      required: ['name'],
    },
  },
  {
    name: 'rename_note_folder',
    description:
      'Rename a note folder by folderId. Pass expectedUpdatedAt from list_note_folders; required while PaperQuay is running and a mismatch returns NOTE_CONFLICT.',
    inputSchema: {
      type: 'object',
      properties: {
        folderId: { type: 'string', description: 'The unique ID of the folder (see list_note_folders).' },
        name: { type: 'string', description: 'New folder name.' },
        expectedUpdatedAt: {
          type: 'number',
          description: 'Folder updatedAt from list_note_folders. Required while PaperQuay is running.',
        },
        allowWhileAppRunning: ALLOW_WHILE_APP_RUNNING_SCHEMA,
      },
      required: ['folderId', 'name'],
    },
  },
  {
    name: 'delete_note_folder',
    description:
      'Delete a note folder and all its subfolders; notes inside are moved to uncategorized (not deleted). Returns deleted folder IDs, affected note IDs and their new updatedAt. While PaperQuay is running, pass expectedUpdatedAt and expectedFolderVersions; any changed version rejects the whole delete.',
    inputSchema: {
      type: 'object',
      properties: {
        folderId: { type: 'string', description: 'The unique ID of the folder (see list_note_folders).' },
        expectedUpdatedAt: {
          type: 'number',
          description: 'Target folder updatedAt from list_note_folders. Required while PaperQuay is running.',
        },
        expectedFolderVersions: {
          type: 'object',
          description: 'Version snapshot { folderId: updatedAt } covering the target folder and every descendant. Any changed version rejects the whole delete.',
        },
        allowWhileAppRunning: ALLOW_WHILE_APP_RUNNING_SCHEMA,
      },
      required: ['folderId'],
    },
  },
  {
    name: 'zotero_list_collections',
    description:
      'List collections/folders from the local Zotero library, including item counts and hierarchical keys.',
    inputSchema: {
      type: 'object',
      properties: {
        dataDir: {
          type: 'string',
          description: 'Optional custom Zotero data directory. Omit to auto-detect.',
        },
      },
    },
  },
  {
    name: 'zotero_search_items',
    description:
      'Search items in the local Zotero library by title, author, year, DOI, or within a specific collection.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keywords to search in title, creators, year, or DOI.',
        },
        collectionKey: {
          type: 'string',
          description: 'Optional Zotero collection key to narrow down search to a specific collection.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum items to return (default 50, max 200).',
          default: 50,
        },
        dataDir: {
          type: 'string',
          description: 'Optional custom Zotero data directory. Omit to auto-detect.',
        },
      },
    },
  },
  {
    name: 'zotero_preview_sync',
    description:
      'Preview diff before syncing items or a collection from Zotero to PaperQuay. Checks which items are ready, already exist, or lack local PDFs.',
    inputSchema: {
      type: 'object',
      properties: {
        itemKeys: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific Zotero item keys to check for syncing.',
        },
        collectionKey: {
          type: 'string',
          description: 'Zotero collection key to check for syncing.',
        },
        dataDir: {
          type: 'string',
          description: 'Optional custom Zotero data directory. Omit to auto-detect.',
        },
      },
    },
  },
  {
    name: 'paperquay_sync_from_zotero',
    description:
      'Import selected items or a collection from the local Zotero library into PaperQuay, copying local PDFs and preserving metadata and collections. Refused while the PaperQuay desktop app is running unless allowWhileAppRunning is explicitly set.',
    inputSchema: {
      type: 'object',
      properties: {
        itemKeys: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific Zotero item keys to import into PaperQuay.',
        },
        collectionKey: {
          type: 'string',
          description: 'Zotero collection key to import into PaperQuay.',
        },
        targetCategoryId: {
          type: 'string',
          description: 'Optional target PaperQuay category ID to assign imported papers to.',
        },
        createCollectionCategory: {
          type: 'boolean',
          description: 'Whether to create/use a category matching the Zotero collection name when targetCategoryId is omitted (default true).',
          default: true,
        },
        dataDir: {
          type: 'string',
          description: 'Optional custom Zotero data directory. Omit to auto-detect.',
        },
        allowWhileAppRunning: ALLOW_WHILE_APP_RUNNING_SCHEMA,
      },
    },
  },
  {
    name: 'import_pdfs',
    description:
      'Import local PDF files into the PaperQuay library. Copies each file into the library storage directory (per importMode), deduplicates by content hash and by metadata DOI/title when provided, and optionally assigns papers to a category (existing targetCategoryId, or categoryName which is created when missing). Refused while the PaperQuay desktop app is running unless allowWhileAppRunning is true. Does not fetch Crossref references (unlike the desktop import).',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Absolute paths of the local PDF files to import.',
        },
        metadata: {
          type: 'object',
          description:
            'Optional per-file metadata overrides, keyed by the exact source path. Supported keys: title, titleZh, authors (string[]), authorDetails (object[]), year, publication, doi, url, abstractText, itemType, publisher, institution, reportNumber, volume, issue, pages, isbn, issn, language (BCP 47), citationKey, keywords (string[]), tags (string[]). authorDetails takes precedence over authors.',
          additionalProperties: { type: 'object' },
        },
        targetCategoryId: {
          type: 'string',
          description: 'Existing non-system category ID to assign all imported papers to (mutually exclusive with categoryName). Use list_categories to discover IDs.',
        },
        categoryName: {
          type: 'string',
          description: 'Root category name to assign imported papers to; created when no non-system root category with that name (case-insensitive) exists.',
        },
        importMode: {
          type: 'string',
          enum: ['copy', 'move', 'keep'],
          description: "File handling mode; defaults to the library's importMode setting ('copy'). 'copy' copies into the storage dir, 'move' moves the original file, 'keep' references the original path without copying.",
        },
        allowWhileAppRunning: ALLOW_WHILE_APP_RUNNING_SCHEMA,
      },
      required: ['paths'],
    },
  },
  {
    name: 'read_paper_figure',
    description:
      'Read one MinerU figure or table block by paperId + blockId (blockId like page-3-block-2 from read_paper_content / search_knowledge_base; pageIndex is a fallback). Returns caption, page, blockId, block type and, for image blocks within the size limit, one MCP image content block with base64 data. Tables return structured table text; oversized or missing images return metadata plus a limitation note.',
    inputSchema: {
      type: 'object',
      properties: {
        paperId: { type: 'string', description: 'The paper ID in PaperQuay.' },
        blockId: { type: 'string', description: 'MinerU block ID, e.g. page-3-block-2.' },
        pageIndex: {
          type: 'integer',
          description: '0-based page fallback: return the first figure/table on this page when blockId is omitted.',
        },
      },
      required: ['paperId'],
    },
  },
  {
    name: 'list_categories',
    description:
      'List all PaperQuay library categories (system and user) with parent/child structure and paper counts. Read-only. Use it to discover categoryId values for import_pdfs, manage_category, set_paper_categories, and the search_papers categoryId filter.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'manage_category',
    description:
      'Create, rename, move, or delete a PaperQuay library category. delete cascades to all descendant categories, unlinks papers (never deletes papers), and returns affected category/paper counts. System categories (all/recent/uncategorized/favorites) cannot be modified, moved, deleted, or used as a parent. rename/move/delete require expectedUpdatedAt while the app is running; cascading delete also accepts expectedCategoryVersions for every affected descendant.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'rename', 'move', 'delete'],
          description: 'The operation to perform.',
        },
        categoryId: {
          type: 'string',
          description: 'Target category ID (required for rename/move/delete).',
        },
        name: {
          type: 'string',
          description: 'Category name (required for create/rename).',
        },
        parentId: {
          type: 'string',
          description: 'Parent category ID for create/move; omit or empty for root level. Moving a category under itself or its own descendant is rejected.',
        },
        sortOrder: {
          type: 'integer',
          description: 'Optional explicit sort order applied by move.',
        },
        expectedUpdatedAt: {
          type: 'number',
          description: 'Target category updatedAt from list_categories. Required for rename/move/delete while PaperQuay is running.',
        },
        expectedCategoryVersions: {
          type: 'object',
          description: 'Version snapshot { categoryId: updatedAt } for every affected descendant on a cascading delete. Any changed version rejects the whole delete.',
        },
        allowWhileAppRunning: ALLOW_WHILE_APP_RUNNING_SCHEMA,
      },
      required: ['action'],
    },
  },
  {
    name: 'set_paper_categories',
    description:
      'Assign or remove non-system categories on one or more papers. Use replace to set the exact category list, or add/remove to adjust it (replace cannot be combined with add/remove). Every paper is version-checked; any stale expectedUpdatedAt rejects the whole batch (all-or-nothing). System categories are computed by the app and cannot be assigned; use update_paper isFavorite for favorites.',
    inputSchema: {
      type: 'object',
      properties: {
        paperIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Paper IDs to update. Every ID must exist, otherwise nothing is changed.',
        },
        add: {
          type: 'array',
          items: { type: 'string' },
          description: 'Category IDs to add to each paper.',
        },
        remove: {
          type: 'array',
          items: { type: 'string' },
          description: 'Category IDs to remove from each paper.',
        },
        replace: {
          type: 'array',
          items: { type: 'string' },
          description: 'Exact category list to set on each paper (mutually exclusive with add/remove).',
        },
        expectedUpdatedAt: EXPECTED_UPDATED_AT_SCHEMA,
        allowWhileAppRunning: ALLOW_WHILE_APP_RUNNING_SCHEMA,
      },
      required: ['paperIds'],
    },
  },
  {
    name: 'update_paper',
    description:
      'Update bibliographic metadata of an existing paper. Only whitelisted fields are accepted: title, titleZh, authors (string[]), authorDetails (object[]), year, publication, doi, url, abstractText, itemType, publisher, institution, reportNumber, volume, issue, pages, isbn, issn, language (BCP 47), citationKey, keywords (string[]), tags (string[]), userNote, aiSummary, citation, isFavorite. authorDetails takes precedence over authors when both are provided. Unknown fields are rejected. Pass expectedUpdatedAt for checked parallel writes; stale versions return PAPER_CONFLICT.',
    inputSchema: {
      type: 'object',
      properties: {
        paperId: { type: 'string', description: 'The unique ID of the paper in PaperQuay.' },
        title: { type: 'string' },
        titleZh: { type: 'string', description: 'Chinese title.' },
        authors: { type: 'array', items: { type: 'string' }, description: 'Full author list, replacing the existing one.' },
        authorDetails: {
          type: 'array',
          description: 'Detailed authors, replacing the existing list; takes precedence over authors. Each item accepts name, givenName, familyName, affiliation, and ORCID.',
          items: { type: 'object' },
        },
        year: { description: 'Publication year.' },
        publication: { type: 'string' },
        doi: { type: 'string' },
        url: { type: 'string' },
        abstractText: { type: 'string' },
        itemType: { type: 'string', description: 'e.g. journalArticle, conferencePaper, book, thesis, report.' },
        publisher: { type: 'string' },
        institution: { type: 'string' },
        reportNumber: { type: 'string' },
        volume: { type: 'string' },
        issue: { type: 'string' },
        pages: { type: 'string' },
        isbn: { type: 'string' },
        issn: { type: 'string' },
        language: { type: 'string', description: 'Paper language as a BCP 47 tag, for example en or zh-Hans.' },
        citationKey: { type: 'string', description: 'Optional citation key matching ^[A-Za-z0-9_:\\-.]+$. Empty clears it; duplicate keys are allowed.' },
        keywords: { type: 'array', items: { type: 'string' }, description: 'Full keyword list, replacing the existing one.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Full tag list, replacing the existing one.' },
        userNote: { type: 'string' },
        aiSummary: { type: 'string' },
        citation: { type: 'string' },
        isFavorite: { type: 'boolean' },
        expectedUpdatedAt: {
          type: 'number',
          description: 'Paper updatedAt from get_paper_details. Required while PaperQuay is running; a mismatch returns PAPER_CONFLICT with the current updatedAt.',
        },
        allowWhileAppRunning: ALLOW_WHILE_APP_RUNNING_SCHEMA,
      },
      required: ['paperId'],
    },
  },
  {
    name: 'preview_delete_papers',
    description:
      'Read-only delete preview. Lists each target paper with updatedAt, every attachment and its status, files that will be deleted, shared files referenced by other papers/attachments, and files outside the managed library paths. Pass the returned previewVersion to delete_papers. Always preview and confirm with the user before deleting.',
    inputSchema: {
      type: 'object',
      properties: {
        paperIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Paper IDs to preview.',
        },
        deleteFiles: {
          type: 'boolean',
          description: 'Preview removing every attachment file of the selected papers (default false).',
          default: false,
        },
        deleteFilePaperIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Paper IDs whose attachment files should be removed (must be a subset of paperIds).',
        },
      },
      required: ['paperIds'],
    },
  },
  {
    name: 'delete_papers',
    description:
      'Delete one or more papers from the PaperQuay library. By default only database records are removed; deleteFiles: true removes every managed attachment file, deleteFilePaperIds removes files only for the listed papers. Only managed files not shared with another record are deleted; shared/unmanaged files are kept and reported. The database commits before files are touched, and file failures return partialFailure with fileErrors. While PaperQuay is running you must pass the previewVersion from preview_delete_papers; a stale preview rejects the whole delete.',
    inputSchema: {
      type: 'object',
      properties: {
        paperIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Paper IDs to delete. Every ID must exist, otherwise nothing is changed.',
        },
        deleteFiles: {
          type: 'boolean',
          description: 'Also delete managed attachment files from the library storage directory (default false).',
          default: false,
        },
        deleteFilePaperIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Only delete files for these paper IDs (must be a subset of paperIds).',
        },
        previewVersion: {
          type: 'string',
          description: 'previewVersion returned by preview_delete_papers. Required while PaperQuay is running; a mismatch returns PAPER_CONFLICT and requires a new preview.',
        },
        allowWhileAppRunning: ALLOW_WHILE_APP_RUNNING_SCHEMA,
      },
      required: ['paperIds'],
    },
  },
  {
    name: 'attach_translated_pdf',
    description:
      'Attach a local translated PDF to a paper. Copies the file into the library translated-pdf directory and replaces any existing translated-pdf attachment for that paper. Returns attachmentId, storedPath, relativePath, replaced, and pageCountMismatch when the translated page count differs from the original. Does not reject on a page-count mismatch. Refused while the desktop app is running unless allowWhileAppRunning is true.',
    inputSchema: {
      type: 'object',
      properties: {
        paperId: { type: 'string', description: 'The unique ID of the paper in PaperQuay.' },
        sourcePath: { type: 'string', description: 'Absolute path of the translated PDF to attach.' },
        expectedUpdatedAt: {
          type: 'number',
          description: 'Paper updatedAt from get_paper_details. Required while PaperQuay is running.',
        },
        allowWhileAppRunning: ALLOW_WHILE_APP_RUNNING_SCHEMA,
      },
      required: ['paperId', 'sourcePath'],
    },
  },
  {
    name: 'remove_translated_pdf',
    description:
      'Remove the translated-pdf attachment from a paper. By default also deletes the stored copy after the database commit. Refused while the desktop app is running unless allowWhileAppRunning is true.',
    inputSchema: {
      type: 'object',
      properties: {
        paperId: { type: 'string', description: 'The unique ID of the paper in PaperQuay.' },
        deleteFile: {
          type: 'boolean',
          description: 'Also delete the stored translated PDF (default true).',
          default: true,
        },
        expectedUpdatedAt: {
          type: 'number',
          description: 'Paper updatedAt from get_paper_details. Required while PaperQuay is running.',
        },
        allowWhileAppRunning: ALLOW_WHILE_APP_RUNNING_SCHEMA,
      },
      required: ['paperId'],
    },
  },
];

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

async function handleToolCall(name, args) {
  switch (name) {
    case 'search_papers':
      return service.searchPapers(args || {});
    case 'get_paper_details':
      return service.getPaperDetails(args || {});
    case 'search_knowledge_base':
      return service.searchKnowledgeBase(args || {});
    case 'read_paper_content':
      return service.readPaperContent(args || {});
    case 'read_paper_figure':
      return service.readPaperFigure(args || {});
    case 'search_notes':
      return service.searchNotes(args || {});
    case 'get_note':
      return service.getNote(args || {});
    case 'create_note':
      return service.createNote(args || {});
    case 'update_note':
      return service.updateNote(args || {});
    case 'delete_note':
      return service.deleteNote(args || {});
    case 'list_note_tags':
      return service.listNoteTags(args || {});
    case 'list_note_folders':
      return service.listNoteFolders(args || {});
    case 'create_note_folder':
      return service.createNoteFolder(args || {});
    case 'rename_note_folder':
      return service.renameNoteFolder(args || {});
    case 'delete_note_folder':
      return service.deleteNoteFolder(args || {});
    case 'zotero_list_collections':
      return service.zoteroListCollections(args || {});
    case 'zotero_search_items':
      return service.zoteroSearchItems(args || {});
    case 'zotero_preview_sync':
      return service.zoteroPreviewSync(args || {});
    case 'paperquay_sync_from_zotero':
      return service.paperquaySyncFromZotero(args || {});
    case 'import_pdfs':
      return service.importPdfs(args || {});
    case 'list_categories':
      return service.listCategories(args || {});
    case 'manage_category':
      return service.manageCategory(args || {});
    case 'set_paper_categories':
      return service.setPaperCategories(args || {});
    case 'update_paper':
      return service.updatePaper(args || {});
    case 'preview_delete_papers':
      return service.previewDeletePapers(args || {});
    case 'delete_papers':
      return service.deletePapers(args || {});
    case 'attach_translated_pdf':
      return service.attachTranslatedPdf(args || {});
    case 'remove_translated_pdf':
      return service.removeTranslatedPdf(args || {});
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handleMessage(message) {
  if (!message || typeof message !== 'object') {
    return;
  }

  const { id, method, params } = message;

  // 通知类消息无须回复 id
  if (id === undefined || id === null) {
    if (method === 'notifications/initialized') {
      console.error('[PaperQuay MCP] Client initialized successfully.');
    }
    return;
  }

  try {
    switch (method) {
      case 'initialize':
        sendResult(id, {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {
              listChanged: false,
            },
          },
          serverInfo: {
            name: SERVER_NAME,
            version: SERVER_VERSION,
          },
        });
        break;

      case 'ping':
        sendResult(id, {});
        break;

      case 'tools/list':
        sendResult(id, {
          tools: TOOLS,
        });
        break;

      case 'tools/call': {
        const { name, arguments: toolArgs } = params || {};
        if (!name) {
          sendError(id, -32602, 'Tool name is required');
          break;
        }

        try {
          const data = await handleToolCall(name, toolArgs || {});
          if (name === 'read_paper_figure' && data && typeof data === 'object' && data.base64) {
            const { base64, mimeType, ...metadata } = data;
            sendResult(id, {
              content: [
                { type: 'text', text: JSON.stringify(metadata, null, 2) },
                { type: 'image', data: base64, mimeType: mimeType || 'image/jpeg' },
              ],
              isError: false,
            });
          } else {
            sendResult(id, {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(data, null, 2),
                },
              ],
              isError: false,
            });
          }
        } catch (toolError) {
          const rawMessage = String(toolError?.message ?? '');
          const codePrefix = toolError?.code && !rawMessage.startsWith(`${toolError.code}:`)
            ? `${toolError.code}: `
            : '';
          const details = toolError?.details && typeof toolError.details === 'object'
            ? `\n${JSON.stringify(toolError.details)}`
            : '';
          sendResult(id, {
            content: [
              {
                type: 'text',
                text: `Error executing ${name}: ${codePrefix}${rawMessage}${details}`,
              },
            ],
            isError: true,
          });
        }
        break;
      }

      default:
        sendError(id, -32601, `Method not found: ${method}`);
        break;
    }
  } catch (error) {
    console.error('[PaperQuay MCP] Unhandled error:', error);
    sendError(id, -32603, `Internal error: ${error.message}`);
  }
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
    void handleMessage(json);
  } catch (parseError) {
    console.error('[PaperQuay MCP] JSON parse error on input line:', parseError.message);
    sendError(null, -32700, 'Parse error');
  }
});

rl.on('close', () => {
  console.error('[PaperQuay MCP] Stdio stream closed, shutting down.');
  process.exit(0);
});

console.error(`[PaperQuay MCP] Server started (version: ${SERVER_VERSION}, dataDir: ${service.appPaths.dataDir})`);
