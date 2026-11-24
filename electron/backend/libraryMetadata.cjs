const { cleanString } = require('./utils.cjs');
const { fetchJsonLimited } = require('./httpIO.cjs');
const {
  canonicalizeBcp47Language,
  normalizeOrcid,
} = require('./metadataValidation.cjs');
const {
  normalizeDoi,
  normalizeTitleForDuplicate,
} = require('../shared/libraryDomain.cjs');

const OPENALEX_API_BASE = 'https://api.openalex.org';
const LIBRARY_REFERENCE_PROGRESS_EVENT = 'paperquay://library-reference-progress';
const MAX_CROSSREF_REFERENCES_PER_PAPER = 200;

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    if (Array.isArray(value)) {
      const nextValue = value.find((item) => typeof item === 'string' && item.trim());
      if (nextValue) return nextValue.trim();
    }
  }

  return null;
}

function normalizeYear(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  const text = cleanString(value);
  const match = text.match(/\b(18|19|20|21)\d{2}\b/);
  return match?.[0] ?? null;
}

function doiUrl(doi) {
  const normalized = normalizeDoi(doi);
  return normalized ? `https://doi.org/${normalized}` : '';
}

function normalizeTitleForMatching(value) {
  return normalizeTitleForDuplicate(value);
}

function titleTokens(value) {
  return normalizeTitleForMatching(value)
    .split(' ')
    .filter((token) => token.length > 1);
}

function diceCoefficient(left, right) {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);

  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }

  const rightCounts = new Map();
  for (const token of rightTokens) {
    rightCounts.set(token, (rightCounts.get(token) ?? 0) + 1);
  }

  let matches = 0;
  for (const token of leftTokens) {
    const count = rightCounts.get(token) ?? 0;
    if (count <= 0) continue;
    matches += 1;
    rightCounts.set(token, count - 1);
  }

  return (2 * matches) / (leftTokens.length + rightTokens.length);
}

function titleSimilarity(left, right) {
  const normalizedLeft = normalizeTitleForMatching(left);
  const normalizedRight = normalizeTitleForMatching(right);

  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }

  if (normalizedLeft === normalizedRight) {
    return 1;
  }

  const shorter = normalizedLeft.length < normalizedRight.length ? normalizedLeft : normalizedRight;
  const longer = normalizedLeft.length < normalizedRight.length ? normalizedRight : normalizedLeft;
  const containmentScore = shorter.length >= 16 && longer.includes(shorter)
    ? Math.min(0.92, shorter.length / Math.max(longer.length, 1) + 0.18)
    : 0;

  return Math.max(diceCoefficient(normalizedLeft, normalizedRight), containmentScore);
}

function bestOpenAlexTitleMatch(results, requestedTitle) {
  const candidates = (Array.isArray(results) ? results : [])
    .map((item) => ({
      item,
      score: titleSimilarity(requestedTitle, firstString(item?.title, item?.display_name)),
    }))
    .filter((candidate) => candidate.score >= 0.78)
    .sort((left, right) => right.score - left.score);

  return candidates[0]?.item ?? null;
}

function buildUrl(base, params) {
  const url = new URL(base);

  for (const [key, value] of Object.entries(params ?? {})) {
    const normalized = cleanString(value);
    if (normalized) {
      url.searchParams.set(key, normalized);
    }
  }

  return url.toString();
}

function hasMetadataValue(metadata) {
  return Boolean(
    metadata &&
    (
      cleanString(metadata.doi) ||
      cleanString(metadata.title) ||
      cleanString(metadata.year) ||
      cleanString(metadata.publication) ||
      cleanString(metadata.url) ||
      cleanString(metadata.abstractText) ||
      cleanString(metadata.language) ||
      (Array.isArray(metadata.authors) && metadata.authors.length > 0) ||
      (Array.isArray(metadata.authorDetails) && metadata.authorDetails.length > 0)
    ),
  );
}

function safeNormalizeOrcid(value) {
  try {
    return normalizeOrcid(value);
  } catch {
    return null;
  }
}

function abstractFromOpenAlexInvertedIndex(invertedIndex) {
  if (!invertedIndex || typeof invertedIndex !== 'object') {
    return null;
  }

  const positionedWords = [];

  for (const [word, positions] of Object.entries(invertedIndex)) {
    if (!Array.isArray(positions)) continue;

    for (const position of positions) {
      if (Number.isInteger(position) && position >= 0) {
        positionedWords[position] = word;
      }
    }
  }

  const abstract = positionedWords.filter(Boolean).join(' ').trim();
  return abstract || null;
}

function mapOpenAlexWork(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const publication =
    item.primary_location?.source?.display_name ||
    item.host_venue?.display_name ||
    item.locations?.find((location) => location?.source?.display_name)?.source?.display_name ||
    null;
  const doi = normalizeDoi(item.doi);

  return {
    source: 'openalex',
    doi: doi || null,
    title: firstString(item.title, item.display_name),
    authors: (item.authorships ?? [])
      .map((authorship) => cleanString(authorship?.author?.display_name))
      .filter(Boolean),
    year: normalizeYear(item.publication_year ?? item.publication_date),
    publication: cleanString(publication) || null,
    url: firstString(item.primary_location?.landing_page_url, item.doi, item.id),
    abstractText: abstractFromOpenAlexInvertedIndex(item.abstract_inverted_index),
  };
}

