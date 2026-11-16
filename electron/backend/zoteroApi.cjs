const fsp = require('node:fs/promises');
const path = require('node:path');
const { cleanString, readRequestJson, safeFileName } = require('./utils.cjs');

const ZOTERO_API_BASE = 'https://api.zotero.org';

function zoteroHeaders(apiKey) {
  const trimmed = cleanString(apiKey);
  if (!trimmed) throw new Error('Zotero API key cannot be empty');

  return {
    Accept: 'application/json',
    'Zotero-API-Key': trimmed,
    'Zotero-API-Version': '3',
  };
}

function creatorName(creator) {
  if (creator?.name) return cleanString(creator.name);
  return [creator?.firstName, creator?.lastName].map(cleanString).filter(Boolean).join(' ');
}

function creatorSummary(creators) {
  const names = (creators ?? []).map(creatorName).filter(Boolean);
  if (names.length === 0) return '';
  if (names.length <= 2) return names.join(', ');
  return `${names[0]} et al.`;
}

function creatorDetails(creators) {
  return (creators ?? [])
    .map((creator) => {
      const givenName = cleanString(creator?.firstName);
      const familyName = cleanString(creator?.lastName);
      const name = cleanString(creator?.name) || [givenName, familyName].filter(Boolean).join(' ');
      return {
        name,
        givenName: givenName || undefined,
        familyName: familyName || undefined,
        affiliation: cleanString(creator?.affiliation) || undefined,
        orcid: cleanString(creator?.ORCID || creator?.orcid) || undefined,
      };
    })
    .filter((creator) => creator.name);
}

function yearFromDate(date) {
  return cleanString(date).match(/\d{4}/)?.[0] ?? '';
}

function safePdfFilename(input, fallbackKey) {
  const name = safeFileName(input || `${fallbackKey}.pdf`);
  return name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`;
}

async function loadPdfChild(apiKey, userId, itemKey) {
  const response = await fetch(
    `${ZOTERO_API_BASE}/users/${encodeURIComponent(userId)}/items/${encodeURIComponent(itemKey)}/children?format=json&limit=100`,
    { headers: zoteroHeaders(apiKey) },
  );
  const children = await readRequestJson(response, 'Zotero child items');

  return (children ?? []).find((child) =>
    child?.data?.itemType === 'attachment' && child?.data?.contentType === 'application/pdf',
  ) ?? null;
}

async function lookupZoteroKey(apiKey) {
  const trimmed = cleanString(apiKey);
  if (!trimmed) throw new Error('Zotero API key cannot be empty');

  const response = await fetch(`${ZOTERO_API_BASE}/keys/${encodeURIComponent(trimmed)}`, {
    headers: zoteroHeaders(trimmed),
  });
  const data = await readRequestJson(response, 'Zotero key');

  return {
    userId: String(data.userID ?? data.user_id ?? ''),
    username: data.username ?? undefined,
  };
}

async function listZoteroLibraryItems(options) {
  const apiKey = cleanString(options.apiKey);
  const userId = cleanString(options.userId);
  const limit = Math.max(1, Math.min(50, options.limit ?? 20));

  if (!apiKey) throw new Error('Zotero API key cannot be empty');
  if (!userId) throw new Error('Zotero user id cannot be empty');

  const response = await fetch(
    `${ZOTERO_API_BASE}/users/${encodeURIComponent(userId)}/items/top?format=json&sort=dateModified&direction=desc&limit=${limit}`,
    { headers: zoteroHeaders(apiKey) },
  );
  const items = await readRequestJson(response, 'Zotero items');
  const output = [];

  for (const item of items ?? []) {
    const itemType = item?.data?.itemType || 'unknown';
    const directAttachment = itemType === 'attachment' && item?.data?.contentType === 'application/pdf' ? item : null;
    const attachment = directAttachment ?? await loadPdfChild(apiKey, userId, item.key);

    output.push({
      itemKey: item.key,
      title: cleanString(item?.data?.title) || 'Untitled',
      creators: creatorSummary(item?.data?.creators),
      authors: creatorDetails(item?.data?.creators),
      year: yearFromDate(item?.data?.date),
      itemType,
      language: cleanString(item?.data?.language) || undefined,
      extra: cleanString(item?.data?.extra) || undefined,
      attachmentKey: attachment?.key,
      attachmentTitle: attachment?.data?.title,
      attachmentFilename: attachment?.data?.filename,
      localPdfPath: undefined,
    });
  }

  return output;
}

async function downloadZoteroAttachmentPdf(options, appPaths) {
  const apiKey = cleanString(options.apiKey);
  const userId = cleanString(options.userId);
  const attachmentKey = cleanString(options.attachmentKey);

  if (!apiKey) throw new Error('Zotero API key cannot be empty');
  if (!userId) throw new Error('Zotero user id cannot be empty');
  if (!attachmentKey) throw new Error('Zotero attachment key cannot be empty');

  await fsp.mkdir(appPaths.remotePdfDownloadDir, { recursive: true });
  const filename = safePdfFilename(options.filename, attachmentKey);
  const outputPath = path.join(appPaths.remotePdfDownloadDir, `${Buffer.from(attachmentKey).toString('base64url')}-${filename}`);
  const response = await fetch(
    `${ZOTERO_API_BASE}/users/${encodeURIComponent(userId)}/items/${encodeURIComponent(attachmentKey)}/file`,
    { headers: zoteroHeaders(apiKey) },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Zotero download failed: HTTP ${response.status} ${text}`);
  }

  await fsp.writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
  return { path: outputPath, filename };
}

module.exports = {
  creatorSummary,
  lookupZoteroKey,
  listZoteroLibraryItems,
  downloadZoteroAttachmentPdf,
  yearFromDate,
};
