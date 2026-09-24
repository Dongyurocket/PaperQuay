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
  CITATION_CONTROL_TAG_PREFIX: () => CITATION_CONTROL_TAG_PREFIX,
  CITATION_CONTROL_TITLE: () => CITATION_CONTROL_TITLE,
  CITATION_STYLES: () => CITATION_STYLES,
  CITATION_STYLE_IDS: () => CITATION_STYLE_IDS,
  DEFAULT_BIBLIOGRAPHY_TITLE: () => DEFAULT_BIBLIOGRAPHY_TITLE,
  DEFAULT_CITATION_STYLE: () => DEFAULT_CITATION_STYLE,
  DOCUMENT_SCHEMA_VERSION: () => DOCUMENT_SCHEMA_VERSION,
  DOCUMENT_SETTINGS_KEYS: () => DOCUMENT_SETTINGS_KEYS,
  apaAuthorName: () => apaAuthorName,
  assignCitationNumbers: () => assignCitationNumbers,
  authorDateLabel: () => authorDateLabel,
  citationStyleKind: () => citationStyleKind,
  cleanPart: () => cleanPart,
  createCitationId: () => createCitationId,
  deriveNameParts: () => deriveNameParts,
  encodeCitationControlTag: () => encodeCitationControlTag,
  extractBibliographyTagCount: () => extractBibliographyTagCount,
  extractCitationControlTagsFromOoxml: () => extractCitationControlTagsFromOoxml,
  findStoredCitation: () => findStoredCitation,
  formatApa7: () => formatApa7,
  formatAuthorsApa: () => formatAuthorsApa,
  formatAuthorsGbt: () => formatAuthorsGbt,
  formatAuthorsIeee: () => formatAuthorsIeee,
  formatBibliographyEntry: () => formatBibliographyEntry,
  formatBibliographyLines: () => formatBibliographyLines,
  formatGbtEntry: () => formatGbtEntry,
  formatIeee: () => formatIeee,
  formatInlineApaCitation: () => formatInlineApaCitation,
  formatNumberRanges: () => formatNumberRanges,
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
  joinParts: () => joinParts,
  normalizeCitationItem: () => normalizeCitationItem,
  normalizeCitationItems: () => normalizeCitationItems,
  normalizeCitationStyle: () => normalizeCitationStyle,
  normalizeRenderGroups: () => normalizeRenderGroups,
  normalizeStoredCitations: () => normalizeStoredCitations,
  paperAuthorParts: () => paperAuthorParts,
  parseCitationControlTag: () => parseCitationControlTag,
  removeStoredCitation: () => removeStoredCitation,
  renderCitations: () => renderCitations,
  serializeStoredCitations: () => serializeStoredCitations,
  toAuthorParts: () => toAuthorParts,
  trimTrailingPeriod: () => trimTrailingPeriod,
  upsertStoredCitation: () => upsertStoredCitation,
  wrapAffixes: () => wrapAffixes
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
var CITATION_STYLE_IDS = ["gbt7714", "gbt7714-author-date", "apa7", "ieee"];
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
function formatBibliographyEntry(paper, fallbackLabel, style) {
  if (!paper && fallbackLabel) return `${trimTrailingPeriod(fallbackLabel)}.`;
  switch (style) {
    case "apa7":
      return formatApa7(paper, fallbackLabel);
    case "ieee":
      return formatIeee(paper, fallbackLabel);
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
function formatNumericInline(items, seqs) {
  const numbers = [...new Set(seqs.filter((value) => value > 0))].sort((left, right) => left - right);
  if (numbers.length === 0) return "";
  const ranges = numbers.map((value) => `${value}`).reduce((chunks, value, index, list) => {
    if (index === 0) return [value];
    const previous = list[index - 1];
    const lastChunk = chunks[chunks.length - 1];
    if (Number(value) === Number(previous) + 1) {
      const [start] = lastChunk.split("-");
      chunks[chunks.length - 1] = `${start}-${value}`;
      return chunks;
    }
    chunks.push(value);
    return chunks;
  }, []);
  const core = items.length === 1 ? `[${ranges.join(",")}]${cleanPart(items[0].locator)}` : `[${ranges.join(",")}]`;
  const prefix = items[0]?.prefix ?? null;
  const suffix = items[items.length - 1]?.suffix ?? null;
  return wrapAffixes(core, prefix, suffix);
}
function formatAuthorDateInline(items, style, resolvePaper) {
  const segments = items.map((item) => {
    const paper = resolvePaper(item.paperId);
    const year = cleanPart(paper?.year) || "n.d.";
    const locator = cleanPart(item.locator);
    const locatorText = locator ? `, ${locator}` : "";
    if (item.suppressAuthor) return `${year}${locatorText}`;
    const label = authorDateLabel(paperAuthorParts(paper), style, cleanPart(item.label) || item.paperId);
    return `${label}, ${year}${locatorText}`;
  });
  return wrapAffixes(
    `(${segments.join("; ")})`,
    items[0]?.prefix ?? null,
    items[items.length - 1]?.suffix ?? null
  );
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
    return {
      citeId: group.citeId ?? null,
      inline: kind === "numeric" ? formatNumericInline(group.items, seqs) : formatAuthorDateInline(group.items, style, lookup)
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
      style
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BIBLIOGRAPHY_CONTROL_TAG,
  BIBLIOGRAPHY_CONTROL_TITLE,
  CITATION_CONTROL_TAG_PREFIX,
  CITATION_CONTROL_TITLE,
  CITATION_STYLES,
  CITATION_STYLE_IDS,
  DEFAULT_BIBLIOGRAPHY_TITLE,
  DEFAULT_CITATION_STYLE,
  DOCUMENT_SCHEMA_VERSION,
  DOCUMENT_SETTINGS_KEYS,
  apaAuthorName,
  assignCitationNumbers,
  authorDateLabel,
  citationStyleKind,
  cleanPart,
  createCitationId,
  deriveNameParts,
  encodeCitationControlTag,
  extractBibliographyTagCount,
  extractCitationControlTagsFromOoxml,
  findStoredCitation,
  formatApa7,
  formatAuthorsApa,
  formatAuthorsGbt,
  formatAuthorsIeee,
  formatBibliographyEntry,
  formatBibliographyLines,
  formatGbtEntry,
  formatIeee,
  formatInlineApaCitation,
  formatNumberRanges,
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
  joinParts,
  normalizeCitationItem,
  normalizeCitationItems,
  normalizeCitationStyle,
  normalizeRenderGroups,
  normalizeStoredCitations,
  paperAuthorParts,
  parseCitationControlTag,
  removeStoredCitation,
  renderCitations,
  serializeStoredCitations,
  toAuthorParts,
  trimTrailingPeriod,
  upsertStoredCitation,
  wrapAffixes
});