function mapCrossrefWork(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  return {
    source: 'crossref',
    doi: normalizeDoi(item.DOI) || null,
    title: firstString(item.title),
    authors: (item.author ?? [])
      .map((author) => [author.given, author.family].filter(Boolean).join(' ') || author.name)
      .map(cleanString)
      .filter(Boolean),
    authorDetails: (item.author ?? [])
      .map((author) => {
        const givenName = cleanString(author.given) || null;
        const familyName = cleanString(author.family) || null;
        const name = cleanString([givenName, familyName].filter(Boolean).join(' ') || author.name);
        const affiliation = Array.isArray(author.affiliation)
          ? author.affiliation.map((item) => cleanString(item?.name)).filter(Boolean).join('; ')
          : '';
        return {
          name,
          givenName,
          familyName,
          affiliation: affiliation || null,
          orcid: safeNormalizeOrcid(author.ORCID),
        };
      })
      .filter((author) => author.name),
    language: canonicalizeBcp47Language(item.language),
    year: normalizeYear(item.issued?.['date-parts']?.[0]?.[0] ?? item.published?.['date-parts']?.[0]?.[0]),
    publication: firstString(item['container-title']),
    url: firstString(item.URL, doiUrl(item.DOI)),
    abstractText: firstString(item.abstract),
  };
}

function mergeMetadataResults(...results) {
  const usefulResults = results.filter(hasMetadataValue);
  if (usefulResults.length === 0) {
    return null;
  }

  const merged = {
    source: usefulResults.map((result) => result.source).join('+'),
    doi: null,
    title: null,
    authors: [],
    authorDetails: [],
    language: null,
    year: null,
    publication: null,
    url: null,
    abstractText: null,
  };

  for (const result of usefulResults) {
    merged.doi ||= cleanString(result.doi) || null;
    merged.title ||= cleanString(result.title) || null;
    merged.year ||= cleanString(result.year) || null;
    merged.publication ||= cleanString(result.publication) || null;
    merged.url ||= cleanString(result.url) || null;
    merged.abstractText ||= cleanString(result.abstractText) || null;
    merged.language ||= canonicalizeBcp47Language(result.language) || null;

    if (merged.authors.length === 0 && Array.isArray(result.authors) && result.authors.length > 0) {
      merged.authors = result.authors.map(cleanString).filter(Boolean);
    }
    if (merged.authorDetails.length === 0 && Array.isArray(result.authorDetails) && result.authorDetails.length > 0) {
      merged.authorDetails = result.authorDetails
        .map((author) => ({
          name: cleanString(author?.name),
          givenName: cleanString(author?.givenName) || null,
          familyName: cleanString(author?.familyName) || null,
          affiliation: cleanString(author?.affiliation) || null,
          orcid: safeNormalizeOrcid(author?.orcid),
        }))
        .filter((author) => author.name);
    }
  }

  if (merged.authorDetails.length === 0) delete merged.authorDetails;
  if (!merged.language) delete merged.language;

  return merged;
}

async function lookupOpenAlexMetadata({ doi, title, settings, limits }) {
  if (settings?.openAlexEnabled === false) {
    return null;
  }

  const params = {
    api_key: settings?.openAlexApiKey,
    mailto: settings?.openAlexMailto,
  };
  let endpoint = '';

  if (doi) {
    endpoint = buildUrl(`${OPENALEX_API_BASE}/works/${encodeURIComponent(doiUrl(doi))}`, params);
  } else if (title) {
    endpoint = buildUrl(`${OPENALEX_API_BASE}/works`, {
      ...params,
      filter: `title.search:${title}`,
      'per-page': '10',
    });
  }

  if (!endpoint) {
    return null;
  }

  const data = await fetchJsonLimited(endpoint, 'OpenAlex metadata', limits);
  const item = doi ? data : bestOpenAlexTitleMatch(data?.results, title);
  return mapOpenAlexWork(item);
}

async function lookupCrossrefMetadata({ doi, title, limits }) {
  const endpoint = doi
    ? `https://api.crossref.org/works/${encodeURIComponent(doi)}`
    : title
      ? `https://api.crossref.org/works?rows=1&query.title=${encodeURIComponent(title)}`
      : '';

  if (!endpoint) {
    return null;
  }

  const data = await fetchJsonLimited(endpoint, 'Crossref metadata', limits);
  const item = doi ? data.message : data.message?.items?.[0];
  return mapCrossrefWork(item);
}

