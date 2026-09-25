// 由 scripts/build-citation.mjs 生成，请勿手改；源文件：src/shared/citation/index.ts
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/shared/citation/index.ts
var index_exports = {};
__export(index_exports, {
  BIBLIOGRAPHY_CONTROL_TAG: () => BIBLIOGRAPHY_CONTROL_TAG,
  BIBLIOGRAPHY_CONTROL_TITLE: () => BIBLIOGRAPHY_CONTROL_TITLE,
  BIBLIOGRAPHY_PARAGRAPH_STYLE_ID: () => BIBLIOGRAPHY_PARAGRAPH_STYLE_ID,
  BIBLIOGRAPHY_PARAGRAPH_STYLE_NAME: () => BIBLIOGRAPHY_PARAGRAPH_STYLE_NAME,
  BOOKMARK_PREFIX: () => BOOKMARK_PREFIX,
  CITATION_CONTROL_TAG_PREFIX: () => CITATION_CONTROL_TAG_PREFIX,
  CITATION_CONTROL_TITLE: () => CITATION_CONTROL_TITLE,
  CITATION_STYLES: () => CITATION_STYLES,
  CITATION_STYLE_IDS: () => CITATION_STYLE_IDS,
  DEFAULT_BIBLIOGRAPHY_TITLE: () => DEFAULT_BIBLIOGRAPHY_TITLE,
  DEFAULT_CITATION_STYLE: () => DEFAULT_CITATION_STYLE,
  DEFAULT_PREFS: () => DEFAULT_PREFS,
  DOCUMENT_MODEL_NAMESPACE: () => DOCUMENT_MODEL_NAMESPACE,
  DOCUMENT_MODEL_SCHEMA_VERSION: () => DOCUMENT_MODEL_SCHEMA_VERSION,
  DOCUMENT_SCHEMA_VERSION: () => DOCUMENT_SCHEMA_VERSION,
  DOCUMENT_SETTINGS_KEYS: () => DOCUMENT_SETTINGS_KEYS,
  MODEL_FALLBACK_SETTING_KEY: () => MODEL_FALLBACK_SETTING_KEY,
  SCHEMA_VERSION_SETTING_KEY: () => SCHEMA_VERSION_SETTING_KEY,
  V1_SETTING_KEYS: () => V1_SETTING_KEYS,
  apaAuthorName: () => apaAuthorName,
  applyDuplicateSplit: () => applyDuplicateSplit,
  assignBookmarkNames: () => assignBookmarkNames,
  assignCitationNumbers: () => assignCitationNumbers,
  authorDateLabel: () => authorDateLabel,
  bookmarkIdBase: () => bookmarkIdBase,
  bookmarkNameFor: () => bookmarkNameFor,
  buildBibliographyPackage: () => buildBibliographyPackage,
  buildBibliographyParagraphs: () => buildBibliographyParagraphs,
  buildInlineCitationPackage: () => buildInlineCitationPackage,
  buildInlineCitationRuns: () => buildInlineCitationRuns,
  citationStyleKind: () => citationStyleKind,
  citedPaperIds: () => citedPaperIds,
  cleanPart: () => cleanPart,
  createCitationId: () => createCitationId,
  createDocumentId: () => createDocumentId,
  createEmptyModel: () => createEmptyModel,
  deriveNameParts: () => deriveNameParts,
  diffRender: () => diffRender,
  encodeCitationControlTag: () => encodeCitationControlTag,
  escapeXmlText: () => escapeXmlText,
  extractBibliographyTagCount: () => extractBibliographyTagCount,
  extractCitationControlTagsFromOoxml: () => extractCitationControlTagsFromOoxml,
  findCitation: () => findCitation,
  findStoredCitation: () => findStoredCitation,
  fnv1aBase36: () => fnv1aBase36,
  formatApa7: () => formatApa7,
  formatAuthorDateSegments: () => formatAuthorDateSegments,
  formatAuthorsApa: () => formatAuthorsApa,
  formatAuthorsGbt: () => formatAuthorsGbt,
  formatAuthorsGbt87: () => formatAuthorsGbt87,
  formatAuthorsIeee: () => formatAuthorsIeee,
  formatBibliographyEntry: () => formatBibliographyEntry,
  formatBibliographyLines: () => formatBibliographyLines,
  formatGbt87Entry: () => formatGbt87Entry,
  formatGbtEntry: () => formatGbtEntry,
  formatIeee: () => formatIeee,
  formatInlineApaCitation: () => formatInlineApaCitation,
  formatNumberRanges: () => formatNumberRanges,
  formatNumericSegments: () => formatNumericSegments,
  gbt87AuthorName: () => gbt87AuthorName,
  gbt87DocumentMark: () => gbt87DocumentMark,
  gbtAuthorName: () => gbtAuthorName,
  gbtDocumentMark: () => gbtDocumentMark,
  getCitationStyle: () => getCitationStyle,
  hasBibliographyControlInOoxml: () => hasBibliographyControlInOoxml,
  ieeeAuthorName: () => ieeeAuthorName,
  initialsCompact: () => initialsCompact,
  initialsWithDots: () => initialsWithDots,
  isBibliographyControlTag: () => isBibliographyControlTag,
  isCitationControlTag: () => isCitationControlTag,
  isCitationStyleId: () => isCitationStyleId,
  isCjkName: () => isCjkName,
  isCjkText: () => isCjkText,
  isNumericCitationStyle: () => isNumericCitationStyle,
  isPaperQuayBookmarkName: () => isPaperQuayBookmarkName,
  joinParts: () => joinParts,
  keepManualEdit: () => keepManualEdit,
  migrateV1Settings: () => migrateV1Settings,
  normalizeCitationItem: () => normalizeCitationItem,
  normalizeCitationItems: () => normalizeCitationItems,
  normalizeCitationStyle: () => normalizeCitationStyle,
  normalizeControlText: () => normalizeControlText,
  normalizeGbt87Punctuation: () => normalizeGbt87Punctuation,
  normalizeModel: () => normalizeModel,
  normalizePrefs: () => normalizePrefs,
  normalizeRenderGroups: () => normalizeRenderGroups,
  normalizeStoredCitations: () => normalizeStoredCitations,
  numberRanges: () => numberRanges,
  paperAuthorParts: () => paperAuthorParts,
  parseCitationControlTag: () => parseCitationControlTag,
  parseModelXml: () => parseModelXml,
  pickLatestModel: () => pickLatestModel,
  planDuplicateSplit: () => planDuplicateSplit,
  planRender: () => planRender,
  pruneModel: () => pruneModel,
  recordRendered: () => recordRendered,
  removeCitation: () => removeCitation,
  removeStoredCitation: () => removeStoredCitation,
  renderCitations: () => renderCitations,
  segmentsToText: () => segmentsToText,
  serializeModelXml: () => serializeModelXml,
  serializeStoredCitations: () => serializeStoredCitations,
  snapshotResolver: () => snapshotResolver,
  toAuthorParts: () => toAuthorParts,
  trimTrailingPeriod: () => trimTrailingPeriod,
  upsertCitation: () => upsertCitation,
  upsertSnapshots: () => upsertSnapshots,
  upsertStoredCitation: () => upsertStoredCitation,
  wrapAffixes: () => wrapAffixes,
  wrapPackage: () => wrapPackage
});
module.exports = __toCommonJS(index_exports);

