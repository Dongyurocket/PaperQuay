const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');

const TRANSLATED_KIND = 'translated-pdf';
const PARSE_FILES = ['content_list_v2.json', 'content_list.json', 'middle.json', 'full.md'];

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function sanitizeTitle(value) {
  return clean(value).toLowerCase()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'document';
}

function attachmentPath(attachment, storageDir) {
  const relative = clean(attachment.relativePath);
  if (relative && storageDir) return path.resolve(storageDir, relative);
  const candidate = clean(attachment.storedPath) || clean(attachment.originalPath);
  return candidate ? path.resolve(candidate) : null;
}

function fileLocation(paperId, role, sourceIdentity, filePath, fileName, extra = {}) {
  return {
    id: `literature-location:${stableHash(`${paperId}\0${role}\0${sourceIdentity}\0${filePath}`)}`,
    paperId,
    role,
    path: filePath,
    fileName: fileName || path.basename(filePath),
    status: 'available',
    ...extra,
  };
}

async function statKind(targetPath) {
  try {
    const stat = await fs.stat(targetPath);
    if (stat.isFile()) return 'file';
    if (stat.isDirectory()) return 'directory';
  } catch {}
  return null;
}

async function addPathLocation(locations, paperId, role, sourceIdentity, targetPath, extra = {}) {
  if (!targetPath) return;
  const kind = await statKind(targetPath);
  if (!kind) return;
  locations.push(fileLocation(paperId, role, sourceIdentity, targetPath, path.basename(targetPath), {
    targetKind: kind,
    ...extra,
  }));
}

function expectedPathLocation(paperId, role, sourceIdentity, targetPath, extra = {}) {
  return fileLocation(paperId, role, sourceIdentity, targetPath, path.basename(targetPath), {
    status: 'not-generated',
    targetKind: role === 'parse-directory' || role === 'parse-images' ? 'directory' : 'file',
    versionStatus: 'version-unverified',
    ...extra,
  });
}

function mineruCacheDirectories(appPaths, paper, pdfPath) {
  if (!pdfPath) return [];
  const itemKey = paper.id;
  const workspaceId = `native-library:${paper.id}`;
  const cacheRoot = appPaths.mineruCacheDir;
  const keys = [
    `document-${stableHash(workspaceId)}`,
    `${sanitizeTitle(paper.title)}-${stableHash(workspaceId)}`,
    `${sanitizeTitle(paper.title)}-${stableHash(itemKey)}`,
  ];
  return [...new Set(keys)].map((name) => path.join(cacheRoot, name));
}

async function addGenerationArtifactLocations(locations, paper, knowledgeStore) {
  if (!knowledgeStore?.listGenerationArtifacts) return;
  const sourceIds = [...new Set([paper.id, `native-library:${paper.id}`])];
  for (const sourceId of sourceIds) {
    for (const generation of knowledgeStore.listGenerationArtifacts(sourceId)) {
      const artifactRoot = clean(generation.artifactPath);
      if (!artifactRoot || !Array.isArray(generation.manifest)) continue;
      const root = path.resolve(artifactRoot);
      for (const artifact of generation.manifest) {
        const relative = clean(artifact?.path).replace(/\\/g, '/');
        if (!relative || path.posix.isAbsolute(relative) || relative.split('/').some((part) => part === '..' || part === '.')) continue;
        const target = path.resolve(root, ...relative.split('/'));
        if (target === root || !target.startsWith(`${root}${path.sep}`)) continue;
        let status = 'missing';
        let versionStatus = 'version-verified';
        try {
          const stat = await fs.lstat(target);
          if (!stat.isFile() || stat.isSymbolicLink()) {
            versionStatus = 'version-unverified';
          } else if (stat.size !== artifact.size) {
            status = 'version-mismatch';
            versionStatus = 'version-unverified';
          } else {
            const bytes = await fs.readFile(target);
            const digest = crypto.createHash('sha256').update(bytes).digest('hex');
            if (digest === clean(artifact.sha256).toLowerCase()) status = 'available';
            else {
              status = 'version-mismatch';
              versionStatus = 'version-unverified';
            }
          }
        } catch {}
        const role = relative.toLowerCase().endsWith('.md')
          ? 'parsed-markdown'
          : relative.toLowerCase().endsWith('.json') ? 'parse-json' : 'parse-artifact';
        const location = fileLocation(paper.id, role,
          `generation:${generation.generationId}:${generation.sourceVersion}:${relative}:${artifact.sha256}`,
          target, path.basename(relative), {
            generationId: generation.generationId,
            sourceVersion: generation.sourceVersion,
            artifactRelativePath: relative,
            status,
            targetKind: 'file',
            versionStatus,
            isCurrentGeneration: generation.currentGeneration === generation.generationId,
          });
        locations.push(location);
      }
    }
  }
}

