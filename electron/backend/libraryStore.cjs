const path = require('node:path');
const { createLibraryDatabaseStore } = require('./libraryDatabaseStore.cjs');
const { hashBytes, now } = require('./utils.cjs');

const SYSTEM_CATEGORIES = [
  ['system-all', 'All Papers', 'all', 0],
  ['system-recent', 'Recently Imported', 'recent', 1],
  ['system-uncategorized', 'Uncategorized', 'uncategorized', 2],
  ['system-favorites', 'Favorites', 'favorites', 3],
];

const METADATA_FIELD_APPLICABILITY = {
  title: null, authors: null, year: null, abstractText: null, keywords: null, url: null,
  doi: ['journalArticle', 'conferencePaper', 'preprint'],
  publication: ['journalArticle', 'conferencePaper', 'bookSection', 'preprint'],
  publisher: ['journalArticle', 'conferencePaper', 'book', 'bookSection', 'report'],
  institution: ['thesis', 'report'], reportNumber: ['report'],
  volume: ['journalArticle'], issue: ['journalArticle'], pages: ['journalArticle', 'conferencePaper', 'bookSection'],
  isbn: ['book', 'bookSection', 'conferencePaper'], issn: ['journalArticle'],
};

function metadataFieldIsMissing(paper, field) {
  const itemType = paper.itemType || 'journalArticle';
  const applicableTypes = METADATA_FIELD_APPLICABILITY[field];
  if (!(field in METADATA_FIELD_APPLICABILITY) || (applicableTypes && !applicableTypes.includes(itemType))) return false;
  if (field === 'authors') return !paper.authors.some((author) => author.name.trim());
  if (field === 'keywords') return !paper.keywords.some((keyword) => keyword.trim());
  return typeof paper[field] !== 'string' || paper[field].trim() === '';
}

function createAppPaths(app) {
  const dataDir = path.join(app.getPath('userData'), 'PaperQuay');

  return {
    dataDir,
    configPath: path.join(dataDir, '.settings', 'paperquay.config.json'),
    mineruCacheDir: path.join(dataDir, '.mineru-cache'),
    remotePdfDownloadDir: path.join(dataDir, '.downloads', 'pdfs'),
    libraryPath: path.join(dataDir, 'paperquay-library.json'),
    libraryDatabasePath: path.join(dataDir, 'paperquay-library.sqlite'),
    notesDatabasePath: path.join(dataDir, 'paperquay-notes.sqlite'),
    knowledgeDatabasePath: path.join(dataDir, 'paperquay-knowledge.sqlite'),
    ragDatabasePath: path.join(dataDir, 'paperquay-rag.sqlite'),
    agentMemoryDir: path.join(dataDir, 'agent-memory'),
    screenshotDir: path.join(dataDir, '.screenshots'),
  };
}

function createDefaultLibrary(appPaths) {
  const timestamp = now();

  return {
    version: 1,
    settings: {
      storageDir: path.join(appPaths.dataDir, 'paperquay-data'),
      translatedPdfDir: '',
      zoteroLocalDataDir: '',
      importMode: 'copy',
      autoRenameFiles: true,
      fileNamingRule: '{author}_{year}_{title}',
      createCategoryFolders: false,
      folderWatchEnabled: false,
      preserveOriginalPath: true,
      openAlexEnabled: true,
      openAlexApiKey: '',
      openAlexMailto: '',
    },
    categories: SYSTEM_CATEGORIES.map(([id, name, systemKey, sortOrder]) => ({
      id,
      name,
      parentId: null,
      sortOrder,
      isSystem: true,
      systemKey,
      createdAt: timestamp,
      updatedAt: timestamp,
      paperCount: 0,
    })),
    papers: [],
  };
}