function emitLibraryReferenceProgress(sender, payload) {
  if (!sender || typeof sender.send !== 'function') {
    return;
  }

  sender.send('paperquay:event', LIBRARY_REFERENCE_PROGRESS_EVENT, {
    updatedAt: Date.now(),
    ...payload,
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function crossrefReferenceTitle(reference) {
  return firstString(
    reference?.['article-title'],
    reference?.articleTitle,
    reference?.title,
    reference?.['series-title'],
  );
}

function crossrefReferenceJournal(reference) {
  return firstString(
    reference?.['journal-title'],
    reference?.journalTitle,
    reference?.['volume-title'],
    reference?.['container-title'],
  );
}

function mapCrossrefReference(reference, index, paperId) {
  const doi = normalizeDoi(reference?.DOI || reference?.doi);
  const title = crossrefReferenceTitle(reference);
  const unstructured = firstString(reference?.unstructured, reference?.key);

  return {
    id: `ref:${paperId}:${index + 1}`,
    paperId,
    seq: index + 1,
    doi,
    title: title || '',
    authors: firstString(reference?.author) || '',
    year: normalizeYear(reference?.year),
    journal: crossrefReferenceJournal(reference) || '',
    volume: cleanString(reference?.volume),
    issue: cleanString(reference?.issue),
    pages: firstString(reference?.['first-page'], reference?.page, reference?.pages) || '',
    unstructured: unstructured || '',
  };
}

async function fetchCrossrefReferences(doi, paperId = '', limits) {
  const normalizedDoi = normalizeDoi(doi);
  if (!normalizedDoi) {
    return [];
  }

  const endpoint = `https://api.crossref.org/works/${encodeURIComponent(normalizedDoi)}`;
  const data = await fetchJsonLimited(endpoint, 'Crossref references', limits);
  const references = Array.isArray(data?.message?.reference) ? data.message.reference : [];

  return references
    .slice(0, MAX_CROSSREF_REFERENCES_PER_PAPER)
    .map((reference, index) => mapCrossrefReference(reference, index, paperId))
    .filter((reference) => reference.doi || reference.title || reference.unstructured);
}

function createLibraryMetadataCommands({ store, httpLimits }) {
  return {
    async library_fetch_paper_references({ paperId, force = false }) {
      const targetPaperId = cleanString(paperId);
      if (!targetPaperId) {
        throw new Error('Paper id is required');
      }

      const library = store.load();
      const paper = library.papers.find((item) => item.id === targetPaperId);
      if (!paper) {
        throw new Error('Paper does not exist');
      }

      if (!paper.doi) {
        return { paperId: targetPaperId, fetched: 0, skipped: true, references: [] };
      }

      const cached = store.loadReferences(targetPaperId);
      if (!force && cached.length > 0) {
        return { paperId: targetPaperId, fetched: cached.length, skipped: true, references: cached };
      }

      const refs = await fetchCrossrefReferences(paper.doi, targetPaperId, httpLimits);
      const saved = store.saveReferences(targetPaperId, refs);
      return { paperId: targetPaperId, fetched: saved.length, skipped: false, references: saved };
    },

    async library_fetch_all_references({ force = false } = {}, event) {
      const papers = store.load().papers.filter((paper) => normalizeDoi(paper.doi));
      let fetched = 0;
      let skipped = 0;
      let failed = 0;

      emitLibraryReferenceProgress(event?.sender, {
        status: 'running',
        current: 0,
        total: papers.length,
        fetched,
        skipped,
        failed,
      });

      for (const [index, paper] of papers.entries()) {
        const cached = store.loadReferences(paper.id);
        if (!force && cached.length > 0) {
          skipped += 1;
          emitLibraryReferenceProgress(event?.sender, {
            status: 'running',
            current: index + 1,
            total: papers.length,
            paperId: paper.id,
            title: paper.title,
            fetched,
            skipped,
            failed,
          });
          await delay(50);
          continue;
        }

        try {
          const refs = await fetchCrossrefReferences(paper.doi, paper.id, httpLimits);
          store.saveReferences(paper.id, refs);
          fetched += 1;
        } catch (error) {
          failed += 1;
          console.warn(`[PaperQuay] Failed to fetch Crossref references for ${paper.id}: ${error instanceof Error ? error.message : String(error)}`);
        }

        emitLibraryReferenceProgress(event?.sender, {
          status: 'running',
          current: index + 1,
          total: papers.length,
          paperId: paper.id,
          title: paper.title,
          fetched,
          skipped,
          failed,
        });
        await delay(50);
      }

      const result = { fetched, skipped, failed };
      emitLibraryReferenceProgress(event?.sender, {
        status: failed > 0 ? 'error' : 'done',
        current: papers.length,
        total: papers.length,
        ...result,
      });
      return result;
    },

    async lookup_literature_metadata({ request }) {
      const library = store.load();
      const doi = normalizeDoi(request?.doi);
      const title = cleanString(request?.title);
      if (!doi && !title) return null;

      const [openAlexResult, crossrefResult] = await Promise.all([
        lookupOpenAlexMetadata({ doi, title, settings: library.settings, limits: httpLimits }).catch(() => null),
        lookupCrossrefMetadata({ doi, title, limits: httpLimits }).catch(() => null),
      ]);

      return mergeMetadataResults(openAlexResult, crossrefResult);
    },
  };
}

module.exports = { createLibraryMetadataCommands, fetchCrossrefReferences };