async function listEvidenceFileLocations({ paper, knowledgeStore, evidenceId }) {
  const evidence = knowledgeStore?.getEvidenceSpan?.(clean(evidenceId));
  if (!evidence || !evidence.quoteIntegrity || evidence.sourceType !== 'paddle-normalized' ||
    !evidence.parseGeneration || ![paper?.id, `native-library:${paper?.id}`].includes(evidence.sourceId)) return [];

  const generations = knowledgeStore.listGenerationArtifacts?.(evidence.sourceId) || [];
  const generation = generations.find((item) => item.generationId === evidence.parseGeneration &&
    item.sourceVersion === evidence.sourceVersion);
  const locations = [];
  if (!generation || !clean(generation.artifactPath) || !Array.isArray(generation.manifest)) {
    return [fileLocation(paper.id, 'evidence-artifact', `evidence:${evidence.evidenceId}:${evidence.sourceVersionId}`,
      path.join('unavailable-evidence', evidence.evidenceId), null, {
        evidenceId: evidence.evidenceId,
        generationId: evidence.parseGeneration,
        sourceVersion: evidence.sourceVersion,
        status: 'missing',
        targetKind: 'file',
        versionStatus: 'version-unverified',
        isCurrentGeneration: false,
      })];
  }

  await addGenerationArtifactLocations(locations, paper, {
    listGenerationArtifacts: (sourceId) => sourceId === evidence.sourceId ? [generation] : [],
  });
  return locations.map((location) => ({
    ...location,
    evidenceId: evidence.evidenceId,
    locatorStatus: evidence.locatorStatus,
    pageIndex: evidence.pageIndex,
    printedPage: evidence.printedPage,
    isCurrentGeneration: generation.currentGeneration === generation.generationId,
  }));
}

