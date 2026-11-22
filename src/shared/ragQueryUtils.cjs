const SHORT_SYMBOL_STOPWORDS = new Set([
  'in', 'on', 'at', 'of', 'to', 'is', 'it', 'as', 'by', 'or', 'an', 'be',
  'we', 'he', 'do', 'go', 'if', 'no', 'so', 'up', 'my', 'us', 'vs', 'am',
  'pm', 'ok', 'ai', 'qa', 'id', 'et', 'al', 'eg', 'ie', 'the', 'and', 'for',
  'not', 'are', 'was', 'has', 'had', 'can', 'use', 'via', 'per', 'all', 'its',
  'fig', 'tab', 'sec', 'ref', 'eq', 'eqs', 'tag', 'km', 'kg', 'mm', 'hz',
]);

const CJK_CHAR_CLASS = '\\u4e00-\\u9fff\\u3040-\\u30ff\\uac00-\\ud7af';
const CJK_STOP_BOUNDARY_RE = /(?:的|了|吗|呢|是|在|和|与|从|由|到|为|中|里|有|把|被|将|让|给|什么|哪里来|哪儿来|哪来的|怎么|如何|为什么|哪些|哪个|请问|帮我|一下)+/g;

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function stripRagQueryTemplateNoise(rawQuery) {
  const trimmed = cleanText(rawQuery);
  if (!trimmed) {
    return { question: '', excerpt: '', combined: '' };
  }

  const match = trimmed.match(/^Question:\s*([\s\S]*?)(?:\n{2,}Selected excerpt:\s*([\s\S]*))?$/);
  if (!match) {
    return { question: trimmed, excerpt: '', combined: trimmed };
  }

  const question = cleanText(match[1]);
  const excerpt = cleanText(match[2]);
  const combined = [question, excerpt].filter(Boolean).join('\n');
  return { question, excerpt, combined };
}

function pushUnique(target, seen, value, maxItems = 32) {
  const normalized = cleanText(value);
  if (!normalized || seen.has(normalized) || target.length >= maxItems) {
    return;
  }
  seen.add(normalized);
  target.push(normalized);
}

function expandNumericSequence(rawSegment) {
  const cleaned = cleanText(rawSegment);
  if (!cleaned) return [];

  const rangeMatch = cleaned.match(/^[（(]?\s*(\d{1,3})\s*[)）]?\s*(?:[-–—~～至到])\s*[（(]?\s*(\d{1,3})\s*[)）]?$/);
  if (rangeMatch) {
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    if (Number.isInteger(start) && Number.isInteger(end) && end >= start && end - start <= 10) {
      return Array.from({ length: end - start + 1 }, (_, index) => String(start + index));
    }
  }

  const matches = cleaned.match(/\d{1,3}(?:\.\d{1,2})?/g) ?? [];
  return matches;
}

function extractFormulaNumbers(text, { includeStandaloneParens = true } = {}) {
  const source = cleanText(text);
  if (!source) return [];

  const numbers = [];
  const seen = new Set();

  const explicitPattern =
    /(?:公式|方程|等式|式|Equations?|Eqs?\.?)\s*([（(]?\s*\d{1,3}(?:\.\d{1,2})?\s*[)）]?(?:\s*(?:[-–—~～至到,，、]|and)\s*[（(]?\s*\d{1,3}(?:\.\d{1,2})?\s*[)）]?){0,5})/gi;
  for (const match of source.matchAll(explicitPattern)) {
    const body = match[1] ?? '';
    for (const part of body.split(/[,，、]|\band\b/i)) {
      for (const number of expandNumericSequence(part)) {
        pushUnique(numbers, seen, number, 12);
      }
    }
  }

  if (includeStandaloneParens) {
    const parenPattern = /(?:^|[\s,，。：:;；])[(（](\d{1,2}(?:\.\d{1,2})?)[)）](?=$|[\s,，。：:;；的里中])/g;
    for (const match of source.matchAll(parenPattern)) {
      pushUnique(numbers, seen, match[1], 12);
    }
  }

  return numbers;
}