// src/shared/citation/text.ts
function trimTrailingPeriod(value) {
  return value.replace(/[.。]+$/, "");
}
function cleanPart(value) {
  if (typeof value === "number" && Number.isFinite(value)) return trimTrailingPeriod(String(value));
  return trimTrailingPeriod(typeof value === "string" ? value.trim() : "");
}
var CJK_PATTERN = /[\u3000-\u9fff\uf900-\ufaff]/;
function isCjkText(value) {
  return CJK_PATTERN.test(value);
}
function isCjkName(value) {
  return !/\s/.test(value) && isCjkText(value);
}
function initialsWithDots(given) {
  return given.split(/\s+/).filter(Boolean).map((token) => `${token[0].toUpperCase()}.`).join(" ");
}
function initialsCompact(given) {
  return given.split(/\s+/).filter(Boolean).map((token) => token[0].toUpperCase()).join(" ");
}
function joinParts(parts, separator = ", ") {
  return parts.filter((part) => Boolean(part)).join(separator);
}

// src/shared/citation/styles.ts
var CITATION_STYLE_IDS = ["gbt7714", "gbt7714-87", "gbt7714-author-date", "apa7", "ieee"];
var DEFAULT_CITATION_STYLE = "gbt7714";
var CITATION_STYLES = [
  {
    id: "gbt7714",
    label: "GB/T 7714-2015 \u987A\u5E8F\u7F16\u7801\u5236",
    labelEn: "GB/T 7714-2015 (numeric)",
    kind: "numeric",
    description: "\u4E2D\u6587\u5199\u4F5C\u9ED8\u8BA4\uFF1A\u6B63\u6587 [1]\uFF0C\u6587\u732E\u8868\u6309\u5F15\u7528\u987A\u5E8F\u7F16\u53F7\uFF1B\u540C\u4E00\u6587\u732E\u59CB\u7EC8\u540C\u53F7\u3002"
  },
  {
    id: "gbt7714-87",
    label: "GB 7714-87 \u987A\u5E8F\u7F16\u7801\u5236\uFF08CAJ-CD\uFF09",
    labelEn: "GB 7714-87 (numeric, CAJ-CD)",
    kind: "numeric",
    description: "1987 \u7248\u56FD\u6807\u4E0E CAJ-CD B/T-1998 \u89C4\u8303\uFF1A\u897F\u6587\u4F5C\u8005\u59D3\u5168\u5927\u5199\u3001\u540D\u7F29\u5199\u4E0D\u52A0\u7F29\u5199\u70B9\uFF1B\u8BBA\u6587\u96C6\u6790\u51FA\u7528 [A]\u2026[C]\uFF1B\u51FA\u7248\u4FE1\u606F\u7528\u5168\u89D2\u6807\u70B9\u3002"
  },
  {
    id: "gbt7714-author-date",
    label: "GB/T 7714-2015 \u8457\u8005-\u51FA\u7248\u5E74\u5236",
    labelEn: "GB/T 7714-2015 (author-date)",
    kind: "author-date",
    description: "\u6B63\u6587 (\u5F20\u4E09, 2021)\uFF0C\u6587\u732E\u8868\u6309\u4F5C\u8005\u5B57\u6BCD\u5E8F\u6392\u5217\u3002"
  },
  {
    id: "apa7",
    label: "APA 7",
    labelEn: "APA 7th edition",
    kind: "author-date",
    description: "\u6B63\u6587 (Smith et al., 2020)\uFF0C\u6587\u732E\u8868\u6309\u4F5C\u8005\u5B57\u6BCD\u5E8F\u6392\u5217\u3002"
  },
  {
    id: "ieee",
    label: "IEEE",
    labelEn: "IEEE",
    kind: "numeric",
    description: "\u6B63\u6587 [1]\uFF0C\u6587\u732E\u8868\u6309\u5F15\u7528\u987A\u5E8F\u7F16\u53F7\uFF08IEEE \u98CE\u683C\u6761\u76EE\uFF09\u3002"
  }
];
function isCitationStyleId(value) {
  return typeof value === "string" && CITATION_STYLE_IDS.includes(value);
}
function normalizeCitationStyle(value) {
  return isCitationStyleId(value) ? value : DEFAULT_CITATION_STYLE;
}
function getCitationStyle(value) {
  const id = normalizeCitationStyle(value);
  return CITATION_STYLES.find((style) => style.id === id) ?? CITATION_STYLES[0];
}
function citationStyleKind(value) {
  return getCitationStyle(value).kind;
}
function isNumericCitationStyle(value) {
  return citationStyleKind(value) === "numeric";
}

// src/shared/citation/numbering.ts
function trimAffix(value) {
  return typeof value === "string" ? value.trim() : "";
}
function normalizeCitationItem(value) {
  if (!value || typeof value !== "object") return null;
  const record = value;
  const paperId = cleanPart(record.paperId);
  if (!paperId) return null;
  return {
    paperId,
    label: cleanPart(record.label) || null,
    locator: cleanPart(record.locator) || null,
    prefix: trimAffix(record.prefix) || null,
    suffix: trimAffix(record.suffix) || null,
    suppressAuthor: Boolean(record.suppressAuthor)
  };
}
function normalizeCitationItems(value) {
  if (!Array.isArray(value)) return [];
  const items = [];
  for (const raw of value) {
    const item = normalizeCitationItem(raw);
    if (item) items.push(item);
  }
  return items;
}
function assignCitationNumbers(items) {
  const numbers = /* @__PURE__ */ new Map();
  for (const item of items) {
    if (!numbers.has(item.paperId)) numbers.set(item.paperId, numbers.size + 1);
  }
  return numbers;
}
function formatNumberRanges(numbers) {
  const sorted = [...new Set(numbers.filter((value) => Number.isFinite(value) && value > 0))].sort(
    (left, right) => left - right
  );
  if (sorted.length === 0) return "";
  const chunks = [];
  let start = sorted[0];
  let previous = sorted[0];
  for (const current of sorted.slice(1)) {
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    chunks.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = current;
    previous = current;
  }
  chunks.push(start === previous ? `${start}` : `${start}-${previous}`);
  return chunks.join(",");
}