async function listLiteratureFileLocations({ paper, appPaths, settings, knowledgeStore }) {
  const locations = [];
  const attachments = Array.isArray(paper?.attachments) ? paper.attachments : [];
  const storageDir = clean(settings?.storageDir);
  const pdfs = attachments.filter((item) => item.kind === 'pdf');
  const sourcePdfPaths = [];

  for (const attachment of pdfs) {
    const target = attachmentPath(attachment, storageDir);
    if (!target) continue;
    sourcePdfPaths.push(target);
    const available = await statKind(target);
    locations.push(fileLocation(paper.id, 'original-pdf', `${attachment.id}:${attachment.contentHash || ''}`, target,
      attachment.fileName || path.basename(target), {
        attachmentId: attachment.id,
        contentHash: attachment.contentHash || null,
        status: available === 'file' ? 'available' : 'missing',
        targetKind: 'file',
        versionStatus: 'version-unverified',
      }));
  }

  for (const attachment of attachments.filter((item) => item.kind === TRANSLATED_KIND)) {
    const target = attachmentPath(attachment, storageDir);
    if (!target) continue;
    const available = await statKind(target);
    locations.push(fileLocation(paper.id, 'translated-pdf', `${attachment.id}:${attachment.contentHash || ''}`, target,
      attachment.fileName || path.basename(target), {
        attachmentId: attachment.id,
        language: clean(attachment.language) || null,
        contentHash: attachment.contentHash || null,
        status: available === 'file' ? 'available' : 'missing',
        targetKind: 'file',
        versionStatus: 'version-unverified',
      }));
  }

  for (const attachment of attachments.filter((item) => item.kind !== 'pdf' && item.kind !== TRANSLATED_KIND)) {
    const target = attachmentPath(attachment, storageDir);
    if (!target) continue;
    const available = await statKind(target);
    const markdown = /\.markdown?$/i.test(attachment.fileName || target) || /markdown/i.test(attachment.mimeType || '');
    locations.push(fileLocation(paper.id, markdown ? 'associated-markdown' : `associated:${attachment.kind || 'file'}`,
      `${attachment.id}:${attachment.contentHash || ''}`, target,
      attachment.fileName || path.basename(target), {
        attachmentId: attachment.id,
        contentHash: attachment.contentHash || null,
        status: available === 'file' ? 'available' : 'missing',
        targetKind: 'file',
        versionStatus: 'version-unverified',
      }));
  }

  const documentSource = pdfs[0];
  const documentPath = documentSource ? attachmentPath(documentSource, storageDir) : null;
  for (const directory of mineruCacheDirectories(appPaths, paper, documentPath)) {
    if (!documentSource) break;
    const sourceIdentity = `${documentSource.id}:${documentSource.contentHash || ''}`;
    const beforeDirectoryCount = locations.length;
    await addPathLocation(locations, paper.id, 'parse-directory', sourceIdentity, directory, {
      versionStatus: 'version-unverified',
    });
    if (locations.length === beforeDirectoryCount) {
      locations.push(expectedPathLocation(paper.id, 'parse-directory', sourceIdentity, directory));
    }
    for (const name of PARSE_FILES) {
      const role = name.endsWith('.md') ? 'parsed-markdown' : 'parse-json';
      const file = path.join(directory, name);
      const beforeCount = locations.length;
      await addPathLocation(locations, paper.id, role, sourceIdentity, file, { versionStatus: 'version-unverified' });
      if (locations.length === beforeCount) locations.push(expectedPathLocation(paper.id, role, sourceIdentity, file));
    }
    const imagesDir = path.join(directory, 'images');
    const beforeImagesCount = locations.length;
    await addPathLocation(locations, paper.id, 'parse-images', sourceIdentity, imagesDir, {
      versionStatus: 'version-unverified',
    });
    if (locations.length === beforeImagesCount) locations.push(expectedPathLocation(paper.id, 'parse-images', sourceIdentity, imagesDir));
  }

  // Sibling parse files are considered only beside a PDF registered to this paper.
  for (const pdfPath of [...new Set(sourcePdfPaths.filter(Boolean))]) {
    const directory = path.dirname(pdfPath);
    const sourceIdentity = `registered-pdf:${pdfPath}`;
    for (const name of PARSE_FILES) {
      await addPathLocation(locations, paper.id, name.endsWith('.md') ? 'parsed-markdown' : 'parse-json',
        sourceIdentity, path.join(directory, name), { versionStatus: 'version-unverified' });
    }
    await addPathLocation(locations, paper.id, 'parse-images', sourceIdentity, path.join(directory, 'images'), {
      versionStatus: 'version-unverified',
    });
  }

  await addGenerationArtifactLocations(locations, paper, knowledgeStore);

  if (!pdfs.length && paper?.source !== 'local') {
    locations.push({
      id: `literature-location:${stableHash(`${paper.id}\0remote-only`)}`,
      paperId: paper.id,
      role: 'original-pdf',
      fileName: null,
      status: 'remote-only',
      targetKind: null,
      versionStatus: 'unverified',
    });
  }

  return locations;
}

module.exports = { addGenerationArtifactLocations, listEvidenceFileLocations, listLiteratureFileLocations, mineruCacheDirectories, stableHash };