function extractReferenceNumbers(text) {
  const source = cleanText(text);
  if (!source) return [];

  const numbers = [];
  const seen = new Set();

  const bracketPattern = /\[(\d{1,3}(?:\s*(?:[-–—]|,|，)\s*\d{1,3})*)\]/g;
  for (const match of source.matchAll(bracketPattern)) {
    const body = match[1] ?? '';
    for (const part of body.split(/[,，]/)) {
      for (const number of expandNumericSequence(part)) {
        pushUnique(numbers, seen, number, 12);
      }
    }
  }

  const explicitRefPatterns = [
    /(?:参考文献|文献|引文|资料|Ref\.?|Refs\.?|Reference|References)\s*(?:中的)?(?:第\s*)?(\d{1,3})\s*(?:条|篇|号)?/gi,
    /第\s*(\d{1,3})\s*条(?:参考文献|文献|引文)/gi,
  ];
  for (const pattern of explicitRefPatterns) {
    for (const match of source.matchAll(pattern)) {
      pushUnique(numbers, seen, match[1], 12);
    }
  }

  return numbers;
}

function hasSourceOriginIntent(text) {
  const source = cleanText(text);
  if (!source) return false;
  return /(?:哪里来|哪儿来|出自|来源|出处|哪篇|参考文献|引用自|引自|依据|出处是|who\s+proposed|derived\s+from|where\s+does[\s\S]{0,40}come\s+from|source\s+of|reference|cite[sd]?)/i.test(source);
}

function extractShortSymbolTokens(text) {
  const source = cleanText(text);
  if (!source) return [];

  const symbols = [];
  const seen = new Set();
  const tokenPattern = new RegExp(`(^|[^A-Za-z0-9_])([A-Za-z](?:_[A-Za-z0-9]{1,3}|[A-Za-z0-9]{1,2}))(?=$|[^A-Za-z0-9_])`, 'g');

  for (const match of source.matchAll(tokenPattern)) {
    const token = match[2];
    if (!token) continue;
    const lower = token.toLowerCase();
    if (SHORT_SYMBOL_STOPWORDS.has(lower)) continue;
    if (/^\d+$/.test(token)) continue;
    // Skip normal 3-letter English words unless they have an underscore or typical coefficient/metric pattern.
    if (token.length === 3 && !token.includes('_') && !/^[cC][a-zA-Z0-9]{2}$/.test(token) && /^[a-z]{3}$/.test(token)) {
      continue;
    }
    pushUnique(symbols, seen, token, 8);
  }

  return symbols;
}

function buildSymbolLatexVariants(symbol) {
  const cleaned = cleanText(symbol);
  if (!cleaned) return [];

  const variants = [];
  const seen = new Set();

  const underscoreMatch = cleaned.match(/^([A-Za-z])_([A-Za-z0-9]{1,3})$/);
  const compactMatch = cleaned.match(/^([A-Za-z])([A-Za-z0-9]{1,2})$/);
  const base = underscoreMatch?.[1] ?? compactMatch?.[1] ?? '';
  const sub = underscoreMatch?.[2] ?? compactMatch?.[2] ?? '';

  if (base && sub) {
    const upperBase = base.toUpperCase();
    const lowerBase = base.toLowerCase();
    const lowerSub = sub.toLowerCase();
    const spacedSub = lowerSub.split('').join(' ');

    for (const candidate of [
      `${upperBase} _{${lowerSub}}`,
      `${upperBase}_{${lowerSub}}`,
      `${upperBase}_${lowerSub}`,
      `${lowerBase} _{${lowerSub}}`,
      `${lowerBase}_{${lowerSub}}`,
      ...(spacedSub !== lowerSub ? [`${upperBase} _{${spacedSub}}`, `${lowerBase} _{${spacedSub}}`] : []),
    ]) {
      pushUnique(variants, seen, candidate, 8);
    }
  }

  return variants;
}

function tokenizeMixedLanguageText(text) {
  const source = cleanText(text);
  if (!source) return [];

  const tokens = [];
  const seen = new Set();
  const segmentRegex = new RegExp(`([A-Za-z0-9_]+|[${CJK_CHAR_CLASS}]+|[\\p{L}\\p{N}_]+)`, 'gu');

  for (const match of source.matchAll(segmentRegex)) {
    const segment = match[1];
    if (!segment) continue;

    if (new RegExp(`^[${CJK_CHAR_CLASS}]+$`, 'u').test(segment)) {
      if (segment.length <= 6) {
        pushUnique(tokens, seen, segment, 32);
      } else {
        const parts = segment
          .split(CJK_STOP_BOUNDARY_RE)
          .map((part) => part.trim())
          .filter((part) => part.length >= 2);
        for (const part of parts) {
          pushUnique(tokens, seen, part, 32);
        }
        if (parts.length === 0) {
          pushUnique(tokens, seen, segment, 32);
        }
      }
      continue;
    }

    pushUnique(tokens, seen, segment, 32);
  }

  return tokens;
}