function normalizeLibrary(raw, appPaths) {
  const defaults = createDefaultLibrary(appPaths);
  const rawObject = raw && typeof raw === 'object' ? raw : {};
  const { ragIndexes: _legacyRagIndexes, ...rawLibrary } = rawObject;
  const { backupEnabled: _legacyBackupEnabled, ...rawSettings } = rawLibrary.settings ?? {};
  const library = {
    ...defaults,
    ...rawLibrary,
    settings: { ...defaults.settings, ...rawSettings },
    categories: Array.isArray(rawLibrary.categories) ? rawLibrary.categories : defaults.categories,
    papers: Array.isArray(rawLibrary.papers) ? rawLibrary.papers : [],
  };
  const existingIds = new Set(library.categories.map((category) => category.id));

  for (const category of defaults.categories) {
    if (!existingIds.has(category.id)) {
      library.categories.push(category);
    }
  }

  return library;
}

function createLibraryStore(appPaths) {
  return createLibraryDatabaseStore(appPaths, { normalizeLibrary });
}

function categoryCounts(library) {
  const papers = library.papers;
  const counts = new Map();
  counts.set('all', papers.length);
  counts.set('recent', Math.min(30, papers.length));
  counts.set('uncategorized', papers.filter((paper) => paper.categoryIds.length === 0).length);
  counts.set('favorites', papers.filter((paper) => paper.isFavorite).length);

  for (const category of library.categories) {
    if (category.isSystem) continue;
    const descendants = new Set([category.id]);
    let changed = true;

    while (changed) {
      changed = false;
      for (const child of library.categories) {
        if (!child.isSystem && child.parentId && descendants.has(child.parentId) && !descendants.has(child.id)) {
          descendants.add(child.id);
          changed = true;
        }
      }
    }

    counts.set(category.id, papers.filter((paper) => paper.categoryIds.some((id) => descendants.has(id))).length);
  }

  return counts;
}

function attachCategoryCounts(library) {
  const counts = categoryCounts(library);

  return library.categories
    .map((category) => ({
      ...category,
      paperCount: category.isSystem ? counts.get(category.systemKey) ?? 0 : counts.get(category.id) ?? 0,
    }))
    .sort((left, right) =>
      Number(right.isSystem) - Number(left.isSystem) ||
      Number(Boolean(left.parentId)) - Number(Boolean(right.parentId)) ||
      left.sortOrder - right.sortOrder ||
      left.name.localeCompare(right.name),
    );
}

function normalizeAuthor(name, sortOrder) {
  return {
    id: `auth_${hashBytes(Buffer.from(name)).slice(0, 12)}`,
    name,
    givenName: null,
    familyName: null,
    sortOrder,
  };
}

function normalizeTag(name) {
  return {
    id: `tag_${hashBytes(Buffer.from(name.toLowerCase())).slice(0, 12)}`,
    name,
    color: null,
  };
}

