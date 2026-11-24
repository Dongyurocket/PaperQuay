const fsp = require('node:fs/promises');
const path = require('node:path');
const {
  cleanString,
  ensureFile,
  fileNameFromPath,
  hashFile,
  isPdf,
  now,
} = require('./utils.cjs');
const {
  addTranslatedPdfAttachment,
  removeTranslatedPdfAttachment,
} = require('./translatedPdfAttachments.cjs');
const {
  inspectPdfAssets,
  planPdfAssetNames,
} = require('./pdfAssetGovernance.cjs');
const { invalidateAttachmentAvailability } = require('./libraryAttachmentAvailability.cjs');

function isSubPath(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function createLibraryAttachmentCommands({ appPaths, pathPolicy, store }) {
  return {
    async library_inspect_pdf_assets() {
      return inspectPdfAssets(store.load());
    },

    async library_plan_pdf_asset_names() {
      const library = store.load();
      const operations = planPdfAssetNames(library);
      return {
        createdAt: now(),
        namingVersion: 1,
        operations,
        renameCount: operations.filter((item) => item.action === 'rename-preview' && item.ownership).length,
        externalCount: operations.filter((item) => !item.ownership).length,
      };
    },

    async library_relocate_attachment({ request }) {
      const paperId = store.getPaperIdByAttachment(request.attachmentId);
      const paper = paperId ? store.getPaper(paperId) : null;
      if (!paper) throw new Error('Attachment does not exist');

      const newPath = path.resolve(cleanString(request.newPath));
      // 附件表是读/写权限的信任锚：只能指向用户已授权的 PDF，
      // 否则一次 relocate 就能把任意文件变成可读附件。
      if (!isPdf(newPath)) throw new Error('Only PDF attachments can be relocated');
      if (pathPolicy && !pathPolicy.isReadAllowed(newPath)) {
        throw new Error(`Relocating to this path is not allowed: ${newPath}`);
      }
      await ensureFile(newPath);

      const attachment = paper.attachments.find((item) => item.id === request.attachmentId);
      const stat = await fsp.stat(newPath);
      attachment.storedPath = newPath;
      const storageDir = cleanString(store.loadSettings().storageDir);
      attachment.relativePath = storageDir && isSubPath(storageDir, newPath)
        ? path.relative(storageDir, newPath).replace(/\\/g, '/')
        : null;
      attachment.fileName = fileNameFromPath(newPath);
      attachment.fileSize = stat.size;
      attachment.contentHash = await hashFile(newPath);
      attachment.missing = false;
      paper.updatedAt = now();

      store.savePaper(paper);
      invalidateAttachmentAvailability([newPath]);
      return attachment;
    },

    async library_add_attachment({ request }) {
      const paper = store.getPaper(request.paperId);
      if (!paper) throw new Error('Paper does not exist');

      const sourcePath = path.resolve(cleanString(request.sourcePath));
      if (!isPdf(sourcePath)) throw new Error('Only PDF attachments can be added');
      if (pathPolicy && !pathPolicy.isReadAllowed(sourcePath)) {
        throw new Error(`Adding this attachment path is not allowed: ${sourcePath}`);
      }

      const settings = store.loadSettings();
      await addTranslatedPdfAttachment({
        paper,
        sourcePath,
        kind: request.kind,
        language: request.language,
        settings,
        appPaths,
        pathPolicy,
        persist: async () => {
          store.savePaper(paper);
        },
        listAttachmentsByStoredPath: (storedPath) => store.findAttachmentsByStoredPath(storedPath),
      });
      invalidateAttachmentAvailability();
      return paper;
    },

    async library_update_translated_pdf_languages({ request }) {
      const changes = request?.changes;
      if (!Array.isArray(changes) || changes.length === 0) {
        throw new Error('至少需要一个译版语言变更');
      }
      const seen = new Set();
      const normalized = changes.map((change) => {
        const paperId = cleanString(change?.paperId);
        const attachmentId = cleanString(change?.attachmentId);
        if (!paperId || !attachmentId) throw new Error('文献和附件 ID 不能为空');
        if (seen.has(attachmentId)) throw new Error(`重复的译版附件：${attachmentId}`);
        seen.add(attachmentId);
        if (!Object.prototype.hasOwnProperty.call(change, 'expectedLanguage')
          || !(change.expectedLanguage === null || typeof change.expectedLanguage === 'string')) {
          throw new Error('预览语言值无效，请刷新后重试');
        }
        if (!Object.prototype.hasOwnProperty.call(change, 'language')) {
          throw new Error('缺少目标语言；清除语言请明确传入 null');
        }
        let language = change.language;
        if (language !== null) {
          if (typeof language !== 'string' || !language.trim()) throw new Error('语言标签不能为空；清除语言请使用专用操作');
          try {
            [language] = Intl.getCanonicalLocales(language.trim());
          } catch {
            throw new Error(`无效的 BCP 47 语言标签：${language}`);
          }
        }
        return { paperId, attachmentId, expectedLanguage: change.expectedLanguage, language };
      });
      return store.updateTranslatedPdfLanguages(normalized);
    },

    async library_remove_attachment({ request }) {
      const settings = store.loadSettings();
      const paperId = store.getPaperIdByAttachment(request.attachmentId);
      const paper = paperId ? store.getPaper(paperId) : null;
      if (!paper) throw new Error('Attachment does not exist');

      await removeTranslatedPdfAttachment({
        paper,
        attachmentId: request.attachmentId,
        deleteFile: request.deleteFile,
        settings,
        appPaths,
        persist: async () => {
          store.savePaper(paper);
        },
        listAttachmentsByStoredPath: (storedPath) => store.findAttachmentsByStoredPath(storedPath),
      });
      invalidateAttachmentAvailability();
      return paper;
    },
  };
}

module.exports = { createLibraryAttachmentCommands };