function buildFtsMatchQuery(value) {
  const { question, excerpt, combined } = stripRagQueryTemplateNoise(value);
  const effectiveText = question || combined;
  if (!effectiveText) {
    return '';
  }

  const terms = [];
  const seen = new Set();
  const formulaNumbers = extractFormulaNumbers(combined);
  const referenceNumbers = extractReferenceNumbers(combined);
  const shortSymbols = extractShortSymbolTokens(question || combined);

  // Add formula, reference, and math-subscript expansions first so query boilerplate
  // never crowds out high-signal formula identifiers within the 32-term FTS limit.
  for (const num of formulaNumbers) {
    pushUnique(terms, seen, `tag{${num}}`, 32);
    pushUnique(terms, seen, `(${num})`, 32);
    pushUnique(terms, seen, `Eq. ${num}`, 32);
    pushUnique(terms, seen, `Eqs. ${num}`, 32);
  }

  for (const refNum of referenceNumbers) {
    pushUnique(terms, seen, `[${refNum}]`, 32);
    if (refNum.length >= 2) {
      pushUnique(terms, seen, `${refNum}.`, 32);
    }
  }

  for (const symbol of shortSymbols) {
    for (const variant of buildSymbolLatexVariants(symbol)) {
      pushUnique(terms, seen, variant, 32);
    }
  }

  for (const token of tokenizeMixedLanguageText(effectiveText)) {
    pushUnique(terms, seen, token, 32);
  }

  // If excerpt was present and question alone produced very few terms, include excerpt tokens.
  if (excerpt && terms.length < 6) {
    for (const token of tokenizeMixedLanguageText(excerpt.slice(0, 400))) {
      pushUnique(terms, seen, token, 32);
    }
  }

  return terms
    .slice(0, 32)
    .map((term) => `"${term.replace(/"/g, '""')}"`)
    .join(' OR ');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compactMathSpaces(text) {
  return String(text ?? '')
    .replace(/\s*_\s*\{\s*([^{}]+?)\s*\}/g, (_m, sub) => `_${sub.replace(/\s+/g, '')}`)
    .replace(/\s*\^\s*\{\s*([^{}]+?)\s*\}/g, (_m, sup) => `^${sup.replace(/\s+/g, '')}`)
    .replace(/(\d)\.\s+(\d)/g, '$1.$2');
}

function chunkMatchesFormulaNumber(text, rawNum) {
  const source = cleanText(text);
  const num = cleanText(rawNum);
  if (!source || !num) return false;

  const escaped = escapeRegExp(num);
  if (new RegExp(`\\\\tag\\{\\s*${escaped}\\s*\\}`).test(source)) {
    return true;
  }

  if (new RegExp(`\\\\label\\{(?:eq:)?\\s*${escaped}\\s*\\}`, 'i').test(source)) {
    return true;
  }

  // Standalone equation number (6) in plain-text/pdf-text formulas, avoiding prose citations like "Eq. (6)".
  const parenRegex = new RegExp(`(?:^|\\s|,|\\.)${escapeRegExp(`(${num})`)}(?=\\s*$|[.,;]|\\s+[A-Za-z0-9\\\\$])`, 'gm');
  for (const match of source.matchAll(parenRegex)) {
    const matchIndex = match.index ?? 0;
    const beforeShort = source.slice(Math.max(0, matchIndex - 32), matchIndex + 1);
    if (/(?:Eqs?|Equations?|Formula|Formulas|式|公式|方程|等式)\.?(?:\s|\(\d+(?:\.\d+)?\)|[,，、\-–—]|and|or|与|和)*$/i.test(beforeShort)) {
      continue;
    }

    const lineStart = source.lastIndexOf('\n', matchIndex) + 1;
    const nextNewline = source.indexOf('\n', matchIndex);
    const lineEnd = nextNewline === -1 ? source.length : nextNewline;
    const localWindow = source.slice(
      Math.max(lineStart, matchIndex - 120),
      Math.min(lineEnd, matchIndex + 80),
    );
    if (/[=\\]/.test(localWindow) || /\b(?:sin|cos|tan|exp|log|sqrt|frac|sum)\b/i.test(localWindow)) {
      return true;
    }
  }

  return false;
}

function chunkMatchesReferenceEntry(text, rawNum) {
  const source = cleanText(text);
  const num = cleanText(rawNum);
  if (!source || !num) return false;

  const escaped = escapeRegExp(num);
  const entryAtStart = new RegExp(`(?:^|\\n)\\s*(?:\\[\\s*${escaped}\\s*\\]|${escaped}[.)]\\s+[A-Z\\u4e00-\\u9fff])`);
  if (entryAtStart.test(source)) {
    return true;
  }

  // Merged pdf-text or grouped reference block: "... 18. Leishman JG (2000)...", "... 18. J. G. Leishman...", "[18] Smith..."
  const inlineBibEntry = new RegExp(
    `(?:^|\\s)(?:\\[\\s*${escaped}\\s*\\]\\s+[A-Z\\u4e00-\\u9fff]|${escaped}\\.\\s+(?:[A-Z][A-Za-z-]*\\.?\\s+[A-Z]|[A-Z][a-z]+,\\s+[A-Z]|[\\u4e00-\\u9fff]{2,}))`,
  );
  return inlineBibEntry.test(source);
}

function scoreChunkByExactQuerySignals(chunkText, rawQuery) {
  const text = cleanText(chunkText);
  if (!text) return 0;

  const { question, combined } = stripRagQueryTemplateNoise(rawQuery);
  const formulaNumbers = extractFormulaNumbers(combined);
  const referenceNumbers = extractReferenceNumbers(combined);
  const shortSymbols = extractShortSymbolTokens(question || combined);

  if (formulaNumbers.length === 0 && referenceNumbers.length === 0 && shortSymbols.length === 0) {
    return 0;
  }

  let score = 0;
  const compacted = compactMathSpaces(text);
  const citedFormulaNumbers = formulaNumbers.length > 0
    ? new Set(extractFormulaNumbers(text, { includeStandaloneParens: false }))
    : null;

  for (const num of formulaNumbers) {
    if (chunkMatchesFormulaNumber(text, num)) {
      score += 12;
    } else if (citedFormulaNumbers?.has(num) || new RegExp(`\\bEq(?:s|uation)?\\.?\\s*${escapeRegExp(num)}\\b`, 'i').test(text)) {
      score += 4;
    }
  }

  for (const refNum of referenceNumbers) {
    if (chunkMatchesReferenceEntry(text, refNum)) {
      score += 10;
    } else if (new RegExp(`\\[${escapeRegExp(refNum)}\\]`).test(text)) {
      score += 4;
    }
  }

  for (const symbol of shortSymbols) {
    const underscoreMatch = symbol.match(/^([A-Za-z])_?([A-Za-z0-9]{1,3})$/);
    if (underscoreMatch) {
      const base = escapeRegExp(underscoreMatch[1]);
      const sub = escapeRegExp(underscoreMatch[2]);
      const symbolRegex = new RegExp(`(?:^|[^A-Za-z0-9_])${base}\\s*_?\\s*${sub}(?=$|[^A-Za-z0-9_])`, 'i');
      if (symbolRegex.test(compacted)) {
        score += 5;
        continue;
      }
    }

    const plainRegex = new RegExp(`(?:^|[^A-Za-z0-9_])${escapeRegExp(symbol)}(?=$|[^A-Za-z0-9_])`, 'i');
    if (plainRegex.test(compacted)) {
      score += 3;
    }
  }

  return score;
}

module.exports = {
  buildFtsMatchQuery,
  chunkMatchesFormulaNumber,
  chunkMatchesReferenceEntry,
  compactMathSpaces,
  extractFormulaNumbers,
  extractReferenceNumbers,
  extractShortSymbolTokens,
  hasSourceOriginIntent,
  scoreChunkByExactQuerySignals,
  stripRagQueryTemplateNoise,
};