// src/shared/citation/documentTags.ts
var CITATION_CONTROL_TAG_PREFIX = "pq:c|";
var BIBLIOGRAPHY_CONTROL_TAG = "pq:bib";
var CITATION_CONTROL_TITLE = "PaperQuay \u5F15\u7528";
var BIBLIOGRAPHY_CONTROL_TITLE = "PaperQuay \u53C2\u8003\u6587\u732E";
var DEFAULT_BIBLIOGRAPHY_TITLE = "\u53C2\u8003\u6587\u732E";
var DOCUMENT_SCHEMA_VERSION = "1";
var DOCUMENT_SETTINGS_KEYS = {
  style: "pq:style",
  locale: "pq:locale",
  schemaVersion: "pq:schemaVersion",
  citations: "pq:citations",
  citedPaperIds: "pq:citedPaperIds",
  bibliographyControlId: "pq:bibControlId",
  documentTitle: "pq:documentTitle"
};
function createCitationId(random = Math.random) {
  return random().toString(16).slice(2, 10).padEnd(8, "0").slice(0, 8);
}
function encodeCitationControlTag(citeId) {
  return `${CITATION_CONTROL_TAG_PREFIX}${cleanPart(citeId)}`;
}
function parseCitationControlTag(tag) {
  const value = typeof tag === "string" ? tag.trim() : "";
  if (!value.startsWith(CITATION_CONTROL_TAG_PREFIX)) return null;
  const citeId = value.slice(CITATION_CONTROL_TAG_PREFIX.length).trim();
  return /^[0-9a-z]{4,32}$/i.test(citeId) ? citeId : null;
}
function isCitationControlTag(tag) {
  return parseCitationControlTag(tag) !== null;
}
function isBibliographyControlTag(tag) {
  return typeof tag === "string" && tag.trim() === BIBLIOGRAPHY_CONTROL_TAG;
}
function normalizeStoredCitations(value) {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const citations = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw;
    const citeId = cleanPart(record.citeId).toLowerCase();
    if (!/^[0-9a-z]{4,32}$/.test(citeId)) continue;
    const items = normalizeCitationItems(record.items);
    if (items.length === 0) continue;
    citations.push({
      citeId,
      items,
      updatedAt: Number(record.updatedAt) || 0
    });
  }
  return citations;
}
function serializeStoredCitations(citations) {
  return JSON.stringify(citations.map(({ citeId, items, updatedAt }) => ({ citeId, items, updatedAt })));
}
function upsertStoredCitation(citations, citation) {
  const next = citations.filter((item) => item.citeId !== citation.citeId);
  next.push(citation);
  return next;
}
function removeStoredCitation(citations, citeId) {
  return citations.filter((item) => item.citeId !== citeId);
}
function findStoredCitation(citations, citeId) {
  return citations.find((item) => item.citeId === citeId);
}
function extractCitationControlTagsFromOoxml(ooxml) {
  if (typeof ooxml !== "string" || ooxml.length === 0) return [];
  const tags = [];
  const pattern = /<w:tag\b[^>]*\bw:val="([^"]*)"/g;
  let match = pattern.exec(ooxml);
  while (match) {
    const citeId = parseCitationControlTag(match[1]);
    if (citeId) tags.push(citeId);
    match = pattern.exec(ooxml);
  }
  return tags;
}
function hasBibliographyControlInOoxml(ooxml) {
  if (typeof ooxml !== "string") return false;
  return extractBibliographyTagCount(ooxml) > 0;
}
function extractBibliographyTagCount(ooxml) {
  const pattern = /<w:tag\b[^>]*\bw:val="([^"]*)"/g;
  let count = 0;
  let match = pattern.exec(ooxml);
  while (match) {
    if (isBibliographyControlTag(match[1])) count += 1;
    match = pattern.exec(ooxml);
  }
  return count;
}

