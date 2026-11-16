'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

/** Resolve the same attachment location used by the library UI. */
function attachmentPath(attachment, storageDir) {
  const clean = (value) => typeof value === 'string' ? value.trim() : '';
  const relative = clean(attachment.relativePath);
  const root = clean(storageDir);
  return root && relative ? path.join(root, relative) : clean(attachment.storedPath) || clean(attachment.originalPath);
}

/**
 * Attachment flags in the library are a snapshot and can become stale when files
 * are moved outside PaperQuay. Only rescan when an attachment filter is active;
 * pass the resulting ids to SQLite so count, pagination, and select-all agree.
 * Never persist this observation or treat a transient access error as deletion.
 */
async function resolveAttachmentFilters(request = {}, library) {
  const fields = ['hasPdf', 'hasTranslatedPdf', 'missingFile'];
  if (!fields.some((field) => typeof request[field] === 'boolean')) {
    return { request, applyToPapers: (papers) => papers };
  }

  const papers = library.papers ?? [];
  const root = library.settings?.storageDir;
  const states = new Map();
  const attachments = papers.flatMap((paper) => paper.attachments ?? []);
  let next = 0;
  async function worker() {
    while (next < attachments.length) {
      const attachment = attachments[next++];
      const filePath = attachmentPath(attachment, root);
      if (!filePath) { states.set(attachment, false); continue; }
      try {
        states.set(attachment, (await fs.stat(filePath)).isFile());
      } catch (error) {
        states.set(attachment, error?.code === 'ENOENT' || error?.code === 'ENOTDIR' ? false : !attachment.missing);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(32, attachments.length) }, worker));

  const requestedIds = Array.isArray(request.paperIds) ? new Set(request.paperIds) : null;
  const paperIds = papers.filter((paper) => {
    if (requestedIds && !requestedIds.has(paper.id)) return false;
    const list = paper.attachments ?? [];
    const actual = {
      hasPdf: list.some((a) => a.kind === 'pdf' && states.get(a)),
      hasTranslatedPdf: list.some((a) => a.kind === 'translated-pdf' && states.get(a)),
      missingFile: list.some((a) => !states.get(a)),
    };
    return fields.every((field) => typeof request[field] !== 'boolean' || actual[field] === request[field]);
  }).map((paper) => paper.id);
  const result = { ...request, paperIds };
  for (const field of fields) delete result[field];
  const availabilityById = new Map(attachments.filter((a) => a.id).map((a) => [a.id, states.get(a)]));
  return {
    request: result,
    applyToPapers(papers) {
      return papers.map((paper) => ({
        ...paper,
        attachments: (paper.attachments ?? []).map((attachment) => availabilityById.has(attachment.id)
          ? { ...attachment, missing: !availabilityById.get(attachment.id) }
          : attachment),
      }));
    },
  };
}

async function resolveAttachmentFilterRequest(request, library) {
  return (await resolveAttachmentFilters(request, library)).request;
}

module.exports = { attachmentPath, resolveAttachmentFilters, resolveAttachmentFilterRequest };