function paperMatches(paper, request, library) {
  if (request?.categoryId) {
    const category = library.categories.find(
      (item) => item.id === request.categoryId || (item.isSystem && item.systemKey === request.categoryId),
    );

    if (category?.systemKey === 'recent') {
      const recentIds = new Set(
        library.papers
          .slice()
          .sort((left, right) => right.importedAt - left.importedAt || left.title.localeCompare(right.title))
          .slice(0, 30)
          .map((item) => item.id),
      );
      if (!recentIds.has(paper.id)) return false;
    } else if (category?.systemKey === 'uncategorized') {
      if (paper.categoryIds.length > 0) return false;
    } else if (category?.systemKey === 'favorites') {
      if (!paper.isFavorite) return false;
    } else if (!category?.systemKey) {
      const allowed = new Set([request.categoryId]);
      let changed = true;

      while (changed) {
        changed = false;
        for (const item of library.categories) {
          if (item.parentId && allowed.has(item.parentId) && !allowed.has(item.id)) {
            allowed.add(item.id);
            changed = true;
          }
        }
      }

      if (!paper.categoryIds.some((id) => allowed.has(id))) return false;
    }
  }

  if (request?.ragEnabled === true && paper.ragEnabled === false) return false;
  if (request?.ragEnabled === false && paper.ragEnabled !== false) return false;
  if (typeof request?.isFavorite === 'boolean' && Boolean(paper.isFavorite) !== request.isFavorite) return false;
  if (typeof request?.isRead === 'boolean' && (paper.lastReadAt != null) !== request.isRead) return false;
  const progressFrom = request?.progressFrom == null || request.progressFrom === '' ? null : Number(request.progressFrom);
  const progressTo = request?.progressTo == null || request.progressTo === '' ? null : Number(request.progressTo);
  if (progressFrom !== null && (!Number.isFinite(progressFrom) || progressFrom < 0 || progressFrom > 100)) throw new Error('Invalid progressFrom reading progress filter');
  if (progressTo !== null && (!Number.isFinite(progressTo) || progressTo < 0 || progressTo > 100)) throw new Error('Invalid progressTo reading progress filter');
  if (progressFrom !== null && progressTo !== null && progressFrom > progressTo) throw new Error('Invalid reading progress range: progressFrom exceeds progressTo');
  if (progressFrom !== null && paper.readingProgress * 100 < progressFrom) return false;
  if (progressTo !== null && paper.readingProgress * 100 > progressTo) return false;
  for (const [prefix, value] of [['importedAt', paper.importedAt], ['lastReadAt', paper.lastReadAt]]) {
    const fromRaw = request?.[`${prefix}From`];
    const toRaw = request?.[`${prefix}To`];
    const from = fromRaw == null || fromRaw === '' ? null : Number(fromRaw);
    const to = toRaw == null || toRaw === '' ? null : Number(toRaw);
    if (from !== null && (!Number.isSafeInteger(from) || from < 0)) throw new Error(`Invalid ${prefix}From timestamp filter`);
    if (to !== null && (!Number.isSafeInteger(to) || to < 0)) throw new Error(`Invalid ${prefix}To timestamp filter`);
    if (from !== null && to !== null && from > to) throw new Error(`Invalid ${prefix} range: from exceeds to`);
    if (from !== null && (value == null || value < from)) return false;
    if (to !== null && (value == null || value > to)) return false;
  }
  const attachmentRole = typeof request?.attachmentRole === 'string' ? request.attachmentRole.trim() : '';
  const attachments = Array.isArray(paper.attachments) ? paper.attachments : [];
  if (attachmentRole === 'original-pdf' && !attachments.some((item) => ['pdf', 'original-pdf'].includes(item.kind) && item.missing !== true)) return false;
  if (attachmentRole === 'translated-pdf' && !attachments.some((item) => item.kind === 'translated-pdf' && item.missing !== true)) return false;
  if (attachmentRole === 'missing' && !attachments.some((item) => item.missing === true)) return false;
  if (attachmentRole === 'none' && attachments.length > 0) return false;
  if (attachmentRole && !['any', 'original-pdf', 'translated-pdf', 'missing', 'none'].includes(attachmentRole)) {
    throw new Error(`Unsupported attachmentRole filter: ${attachmentRole}`);
  }
  const missingMetadataFields = Array.isArray(request?.missingMetadataFields)
    ? [...new Set(request.missingMetadataFields.map((field) => typeof field === 'string' ? field.trim() : '').filter(Boolean))]
    : [];
  for (const field of missingMetadataFields) {
    if (!(field in METADATA_FIELD_APPLICABILITY)) throw new Error(`Unsupported missing metadata field: ${field}`);
  }
  if (missingMetadataFields.length && !missingMetadataFields.some((field) => metadataFieldIsMissing(paper, field))) return false;
  const itemType = typeof request?.itemType === 'string' ? request.itemType.trim() : '';
  if (itemType && (paper.itemType || 'journalArticle') !== itemType) return false;

  const yearFrom = request?.yearFrom == null || request.yearFrom === '' ? null : Number(request.yearFrom);
  const yearTo = request?.yearTo == null || request.yearTo === '' ? null : Number(request.yearTo);
  if (yearFrom !== null && (!Number.isInteger(yearFrom) || yearFrom < 1 || yearFrom > 9999)) throw new Error('Invalid yearFrom year filter');
  if (yearTo !== null && (!Number.isInteger(yearTo) || yearTo < 1 || yearTo > 9999)) throw new Error('Invalid yearTo year filter');
  if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) throw new Error('Invalid year range: yearFrom exceeds yearTo');
  const parsedYear = /^(\d{4})/.exec(String(paper.year ?? ''))?.[1];
  const unknownYear = !parsedYear;
  if (request?.unknownYearOnly === true && !unknownYear) return false;
  if (request?.unknownYearOnly !== true) {
    if (yearFrom !== null && (!parsedYear || Number(parsedYear) < yearFrom)) return false;
    if (yearTo !== null && (!parsedYear || Number(parsedYear) > yearTo)) return false;
  }

  const authorQuery = typeof request?.authorQuery === 'string' ? request.authorQuery.trim().toLowerCase() : '';
  if (authorQuery && !paper.authors.some((author) => author.name.toLowerCase().includes(authorQuery))) return false;
  const publicationQuery = typeof request?.publicationQuery === 'string' ? request.publicationQuery.trim().toLowerCase() : '';
  if (publicationQuery && !(paper.publication ?? '').toLowerCase().includes(publicationQuery)) return false;
  const keywordQuery = typeof request?.keywordQuery === 'string' ? request.keywordQuery.trim().toLowerCase() : '';
  if (keywordQuery && !paper.keywords.some((keyword) => keyword.toLowerCase().includes(keywordQuery))) return false;
  const tagNames = Array.isArray(request?.tagNames)
    ? [...new Set(request.tagNames.map((name) => typeof name === 'string' ? name.trim().toLowerCase() : '').filter(Boolean))]
    : [];
  if (tagNames.length && !paper.tags.some((tag) => tagNames.includes(tag.name.trim().toLowerCase()))) return false;

  if (request?.tagId && !paper.tags.some((tag) => tag.id === request.tagId)) return false;

  const search = typeof request?.search === 'string' ? request.search.trim().toLowerCase() : '';
  if (!search) return true;

  const haystack = [
    paper.title,
    paper.titleZh,
    paper.year,
    paper.publication,
    paper.doi,
    paper.abstractText,
    paper.keywords.join(' '),
    paper.authors.map((author) => author.name).join(' '),
    paper.tags.map((tag) => tag.name).join(' '),
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();

  return haystack.includes(search);
}

function sortPapers(papers, request = {}) {
  const direction = request.sortDirection === 'asc' ? 1 : -1;
  const sortBy = request.sortBy || 'manual';
  const getValue = (paper) => {
    if (sortBy === 'title') return paper.title.toLowerCase();
    if (sortBy === 'year') return paper.year ?? '';
    if (sortBy === 'author') return paper.authors[0]?.name?.toLowerCase() ?? '';
    if (sortBy === 'updatedAt') return paper.updatedAt;
    if (sortBy === 'lastReadAt') return paper.lastReadAt ?? 0;
    if (sortBy === 'importedAt') return paper.importedAt;
    return paper.sortOrder;
  };

  return papers.slice().sort((left, right) => {
    const leftValue = getValue(left);
    const rightValue = getValue(right);
    if (leftValue < rightValue) return sortBy === 'manual' ? -1 : -1 * direction;
    if (leftValue > rightValue) return sortBy === 'manual' ? 1 : 1 * direction;
    return left.title.localeCompare(right.title);
  });
}

module.exports = {
  attachCategoryCounts,
  createAppPaths,
  createLibraryStore,
  normalizeAuthor,
  normalizeTag,
  paperMatches,
  sortPapers,
};