// src/shared/citation/format.ts
function deriveNameParts(raw) {
  if (!raw) return { family: "", given: "" };
  if (isCjkName(raw)) return { family: raw, given: "" };
  if (raw.includes(",")) {
    const [family, ...rest] = raw.split(",").map((part) => part.trim()).filter(Boolean);
    return { family: family ?? "", given: rest.join(" ") };
  }
  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length === 1) return { family: tokens[0], given: "" };
  return { family: tokens[tokens.length - 1], given: tokens.slice(0, -1).join(" ") };
}
function toAuthorParts(author) {
  const record = typeof author === "string" ? { name: author } : author ?? {};
  const family = cleanPart(record.familyName);
  const given = cleanPart(record.givenName);
  const raw = cleanPart(record.name) || joinParts([given, family], " ");
  const structured = Boolean(family || given);
  const derived = structured ? { family: family || raw, given } : deriveNameParts(raw);
  return {
    name: raw || derived.family,
    family: derived.family,
    given: derived.given,
    structured,
    cjk: isCjkName(derived.family || raw)
  };
}
function paperAuthorParts(paper) {
  return (paper?.authors ?? []).map((author) => toAuthorParts(author)).filter((parts) => Boolean(parts.name || parts.family));
}
function gbtAuthorName(parts) {
  if (!parts.structured || parts.cjk) return parts.name;
  const initials = initialsCompact(parts.given);
  return initials ? `${parts.family} ${initials}` : parts.family;
}
function apaAuthorName(parts) {
  if (parts.cjk) return parts.name;
  if (!parts.family) return parts.name;
  const initials = initialsWithDots(parts.given);
  return initials ? `${parts.family}, ${initials}` : parts.family;
}
function ieeeAuthorName(parts) {
  if (parts.cjk) return parts.name;
  if (!parts.family) return parts.name;
  const initials = initialsWithDots(parts.given);
  return initials ? `${initials} ${parts.family}` : parts.family;
}
function formatAuthorsGbt(parts) {
  if (parts.length === 0) return "";
  const shown = parts.slice(0, 3).map(gbtAuthorName);
  const suffix = parts.length > 3 ? parts[0].cjk ? ", \u7B49" : ", et al." : "";
  return `${shown.join(", ")}${suffix}`;
}
function formatAuthorsApa(parts) {
  if (parts.length === 0) return "";
  const shown = parts.slice(0, 3).map(apaAuthorName);
  if (parts.length > 3) return `${shown.join(", ")}, et al.`;
  if (shown.length === 1) return shown[0];
  return `${shown.slice(0, -1).join(", ")}, & ${shown[shown.length - 1]}`;
}
function formatAuthorsIeee(parts) {
  if (parts.length === 0) return "";
  const shown = parts.slice(0, 3).map(ieeeAuthorName);
  if (parts.length > 3) return `${shown.join(", ")}, et al.`;
  if (shown.length === 1) return shown[0];
  return `${shown.slice(0, -1).join(", ")}, and ${shown[shown.length - 1]}`;
}
function gbtDocumentMark(paper) {
  switch (paper?.itemType) {
    case "journalArticle":
      return "J";
    case "conferencePaper":
      return "C";
    case "book":
    case "bookSection":
      return "M";
    case "thesis":
      return "D";
    case "report":
      return "R";
    case "preprint":
      return "EB/OL";
    default:
      return paper?.publication ? "J" : "EB/OL";
  }
}
function gbt87DocumentMark(paper) {
  switch (paper?.itemType) {
    case "journalArticle":
      return "J";
    case "conferencePaper":
      return "A";
    case "book":
    case "bookSection":
      return "M";
    case "thesis":
      return "D";
    case "report":
      return "R";
    case "patent":
      return "P";
    case "preprint":
    case "webpage":
      return "EB/OL";
    default:
      return paper?.publication ? "J" : "EB/OL";
  }
}
function gbt87AuthorName(parts) {
  if (!parts.structured || parts.cjk) return parts.name;
  const family = parts.family.toUpperCase();
  const initials = initialsCompact(parts.given);
  return initials ? `${family} ${initials}` : family;
}
function formatAuthorsGbt87(parts, options = {}) {
  if (parts.length === 0) return "";
  const comma = options.punctuation === "half" ? ", " : "\uFF0C";
  const shown = parts.slice(0, 3).map(gbt87AuthorName);
  const suffix = parts.length > 3 ? parts[0].cjk ? `${comma}\u7B49` : `${comma}et al` : "";
  return `${shown.join(comma)}${suffix}`;
}
function normalizeGbt87Punctuation(value) {
  return value === "half" ? "half" : "full";
}
function formatGbt87Entry(paper, fallbackLabel, options = {}) {
  const half = options.punctuation === "half";
  const dot = half ? ". " : ".";
  const comma = half ? ", " : "\uFF0C";
  const colon = half ? ": " : "\uFF1A";
  const wrapIssue = (text) => half ? `(${text})` : `\uFF08${text}\uFF09`;
  const title = cleanPart(paper?.title) || cleanPart(fallbackLabel);
  const mark = gbt87DocumentMark(paper);
  const authors = formatAuthorsGbt87(paperAuthorParts(paper), options);
  const year = cleanPart(paper?.year);
  const publication = cleanPart(paper?.publication);
  const volume = cleanPart(paper?.volume);
  const issue = cleanPart(paper?.issue);
  const pages = cleanPart(paper?.pages);
  const publisher = cleanPart(paper?.publisher);
  const publisherPlace = cleanPart(paper?.publisherPlace);
  const institution = cleanPart(paper?.institution);
  const url = cleanPart(paper?.url);
  const volumeIssue = issue ? `${volume}${wrapIssue(issue)}` : volume;
  const placeAndPublisher = joinParts([publisherPlace, publisher], colon);
  let entry = authors ? `${trimTrailingPeriod(authors)}.${half ? " " : ""}${title}` : title;
  if (mark === "A") {
    entry += "[A]";
    if (publication) entry += `${dot}${publication}[C]`;
    const tail = joinParts([placeAndPublisher, year], comma);
    if (tail) entry += `${dot}${tail}`;
    if (pages) entry += `${colon}${pages}`;
  } else if (mark === "M" || mark === "R") {
    entry += `[${mark}]`;
    const tail = joinParts([placeAndPublisher, year], comma);
    if (tail) entry += `${dot}${tail}`;
    if (pages) entry += `${colon}${pages}`;
  } else if (mark === "D") {
    entry += "[D]";
    const holder = institution || publisher;
    const tail = joinParts([joinParts([publisherPlace, holder], colon), year], comma);
    if (tail) entry += `${dot}${tail}`;
    if (pages) entry += `${colon}${pages}`;
  } else if (mark === "P") {
    entry += "[P]";
    if (year) entry += `${dot}${year}`;
  } else if (mark === "EB/OL") {
    entry += "[EB/OL]";
    const source = placeAndPublisher || publication;
    const tail = joinParts([source, year], comma);
    if (tail) entry += `${dot}${tail}`;
    if (url) entry += `${dot}${url}`;
  } else {
    entry += "[J]";
    const tail = joinParts([publication, year, volumeIssue], comma);
    if (tail) entry += `${dot}${tail}`;
    if (pages) entry += `${colon}${pages}`;
  }
  return `${trimTrailingPeriod(entry)}.`;
}
function formatGbtEntry(paper, fallbackLabel, options = {}) {
  const title = cleanPart(paper?.title) || cleanPart(fallbackLabel);
  const mark = gbtDocumentMark(paper);
  const authors = formatAuthorsGbt(paperAuthorParts(paper));
  const year = cleanPart(paper?.year);
  const publication = cleanPart(paper?.publication);
  const volume = cleanPart(paper?.volume);
  const issue = cleanPart(paper?.issue);
  const pages = cleanPart(paper?.pages);
  const publisher = cleanPart(paper?.publisher);
  const publisherPlace = cleanPart(paper?.publisherPlace);
  const institution = cleanPart(paper?.institution);
  const doi = cleanPart(paper?.doi);
  const volumeIssue = issue ? `${volume}(${issue})` : volume;
  const placeAndPublisher = joinParts([publisherPlace, publisher], ": ");
  const yearPrefix = options.authorDate && year ? `${year}. ` : "";
  const tailYear = options.authorDate ? "" : year;
  let entry = authors ? `${trimTrailingPeriod(authors)}. ${yearPrefix}${title}` : title;
  entry += `[${mark}]`;
  if (mark === "M") {
    const tail = joinParts([placeAndPublisher, tailYear]);
    if (tail) entry += `. ${tail}`;
    if (pages) entry += `: ${pages}`;
  } else if (mark === "D") {
    const holder = publisher || institution;
    const tail = joinParts([joinParts([publisherPlace, holder], ": "), tailYear]);
    if (tail) entry += `. ${tail}`;
    if (pages) entry += `: ${pages}`;
  } else if (mark === "EB/OL") {
    const source = publication || publisher;
    const tail = joinParts([source, tailYear]);
    if (tail) entry += `. ${tail}`;
  } else if (mark === "C") {
    if (publication) entry += `//${publication}`;
    const tail = joinParts([tailYear, volumeIssue]);
    if (tail) entry += `. ${tail}`;
    if (placeAndPublisher) entry += `. ${placeAndPublisher}`;
    if (pages) entry += `: ${pages}`;
  } else {
    const tail = joinParts([publication, tailYear, volumeIssue]);
    if (tail) entry += `. ${tail}`;
    if (pages) entry += `: ${pages}`;
  }
  if (doi) entry += `. DOI: ${doi}`;
  return `${trimTrailingPeriod(entry)}.`;
}
function formatApa7(paper, fallbackLabel) {
  const title = cleanPart(paper?.title) || cleanPart(fallbackLabel);
  const authors = formatAuthorsApa(paperAuthorParts(paper));
  const year = cleanPart(paper?.year);
  const publication = cleanPart(paper?.publication);
  const volume = cleanPart(paper?.volume);
  const issue = cleanPart(paper?.issue);
  const pages = cleanPart(paper?.pages);
  const doi = cleanPart(paper?.doi);
  const url = cleanPart(paper?.url);
  let entry = authors ? `${authors} ` : "";
  entry += year ? `(${year}). ` : "(n.d.). ";
  entry += `${title}.`;
  if (publication) {
    entry += ` ${publication}`;
    if (volume) entry += `, ${volume}${issue ? `(${issue})` : ""}`;
    if (pages) entry += `, ${pages}`;
    entry += ".";
  }
  if (doi) entry += ` https://doi.org/${doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")}`;
  else if (url) entry += ` ${url}`;
  return entry;
}
function formatIeee(paper, fallbackLabel) {
  const title = cleanPart(paper?.title) || cleanPart(fallbackLabel);
  const authors = formatAuthorsIeee(paperAuthorParts(paper));
  const year = cleanPart(paper?.year);
  const publication = cleanPart(paper?.publication);
  const volume = cleanPart(paper?.volume);
  const issue = cleanPart(paper?.issue);
  const pages = cleanPart(paper?.pages);
  const doi = cleanPart(paper?.doi);
  let entry = authors ? `${authors}, ` : "";
  entry += `"${title},"`;
  if (publication) entry += ` ${publication},`;
  if (volume) entry += ` vol. ${volume},`;
  if (issue) entry += ` no. ${issue},`;
  if (pages) entry += ` pp. ${pages},`;
  if (year) entry += ` ${year}.`;
  if (doi) entry += ` doi: ${doi}.`;
  return entry;
}
function formatBibliographyEntry(paper, fallbackLabel, style, options = {}) {
  if (!paper && fallbackLabel) return `${trimTrailingPeriod(fallbackLabel)}.`;
  switch (style) {
    case "apa7":
      return formatApa7(paper, fallbackLabel);
    case "ieee":
      return formatIeee(paper, fallbackLabel);
    case "gbt7714-87":
      return formatGbt87Entry(paper, fallbackLabel, options);
    case "gbt7714-author-date":
      return formatGbtEntry(paper, fallbackLabel, { authorDate: true });
    default:
      return formatGbtEntry(paper, fallbackLabel);
  }
}
function authorDateLabel(parts, style, fallbackLabel) {
  if (parts.length === 0) return fallbackLabel;
  const surname = (item) => item.cjk ? item.name : item.family || item.name;
  if (parts.length === 1) return surname(parts[0]);
  if (parts.length === 2) return `${surname(parts[0])} & ${surname(parts[1])}`;
  const useChineseSuffix = style === "gbt7714-author-date" && parts[0].cjk;
  return `${surname(parts[0])}${useChineseSuffix ? " \u7B49" : " et al."}`;
}
function formatInlineApaCitation(paper, fallbackLabel) {
  const parts = paperAuthorParts(paper);
  const year = cleanPart(paper?.year) || "n.d.";
  if (parts.length === 0) {
    return `(${cleanPart(fallbackLabel) || cleanPart(paper?.title) || "\u6587\u732E"})`;
  }
  return `(${authorDateLabel(parts, "apa7", cleanPart(fallbackLabel))}, ${year})`;
}
function wrapAffixes(core, prefix, suffix) {
  const head = typeof prefix === "string" ? prefix.trim() : "";
  const tail = typeof suffix === "string" ? suffix.trim() : "";
  let text = core;
  if (head) text = /[(（[]$/.test(head) ? `${head}${text}` : `${head} ${text}`;
  if (tail) text = /^[,.;:，。；：)\]）]/.test(tail) ? `${text}${tail}` : `${text} ${tail}`;
  return text;
}
function segmentsToText(segments) {
  return segments.map((segment) => segment.text).join("");
}
function wrapAffixSegments(core, prefix, suffix) {
  const head = typeof prefix === "string" ? prefix.trim() : "";
  const tail = typeof suffix === "string" ? suffix.trim() : "";
  const result = [...core];
  if (head) result.unshift({ text: /[(（[]$/.test(head) ? head : `${head} ` });
  if (tail) result.push({ text: /^[,.;:，。；：)\]）]/.test(tail) ? tail : ` ${tail}` });
  return result;
}
function numberRanges(numbers) {
  const sorted = [...new Set(numbers.filter((value) => Number.isFinite(value) && value > 0))].sort(
    (left, right) => left - right
  );
  const ranges = [];
  for (const current of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && current === last[1] + 1) last[1] = current;
    else ranges.push([current, current]);
  }
  return ranges;
}
function formatNumericSegments(items, seqs) {
  const paperIdBySeq = /* @__PURE__ */ new Map();
  items.forEach((item, index) => {
    const seq = seqs[index] ?? 0;
    if (seq > 0 && !paperIdBySeq.has(seq)) paperIdBySeq.set(seq, item.paperId);
  });
  const ranges = numberRanges(seqs);
  if (ranges.length === 0) return [];
  const core = [{ text: "[" }];
  ranges.forEach(([start, end], index) => {
    if (index > 0) core.push({ text: "," });
    core.push({ text: `${start}`, paperId: paperIdBySeq.get(start) });
    if (end > start) {
      core.push({ text: "-" });
      core.push({ text: `${end}`, paperId: paperIdBySeq.get(end) });
    }
  });
  core.push({ text: "]" });
  if (items.length === 1) {
    const locator = cleanPart(items[0].locator);
    if (locator) core.push({ text: locator });
  }
  return wrapAffixSegments(core, items[0]?.prefix ?? null, items[items.length - 1]?.suffix ?? null);
}
function formatAuthorDateSegments(items, style, resolvePaper) {
  const core = [{ text: "(" }];
  items.forEach((item, index) => {
    if (index > 0) core.push({ text: "; " });
    const paper = resolvePaper(item.paperId);
    const year = cleanPart(paper?.year) || "n.d.";
    const locator = cleanPart(item.locator);
    const locatorText = locator ? `, ${locator}` : "";
    const text = item.suppressAuthor ? `${year}${locatorText}` : `${authorDateLabel(paperAuthorParts(paper), style, cleanPart(item.label) || item.paperId)}, ${year}${locatorText}`;
    core.push({ text, paperId: item.paperId });
  });
  core.push({ text: ")" });
  return wrapAffixSegments(core, items[0]?.prefix ?? null, items[items.length - 1]?.suffix ?? null);
}
function normalizeRenderGroups(request) {
  const rawGroups = Array.isArray(request?.groups) ? request.groups : null;
  if (rawGroups && rawGroups.length > 0) {
    return rawGroups.map((group) => {
      const record = group ?? {};
      return {
        citeId: cleanPart(record.citeId) || null,
        items: normalizeCitationItems(record.items)
      };
    }).filter((group) => group.items.length > 0);
  }
  const items = normalizeCitationItems(request?.items);
  return items.length > 0 ? [{ citeId: null, items }] : [];
}
function formatBibliographyLines(kind, entries) {
  return entries.map((entry) => kind === "numeric" ? `[${entry.seq}] ${entry.text}` : entry.text);
}
function renderCitations(request, resolvePaper) {
  const groups = normalizeRenderGroups(request ?? {});
  const style = normalizeCitationStyle(request?.style);
  const kind = citationStyleKind(style);
  const flatItems = groups.flatMap((group) => group.items);
  const seqByPaperId = assignCitationNumbers(flatItems);
  const cache = /* @__PURE__ */ new Map();
  const missing = /* @__PURE__ */ new Set();
  const lookup = (paperId) => {
    if (!cache.has(paperId)) {
      const paper = resolvePaper(paperId);
      cache.set(paperId, paper);
      if (!paper) missing.add(paperId);
    }
    return cache.get(paperId);
  };
  const renderedGroups = groups.map((group) => {
    const seqs = group.items.map((item) => seqByPaperId.get(item.paperId) ?? 0);
    const segments = kind === "numeric" ? formatNumericSegments(group.items, seqs) : formatAuthorDateSegments(group.items, style, lookup);
    return {
      citeId: group.citeId ?? null,
      inline: segmentsToText(segments),
      segments
    };
  });
  const labelByPaperId = /* @__PURE__ */ new Map();
  for (const item of flatItems) {
    if (!labelByPaperId.has(item.paperId)) labelByPaperId.set(item.paperId, cleanPart(item.label));
  }
  let orderedPaperIds = [...seqByPaperId.keys()];
  if (kind === "author-date" && request?.bibliographyOrder !== "appearance") {
    orderedPaperIds = orderedPaperIds.slice().sort((left, right) => {
      const leftParts = paperAuthorParts(lookup(left));
      const rightParts = paperAuthorParts(lookup(right));
      const leftKey = leftParts[0]?.family || leftParts[0]?.name || labelByPaperId.get(left) || left;
      const rightKey = rightParts[0]?.family || rightParts[0]?.name || labelByPaperId.get(right) || right;
      const byAuthor = leftKey.localeCompare(rightKey);
      if (byAuthor !== 0) return byAuthor;
      const byYear = (cleanPart(lookup(left)?.year) || "").localeCompare(cleanPart(lookup(right)?.year) || "");
      if (byYear !== 0) return byYear;
      return left.localeCompare(right);
    });
  }
  const entries = orderedPaperIds.map((paperId, index) => {
    const text = formatBibliographyEntry(
      lookup(paperId),
      labelByPaperId.get(paperId) || paperId,
      style,
      { punctuation: normalizeGbt87Punctuation(request?.punctuation) }
    );
    return {
      paperId,
      seq: kind === "numeric" ? seqByPaperId.get(paperId) ?? index + 1 : index + 1,
      text,
      missing: missing.has(paperId)
    };
  });
  return {
    style,
    kind,
    inline: renderedGroups[0]?.inline ?? "",
    groups: renderedGroups,
    entries,
    bibliography: formatBibliographyLines(kind, entries).join("\n"),
    bibliographyTitle: cleanPart(request?.bibliographyTitle) || "\u53C2\u8003\u6587\u732E",
    missingPaperIds: [...missing]
  };
}

