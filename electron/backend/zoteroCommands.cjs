const {
  downloadZoteroAttachmentPdf,
  listZoteroLibraryItems,
  lookupZoteroKey,
} = require('./zoteroApi.cjs');
const {
  detectLocalZoteroDataDir,
  listLocalCollections,
  listLocalLibraryItems,
  listLocalCollectionItems,
  listRelatedNotes,
} = require('./zoteroLocal.cjs');

function createZoteroCommands(context) {
  const { appPaths, fileCommands, pathPolicy } = context;

  /**
   * Zotero 条目里的 PDF 路径由主进程扫描用户配置的 Zotero 目录得到；
   * 这里把它们登记为可读，避免把整个 zoteroLocalDataDir 变成通用读根。
   */
  function approveLocalPdfs(items) {
    if (!pathPolicy || !Array.isArray(items)) return items;

    const paths = items
      .map((item) => (typeof item?.localPdfPath === 'string' ? item.localPdfPath : ''))
      .filter(Boolean);
    if (paths.length > 0) pathPolicy.approveReadPaths(paths);
    return items;
  }

  return {
    zotero_lookup_key({ apiKey }) {
      return lookupZoteroKey(apiKey);
    },

    zotero_list_library_items({ options }) {
      return listZoteroLibraryItems(options ?? {});
    },

    zotero_download_attachment_pdf({ options }) {
      return downloadZoteroAttachmentPdf(options ?? {}, appPaths);
    },

    zotero_detect_local_data_dir() {
      return detectLocalZoteroDataDir();
    },

    zotero_select_local_data_dir(_args, event) {
      return fileCommands.select_directory({ title: 'Select Zotero data directory' }, event);
    },

    zotero_list_local_collections({ options } = {}) {
      return listLocalCollections(options ?? {});
    },

    zotero_list_local_library_items({ options } = {}) {
      return approveLocalPdfs(listLocalLibraryItems(options ?? {}));
    },

    zotero_list_local_collection_items({ options } = {}) {
      return approveLocalPdfs(listLocalCollectionItems(options ?? {}));
    },

    zotero_list_related_notes({ options } = {}) {
      return listRelatedNotes(options ?? {});
    },
  };
}

module.exports = { createZoteroCommands };