// src/shared/citation/wordOoxml.ts
var BIBLIOGRAPHY_PARAGRAPH_STYLE_ID = "PaperQuayBibliography";
var BIBLIOGRAPHY_PARAGRAPH_STYLE_NAME = "PaperQuay \u53C2\u8003\u6587\u732E";
var BOOKMARK_PREFIX = "_PQ_";
var BOOKMARK_MAX_LENGTH = 40;
var W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
var R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
function escapeXmlText(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function fnv1aBase36(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36);
}
function bookmarkNameFor(paperId, taken) {
  const base = `${BOOKMARK_PREFIX}${fnv1aBase36(cleanPart(paperId) || "x")}`;
  let candidate = base;
  let counter = 2;
  while (taken.has(candidate)) {
    candidate = `${base}_${counter}`.slice(0, BOOKMARK_MAX_LENGTH);
    counter += 1;
  }
  taken.add(candidate);
  return candidate;
}
function assignBookmarkNames(paperIds) {
  const taken = /* @__PURE__ */ new Set();
  const names = /* @__PURE__ */ new Map();
  for (const paperId of paperIds) {
    if (!names.has(paperId)) names.set(paperId, bookmarkNameFor(paperId, taken));
  }
  return names;
}
function isPaperQuayBookmarkName(name) {
  return typeof name === "string" && name.startsWith(BOOKMARK_PREFIX);
}
function runProperties(options) {
  const parts = [];
  if (options.plainLink) parts.push('<w:color w:val="auto"/><w:u w:val="none"/>');
  if (options.superscript) parts.push('<w:vertAlign w:val="superscript"/>');
  return parts.length > 0 ? `<w:rPr>${parts.join("")}</w:rPr>` : "";
}
function textRun(text, options = {}) {
  if (!text) return "";
  return `<w:r>${runProperties(options)}<w:t xml:space="preserve">${escapeXmlText(text)}</w:t></w:r>`;
}
function buildInlineCitationRuns(segments, options = {}) {
  const superscript = Boolean(options.superscript);
  return segments.map((segment) => {
    const anchor = segment.paperId ? options.bookmarks?.get(segment.paperId) : void 0;
    if (!anchor) return textRun(segment.text, { superscript });
    return `<w:hyperlink w:anchor="${escapeXmlText(anchor)}" w:history="1">` + textRun(segment.text, { superscript, plainLink: true }) + `</w:hyperlink>`;
  }).join("");
}
function paragraph(inner, styleId) {
  const pPr = styleId ? `<w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>` : "";
  return `<w:p>${pPr}${inner}</w:p>`;
}
function buildBibliographyParagraphs(entries, options) {
  const parts = [];
  if (options.heading) parts.push(paragraph(textRun(cleanPart(options.title))));
  let bookmarkId = options.bookmarkIdBase ?? 1e3;
  for (const entry of entries) {
    const label = options.kind === "numeric" ? `[${entry.seq}]` : "";
    const body = (label ? `${textRun(label)}<w:r><w:tab/></w:r>` : "") + textRun(String(entry.text ?? "").trim());
    const name = options.bookmarks?.get(entry.paperId);
    if (name) {
      const id = bookmarkId;
      bookmarkId += 1;
      parts.push(
        paragraph(
          `<w:bookmarkStart w:id="${id}" w:name="${escapeXmlText(name)}"/>${body}<w:bookmarkEnd w:id="${id}"/>`,
          BIBLIOGRAPHY_PARAGRAPH_STYLE_ID
        )
      );
    } else {
      parts.push(paragraph(body, BIBLIOGRAPHY_PARAGRAPH_STYLE_ID));
    }
  }
  return parts.join("");
}
function stylesPart(kind) {
  const indent = kind === "numeric" ? '<w:ind w:left="425" w:hanging="425"/>' : '<w:ind w:left="420" w:hanging="420"/>';
  const tabs = kind === "numeric" ? '<w:tabs><w:tab w:val="left" w:pos="425"/></w:tabs>' : "";
  return `<w:styles xmlns:w="${W_NS}"><w:style w:type="paragraph" w:customStyle="1" w:styleId="${BIBLIOGRAPHY_PARAGRAPH_STYLE_ID}"><w:name w:val="${BIBLIOGRAPHY_PARAGRAPH_STYLE_NAME}"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr>${tabs}${indent}</w:pPr></w:style></w:styles>`;
}
function wrapPackage(bodyXml, withStyles = null) {
  const documentRels = withStyles ? `<pkg:part pkg:name="/word/_rels/document.xml.rels" pkg:contentType="application/vnd.openxmlformats-package.relationships+xml"><pkg:xmlData><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R_NS}/styles" Target="styles.xml"/></Relationships></pkg:xmlData></pkg:part>` : "";
  const styles = withStyles ? `<pkg:part pkg:name="/word/styles.xml" pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"><pkg:xmlData>${stylesPart(withStyles)}</pkg:xmlData></pkg:part>` : "";
  return `<pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage"><pkg:part pkg:name="/_rels/.rels" pkg:contentType="application/vnd.openxmlformats-package.relationships+xml"><pkg:xmlData><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R_NS}/officeDocument" Target="word/document.xml"/></Relationships></pkg:xmlData></pkg:part>` + documentRels + `<pkg:part pkg:name="/word/document.xml" pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"><pkg:xmlData><w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>${bodyXml}</w:body></w:document></pkg:xmlData></pkg:part>` + styles + `</pkg:package>`;
}
function buildInlineCitationPackage(segments, options = {}) {
  return wrapPackage(`<w:p>${buildInlineCitationRuns(segments, options)}</w:p>`);
}
function buildBibliographyPackage(entries, options) {
  return wrapPackage(buildBibliographyParagraphs(entries, options), options.kind);
}
function bookmarkIdBase(random = Math.random) {
  return 1e5 + Math.floor(random() * 8e5);
}

// src/shared/citation/documentModel.ts
var DOCUMENT_MODEL_NAMESPACE = "urn:paperquay:word:v2";
var DOCUMENT_MODEL_SCHEMA_VERSION = 2;
var SCHEMA_VERSION_SETTING_KEY = "pq:schemaVersion";
var MODEL_FALLBACK_SETTING_KEY = "pq:model";
var DEFAULT_PREFS = {
  style: "gbt7714",
  bibliographyTitle: "\u53C2\u8003\u6587\u732E",
  bibHeading: true,
  superscript: false,
  punctuation: "full",
  links: true,
  bibliographyOrder: "alpha"
};
function createDocumentId(random = Math.random) {
  return `doc-${random().toString(16).slice(2, 10)}${Date.now().toString(16)}`;
}
function createEmptyModel(documentId = createDocumentId()) {
  return { schemaVersion: 2, documentId, rev: 0, prefs: { ...DEFAULT_PREFS }, citations: [], items: {} };
}
function asRecord(value) {
  return value && typeof value === "object" ? value : {};
}
function normalizePrefs(value) {
  const record = asRecord(value);
  return {
    style: normalizeCitationStyle(record.style),
    bibliographyTitle: cleanPart(record.bibliographyTitle) || DEFAULT_PREFS.bibliographyTitle,
    bibHeading: record.bibHeading !== false,
    superscript: record.superscript === true,
    punctuation: record.punctuation === "half" ? "half" : "full",
    links: record.links !== false,
    bibliographyOrder: record.bibliographyOrder === "appearance" ? "appearance" : "alpha"
  };
}
var CITE_ID_PATTERN = /^[0-9a-z]{4,32}$/;
function normalizeModel(value) {
  const record = asRecord(value);
  const citations = [];
  const seen = /* @__PURE__ */ new Set();
  for (const raw of Array.isArray(record.citations) ? record.citations : []) {
    const entry = asRecord(raw);
    const citeId = cleanPart(entry.citeId).toLowerCase();
    if (!CITE_ID_PATTERN.test(citeId) || seen.has(citeId)) continue;
    const items2 = normalizeCitationItems(entry.items);
    if (items2.length === 0) continue;
    seen.add(citeId);
    citations.push({
      citeId,
      items: items2,
      lastText: typeof entry.lastText === "string" ? entry.lastText : void 0,
      lastSignature: typeof entry.lastSignature === "string" ? entry.lastSignature : void 0,
      manualText: typeof entry.manualText === "string" ? entry.manualText : void 0,
      updatedAt: Number(entry.updatedAt) || 0
    });
  }
  const items = {};
  for (const [paperId, raw] of Object.entries(asRecord(record.items))) {
    const snapshot = asRecord(raw);
    if (!paperId || !snapshot.paper || typeof snapshot.paper !== "object") continue;
    items[paperId] = {
      paper: snapshot.paper,
      fetchedAt: Number(snapshot.fetchedAt) || 0,
      ...snapshot.missing === true ? { missing: true } : {}
    };
  }
  return {
    schemaVersion: 2,
    documentId: cleanPart(record.documentId) || createDocumentId(),
    rev: Math.max(0, Math.floor(Number(record.rev) || 0)),
    prefs: normalizePrefs(record.prefs),
    citations,
    items
  };
}
function serializeModelXml(model) {
  const json = JSON.stringify(model).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  return `<?xml version="1.0" encoding="UTF-8"?><pq:model xmlns:pq="${DOCUMENT_MODEL_NAMESPACE}" rev="${model.rev}"><![CDATA[${json}]]></pq:model>`;
}
function parseModelXml(xml) {
  if (typeof xml !== "string" || !xml.includes(DOCUMENT_MODEL_NAMESPACE)) return null;
  const match = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(xml);
  if (!match) return null;
  try {
    return normalizeModel(JSON.parse(match[1]));
  } catch {
    return null;
  }
}
function pickLatestModel(xmls) {
  let best = null;
  let index = -1;
  xmls.forEach((xml, position) => {
    const model = parseModelXml(xml);
    if (model && (!best || model.rev >= best.rev)) {
      best = model;
      index = position;
    }
  });
  return { model: best, index };
}
function migrateV1Settings(getSetting) {
  const model = createEmptyModel(cleanPart(getSetting("pq:documentId")) || createDocumentId());
  const stored = normalizeStoredCitations(getSetting("pq:citations"));
  model.citations = stored.map((citation) => ({
    citeId: citation.citeId,
    items: citation.items,
    updatedAt: citation.updatedAt
  }));
  const title = cleanPart(getSetting("pq:bibliographyTitle"));
  model.prefs = normalizePrefs({
    style: getSetting("pq:style"),
    bibliographyTitle: title || DEFAULT_PREFS.bibliographyTitle,
    bibHeading: getSetting("pq:bibHeading") !== "0",
    superscript: getSetting("pq:superscript") === "1",
    punctuation: getSetting("pq:punctuation"),
    links: getSetting("pq:crossref") !== "0"
  });
  return model;
}
var V1_SETTING_KEYS = [
  "pq:style",
  "pq:locale",
  "pq:citations",
  "pq:citedPaperIds",
  "pq:bibControlId",
  "pq:documentTitle",
  "pq:bibliographyTitle",
  "pq:bibHeading",
  "pq:superscript",
  "pq:punctuation",
  "pq:crossref"
];
function findCitation(model, citeId) {
  return model.citations.find((citation) => citation.citeId === citeId);
}
function upsertCitation(model, citation) {
  const citations = model.citations.filter((item) => item.citeId !== citation.citeId);
  citations.push(citation);
  return { ...model, citations };
}
function removeCitation(model, citeId) {
  return { ...model, citations: model.citations.filter((item) => item.citeId !== citeId) };
}
function upsertSnapshots(model, papers, missingIds = [], now = Date.now()) {
  const items = { ...model.items };
  for (const paper of papers) {
    const paperId = cleanPart(paper?.id);
    if (paperId) items[paperId] = { paper, fetchedAt: now };
  }
  for (const paperId of missingIds) {
    const existing = items[paperId];
    if (existing) items[paperId] = { ...existing, missing: true };
  }
  return { ...model, items };
}
function citedPaperIds(model, orderedCiteIds) {
  const order = orderedCiteIds ?? model.citations.map((citation) => citation.citeId);
  const ids = [];
  for (const citeId of order) {
    for (const item of findCitation(model, citeId)?.items ?? []) {
      if (!ids.includes(item.paperId)) ids.push(item.paperId);
    }
  }
  return ids;
}
function pruneModel(model, presentCiteIds) {
  const present = new Set(presentCiteIds);
  const citations = model.citations.filter((citation) => present.has(citation.citeId));
  const used = /* @__PURE__ */ new Set();
  for (const citation of citations) {
    for (const item of citation.items) used.add(item.paperId);
  }
  const items = {};
  for (const [paperId, snapshot] of Object.entries(model.items)) {
    if (used.has(paperId)) items[paperId] = snapshot;
  }
  return { ...model, citations, items };
}
function planDuplicateSplit(ordered, createId) {
  const counts = /* @__PURE__ */ new Map();
  const taken = new Set(ordered);
  const plan = [];
  for (const citeId of ordered) {
    const occurrence = counts.get(citeId) ?? 0;
    counts.set(citeId, occurrence + 1);
    if (occurrence === 0) continue;
    let newCiteId = createId();
    while (taken.has(newCiteId)) newCiteId = createId();
    taken.add(newCiteId);
    plan.push({ citeId, occurrence, newCiteId });
  }
  return plan;
}
function applyDuplicateSplit(model, ordered, plan) {
  if (plan.length === 0) return { model, ordered };
  const counts = /* @__PURE__ */ new Map();
  const nextOrdered = ordered.map((citeId) => {
    const occurrence = counts.get(citeId) ?? 0;
    counts.set(citeId, occurrence + 1);
    const hit = plan.find((entry) => entry.citeId === citeId && entry.occurrence === occurrence);
    return hit ? hit.newCiteId : citeId;
  });
  let nextModel = model;
  for (const entry of plan) {
    const source = findCitation(model, entry.citeId);
    if (!source) continue;
    nextModel = upsertCitation(nextModel, {
      citeId: entry.newCiteId,
      items: source.items.map((item) => ({ ...item })),
      updatedAt: Date.now()
    });
  }
  return { model: nextModel, ordered: nextOrdered };
}
function snapshotResolver(model) {
  return (paperId) => model.items[paperId]?.paper;
}
function planRender(model, ordered, options) {
  const groups = [];
  for (const citeId of ordered) {
    const citation = findCitation(model, citeId);
    if (citation) groups.push({ citeId, items: citation.items });
  }
  const prefs = model.prefs;
  const render = renderCitations(
    {
      style: prefs.style,
      groups,
      bibliographyTitle: prefs.bibliographyTitle,
      bibliographyOrder: prefs.bibliographyOrder,
      punctuation: prefs.punctuation
    },
    snapshotResolver(model)
  );
  const linked = prefs.links && options.hasBibliography && render.entries.length > 0;
  const bookmarks = linked ? assignBookmarkNames(render.entries.map((entry) => entry.paperId)) : /* @__PURE__ */ new Map();
  const superscript = prefs.superscript && render.kind === "numeric";
  const citations = [];
  for (const group of render.groups) {
    if (!group.citeId) continue;
    const ooxml = buildInlineCitationPackage(group.segments, { bookmarks, superscript });
    citations.push({ citeId: group.citeId, text: group.inline, ooxml, signature: fnv1aBase36(ooxml) });
  }
  const bibliographyOoxml = buildBibliographyPackage(render.entries, {
    kind: render.kind,
    heading: prefs.bibHeading,
    title: prefs.bibliographyTitle,
    bookmarks,
    bookmarkIdBase: options.bookmarkIdBase
  });
  const lines = render.entries.map(
    (entry) => render.kind === "numeric" ? `[${entry.seq}] ${entry.text}` : entry.text
  );
  const bibliographyText = [...prefs.bibHeading ? [prefs.bibliographyTitle] : [], ...lines].join("\n");
  return { render, citations, bibliographyOoxml, bibliographyText, linked, bookmarks };
}
var INVISIBLE_SPACES = new RegExp(`[${String.fromCharCode(8203, 160, 12288)}]`, "g");
function normalizeControlText(value) {
  return String(value ?? "").replace(INVISIBLE_SPACES, " ").replace(/\s+/g, " ").trim();
}
function diffRender(model, currentTexts, outputs) {
  const diff = { rewrite: [], manualEdits: [], kept: [], unchanged: [] };
  for (const output of outputs) {
    const citation = findCitation(model, output.citeId);
    const current = normalizeControlText(currentTexts.get(output.citeId));
    const expected = normalizeControlText(output.text);
    const last = citation?.lastText !== void 0 ? normalizeControlText(citation.lastText) : void 0;
    if (citation?.manualText !== void 0 && current === normalizeControlText(citation.manualText)) {
      diff.kept.push(output.citeId);
      continue;
    }
    if (last !== void 0 && current && current !== last && current !== expected) {
      diff.manualEdits.push({
        citeId: output.citeId,
        currentText: currentTexts.get(output.citeId) ?? "",
        expectedText: output.text
      });
      continue;
    }
    if (citation?.lastSignature !== output.signature || current !== expected) diff.rewrite.push(output.citeId);
    else diff.unchanged.push(output.citeId);
  }
  return diff;
}
function recordRendered(model, outputs, written) {
  const writtenSet = new Set(written);
  const byId = /* @__PURE__ */ new Map();
  for (const output of outputs) byId.set(output.citeId, output);
  return {
    ...model,
    citations: model.citations.map((citation) => {
      const output = byId.get(citation.citeId);
      if (!output || !writtenSet.has(citation.citeId)) return citation;
      return {
        citeId: citation.citeId,
        items: citation.items,
        updatedAt: citation.updatedAt,
        lastText: output.text,
        lastSignature: output.signature
      };
    })
  };
}
function keepManualEdit(model, citeId, currentText) {
  return {
    ...model,
    citations: model.citations.map(
      (citation) => citation.citeId === citeId ? { ...citation, manualText: currentText } : citation
    )
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BIBLIOGRAPHY_CONTROL_TAG,
  BIBLIOGRAPHY_CONTROL_TITLE,
  BIBLIOGRAPHY_PARAGRAPH_STYLE_ID,
  BIBLIOGRAPHY_PARAGRAPH_STYLE_NAME,
  BOOKMARK_PREFIX,
  CITATION_CONTROL_TAG_PREFIX,
  CITATION_CONTROL_TITLE,
  CITATION_STYLES,
  CITATION_STYLE_IDS,
  DEFAULT_BIBLIOGRAPHY_TITLE,
  DEFAULT_CITATION_STYLE,
  DEFAULT_PREFS,
  DOCUMENT_MODEL_NAMESPACE,
  DOCUMENT_MODEL_SCHEMA_VERSION,
  DOCUMENT_SCHEMA_VERSION,
  DOCUMENT_SETTINGS_KEYS,
  MODEL_FALLBACK_SETTING_KEY,
  SCHEMA_VERSION_SETTING_KEY,
  V1_SETTING_KEYS,
  apaAuthorName,
  applyDuplicateSplit,
  assignBookmarkNames,
  assignCitationNumbers,
  authorDateLabel,
  bookmarkIdBase,
  bookmarkNameFor,
  buildBibliographyPackage,
  buildBibliographyParagraphs,
  buildInlineCitationPackage,
  buildInlineCitationRuns,
  citationStyleKind,
  citedPaperIds,
  cleanPart,
  createCitationId,
  createDocumentId,
  createEmptyModel,
  deriveNameParts,
  diffRender,
  encodeCitationControlTag,
  escapeXmlText,
  extractBibliographyTagCount,
  extractCitationControlTagsFromOoxml,
  findCitation,
  findStoredCitation,
  fnv1aBase36,
  formatApa7,
  formatAuthorDateSegments,
  formatAuthorsApa,
  formatAuthorsGbt,
  formatAuthorsGbt87,
  formatAuthorsIeee,
  formatBibliographyEntry,
  formatBibliographyLines,
  formatGbt87Entry,
  formatGbtEntry,
  formatIeee,
  formatInlineApaCitation,
  formatNumberRanges,
  formatNumericSegments,
  gbt87AuthorName,
  gbt87DocumentMark,
  gbtAuthorName,
  gbtDocumentMark,
  getCitationStyle,
  hasBibliographyControlInOoxml,
  ieeeAuthorName,
  initialsCompact,
  initialsWithDots,
  isBibliographyControlTag,
  isCitationControlTag,
  isCitationStyleId,
  isCjkName,
  isCjkText,
  isNumericCitationStyle,
  isPaperQuayBookmarkName,
  joinParts,
  keepManualEdit,
  migrateV1Settings,
  normalizeCitationItem,
  normalizeCitationItems,
  normalizeCitationStyle,
  normalizeControlText,
  normalizeGbt87Punctuation,
  normalizeModel,
  normalizePrefs,
  normalizeRenderGroups,
  normalizeStoredCitations,
  numberRanges,
  paperAuthorParts,
  parseCitationControlTag,
  parseModelXml,
  pickLatestModel,
  planDuplicateSplit,
  planRender,
  pruneModel,
  recordRendered,
  removeCitation,
  removeStoredCitation,
  renderCitations,
  segmentsToText,
  serializeModelXml,
  serializeStoredCitations,
  snapshotResolver,
  toAuthorParts,
  trimTrailingPeriod,
  upsertCitation,
  upsertSnapshots,
  upsertStoredCitation,
  wrapAffixes,
  wrapPackage
});
