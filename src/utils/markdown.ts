const MATH_FENCE_START_PATTERN = /^```(?:latex|tex|math|katex)\s*$/i;
const CODE_FENCE_PATTERN = /^```/;
const PROTECTED_MATH_PATTERN =
  /(\$\$[^$]+\$\$|\$[^$\n]+\$|\\\([^)]*\\\)|\\\[[^\]]*\\\]|<[^>]+>)/g;
const INLINE_FORMULA_START_PATTERN =
  /[A-Za-z0-9\\\u0370-\u03FF\u1F00-\u1FFF]/;
const INLINE_FORMULA_CHAR_PATTERN =
  /[A-Za-z0-9\\\u0370-\u03FF\u1F00-\u1FFF{}()[\]^_=+\-*/<>|~,:.;&\u00B7\u00D7\u00F7 ]/;
const INLINE_MATH_COMMAND_PATTERN =
  /\\(?:in|notin|subset|supset|forall|exists|times|cdot|sum|min|max|leq|geq|neq|approx|tag|cup|cap|to|rightarrow|leftarrow)\b/;
const SYMBOLIC_VARIABLE_PATTERN =
  /(?:[A-Za-z\u0370-\u03FF\u1F00-\u1FFF](?:\s*[_^]\s*(?:\{[^{}]+\}|[A-Za-z0-9\u0370-\u03FF\u1F00-\u1FFF]))?)/;
const VARIABLE_RELATION_PATTERN = new RegExp(
  `(?:^|[\\s,(])${SYMBOLIC_VARIABLE_PATTERN.source}` +
    `(?:\\s*,\\s*${SYMBOLIC_VARIABLE_PATTERN.source})*` +
    `\\s*(?:=|<|>|${INLINE_MATH_COMMAND_PATTERN.source})`,
);

const MINERU_IMAGE_PATH_PATTERN = /(?:^|\s)(?:!\[[^\]]*\]\()?images\/[A-Za-z0-9._/-]+\.(?:png|jpe?g|webp)(?:\))?/gi;

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function htmlFormulaToLatex(value: string) {
  return decodeHtmlEntities(value)
    .replace(/<\/?(?:span|div)[^>]*>/gi, '')
    .replace(/<sub>(.*?)<\/sub>/gi, '_{$1}')
    .replace(/<sup>(.*?)<\/sup>/gi, '^{$1}')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\u00D7/g, '\\times')
    .replace(/\u2032/g, "'")
    .replace(/\{\s+/g, '{')
    .replace(/\s+\}/g, '}')
    .trim();
}

function normalizeExplicitMathSyntax(markdown: string) {
  return markdown
    .replace(/\\\[(.*?)\\\]/gs, (_, expression: string) => `\n$$\n${normalizeLatexExpression(expression)}\n$$\n`)
    .replace(/\\\((.*?)\\\)/gs, (_, expression: string) => `$${normalizeLatexExpression(expression)}$`)
    .replace(/<div\s+class=["']formula["'][^>]*>(.*?)<\/div>/gis, (_, expression: string) => {
      const latex = htmlFormulaToLatex(expression);
      return latex ? `\n$$\n${latex}\n$$\n` : '';
    })
    .replace(/<span\s+class=["']math["'][^>]*>(.*?)<\/span>/gis, (_, expression: string) => {
      const latex = htmlFormulaToLatex(expression);
      return latex ? `$${latex}$` : '';
    });
}

function removeMineruFormulaImageNoise(line: string) {
  return line.replace(MINERU_IMAGE_PATH_PATTERN, (match) => {
    const alt = match.match(/!\[([^\]]+)\]/)?.[1]?.trim();
    if (alt && looksLikeInlineFormulaSegment(alt)) {
      return ` $${normalizeLatexExpression(alt)}$`;
    }

    return '';
  });
}



function compactLatexSpaces(value: string) {
  return value
    .replace(/\\\s+\\/g, '\\')
    .replace(/\\\s+(?=[A-Za-z])/g, '\\')
    .replace(/\s*([{},])\s*/g, '$1')
    .replace(/\s*_\s*\{\s*([^{}]+?)\s*\}/g, (_match, subscript: string) => {
      return `_{${subscript.replace(/\s+/g, '')}}`;
    })
    .replace(/\b([A-Z])\s+([A-Z])\b/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}


function transformOutsideProtectedMath(value: string, transform: (segment: string) => string) {
  const protectedSegments: string[] = [];
  const protectedValue = value.replace(PROTECTED_MATH_PATTERN, (segment) => {
    const token = `\uE100${protectedSegments.length}\uE101`;
    protectedSegments.push(segment);
    return token;
  });

  return transform(protectedValue).replace(
    /\uE100(\d+)\uE101/g,
    (_match, rawIndex) => protectedSegments[Number(rawIndex)] ?? '',
  );
}

function normalizeTranslatedInlineLatex(value: string) {
  return value
    .replace(/\\\s+\\(?=[A-Za-z])/g, '\\')
    .replace(/\\\s+(?=[a-z])/g, '\\')
    .replace(/\\\s+(?=[A-Z])/g, '')
    .replace(/\\pmb\s*\{\s*([^{}]+?)\s*\}\s*_\s*\{\s*([^{}]+?)\s*\}/g, (_match, body: string, subscript: string) => {
      return `\\pmb{${body.replace(/\s+/g, '')}}_{${subscript.replace(/\s+/g, '')}}`;
    })
    .replace(/\b[A-Z](?:\s+[A-Z])?\s*=\s*\\\{\s*1\s*,\s*(?:\\ldots|\\dots|\.\s*\.\s*\.)\s*,\s*N\s*_\s*\{\s*[A-Z](?:\s+[A-Z])?\s*\}\s*\\\}/g, (match) => {
      return `$${compactLatexSpaces(match)}$`;
    })
    .replace(/\\pmb\{x\}_\{i\s*j\s*k\s*r\}\s*,\s*i\s*\\in\s*I\s*\\cup\s*C\s*S\s*\\cup\s*C\s*E\s*,\s*j\s*\\in\s*I\s*\\cup\s*C\s*S\s*\\cup\s*C\s*E\s*,\s*k\s*\\in\s*K\s*,\s*r\s*\\in\s*R/g, '$\\pmb{x}_{ijkr},i\\in I\\cup CS\\cup CE,j\\in I\\cup CS\\cup CE,k\\in K,r\\in R$')
    .replace(/\b[xst]\s*_\s*\{\s*[i j k r]+\s*\}(?:\s*,\s*i\s*\\in\s*I\s*\\cup\s*C\s*S\s*\\cup\s*C\s*E\s*,\s*k\s*\\in\s*K\s*,\s*r\s*\\in\s*R)?/g, (match) => {
      return `$${compactLatexSpaces(match)}$`;
    })
    .replace(/\${3,}/g, '$$');
}
function normalizeMineruFragmentedMathText(value: string) {
  let nextValue = value;


  nextValue = transformOutsideProtectedMath(nextValue, normalizeTranslatedInlineLatex);

  // Protect common inline LaTeX temperatures before the auto-inline scanner runs.
  nextValue = nextValue.replace(
    /(-?\d+(?:\.\d+)?)\s*\^\{\\circ\}\s*\\mathrm\{C\}/g,
    (_match, degree: string) => `$${degree}^{\\circ}\\mathrm{C}$`,
  );

  // MinerU/translation can split temperatures into one token per line, e.g.
  // 20 \n \u2218 \n C \n 20 \u2218 C. Collapse the duplicate into one inline formula.
  nextValue = nextValue.replace(
    new RegExp(
      String.raw`(?:^|\s)(-?\d+(?:\.\d+)?)\s*\n\s*\u2218\s*\n\s*C\s*\n\s*\1\s*\u2218\s*C(?=\s|[?,?.?;:]|$)`,
      'g',
    ),
    (_match, degree: string) => ` $${degree}^{\\circ}\\mathrm{C}$`,
  );
  nextValue = nextValue.replace(
    new RegExp(
      String.raw`(?:^|\s)(-?\d+(?:\.\d+)?)\s*\n\s*\u2218\s*\n\s*C(?=\s|[?,?.?;:]|$)`,
      'g',
    ),
    (_match, degree: string) => ` $${degree}^{\\circ}\\mathrm{C}$`,
  );
  nextValue = nextValue.replace(
    new RegExp(String.raw`(-?\d+(?:\.\d+)?)\s*\u2218\s*C`, 'g'),
    (_match, degree: string) => `$${degree}^{\\circ}\\mathrm{C}$`,
  );

  nextValue = nextValue.replace(/(\$-?\d+(?:\.\d+)?\^\{\\circ\}\\mathrm\{C\}\$)(?:\s*\n\s*|\s+)\1/g, '$1');
  nextValue = nextValue.replace(/\b(\d)\s+(\d%)/g, '$1$2');

  return nextValue;
}

function normalizeSeparatedDollarLine(line: string) {
  const trimmed = line.trim();
  const compact = trimmed.replace(/\s+/g, '');

  if (!compact.startsWith('$$') || !compact.endsWith('$$') || compact.length <= 4) {
    return line;
  }

  const expression = compact.slice(2, -2);

  if (!looksLikeInlineFormulaSegment(expression) && !looksLikeStandaloneFormulaLine(expression)) {
    return line;
  }

  return `$$\n${normalizeLatexExpression(expression)}\n$$`;
}

function stripTrailingLatexLabel(value: string) {
  return value.replace(/\s+latex\s*$/i, '').trim();
}

function looksLikeStandaloneFormulaLine(value: string) {
  const trimmed = stripTrailingLatexLabel(value.trim());

  if (!trimmed) {
    return false;
  }

  if (
    /^#{1,6}\s/.test(trimmed) ||
    /^[-*+]\s/.test(trimmed) ||
    /^\d+\.\s/.test(trimmed) ||
    /^>/.test(trimmed) ||
    trimmed.includes('|') ||
    /^<[^>]+>/.test(trimmed)
  ) {
    return false;
  }

  if (
    (trimmed.startsWith('$$') && trimmed.endsWith('$$')) ||
    (trimmed.startsWith('$') && trimmed.endsWith('$')) ||
    (trimmed.startsWith('\\[') && trimmed.endsWith('\\]')) ||
    (trimmed.startsWith('\\(') && trimmed.endsWith('\\)'))
  ) {
    return false;
  }

  if (/[\u4e00-\u9fff]/.test(trimmed)) {
    return false;
  }

  // 排除 LaTeX 命令后再统计普通英文单词，避免把 `\boldsymbol`、`\quad`
  // 这类命令误判成自然语言，从而错过对整行公式的自动包裹。
  const plainWordMatches =
    trimmed
      .replace(/\\[A-Za-z]+/g, ' ')
      .match(
        /\b(?!latex\b)(?!tag\b)(?!min\b)(?!max\b)(?!sum\b)(?!forall\b)(?!exists\b)(?!argmin\b)(?!argmax\b)[A-Za-z]{3,}\b/g,
      ) ?? [];

  if (plainWordMatches.length >= 3) {
    return false;
  }

  const hasLatexCommand = /\\[A-Za-z]+/.test(trimmed);
  const hasMathStructure =
    /[_^=]/.test(trimmed) ||
    /\\(?:tag|frac|sum|min|max|forall|exists|boldsymbol|mathrm|left|right|cdot|times|cup|cap|in)\b/.test(
      trimmed,
    );
  const mathSymbolCount = (trimmed.match(/[\\_^=+\-*/()[\]{}<>|~]/g) ?? []).length;
  const symbolDensity = mathSymbolCount / Math.max(trimmed.length, 1);

  return hasLatexCommand && hasMathStructure && symbolDensity >= 0.08;
}

export function normalizeRawLatexExpression(value: string) {
  return stripTrailingLatexLabel(value)
    .replace(/\\r(?=\s*(?:\\leq|\\geq|\\in|[<>=+\-*/),;]|$))/g, 'r')
    .replace(/\r\n?/g, '\n')
    .replace(/\\([A-Za-z]+)\s+\{/g, '\\$1{')
    .replace(/([_^])\s+\{/g, '$1{')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\{\s+/g, '{')
    .replace(/\s+\}/g, '}')
    .replace(/\\\s*end\{array\}/g, '\\end{array}')
    .replace(/\\\\end\{array\}/g, '\\end{array}')
    .replace(/\\\s+(?=\\(?:sum|boldsymbol|forall))/g, ' \\\ ')
    .replace(/\\\s+(?=\\tag)/g, ' ')
    .replace(/\\\s+(?=[A-Za-z])/g, ' \\\\ ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
export function normalizeLatexExpression(value: string) {
  return normalizeTranslatedInlineLatex(normalizeRawLatexExpression(value));
}
function isInlineFormulaBoundary(value: string | undefined) {
  return (
    value == null ||
    value === '' ||
    /[\s\u4e00-\u9fff`"'.,;:!?()[\]{}<>]/.test(value)
  );
}

function canStartInlineFormulaCandidate(value: string, index: number) {
  const tail = value.slice(index);

  if (tail.startsWith('\\')) {
    return true;
  }

  if (/^[\u0370-\u03FF\u1F00-\u1FFF]/.test(tail)) {
    return true;
  }

  if (!/^[A-Za-z0-9]/.test(tail)) {
    return false;
  }

  return /[_^]/.test(tail) || /[=<>]/.test(tail) || INLINE_MATH_COMMAND_PATTERN.test(tail);
}

function looksLikeInlineFormulaSegment(value: string) {
  const trimmed = stripTrailingLatexLabel(value.trim());

  if (!trimmed || trimmed.length < 2) {
    return false;
  }

  if (/<[^>]+>/.test(trimmed)) {
    return false;
  }

  if (/[\u4e00-\u9fff]/.test(trimmed) || /^https?:\/\//i.test(trimmed)) {
    return false;
  }

  if (/[?&][A-Za-z0-9_]+=/.test(trimmed)) {
    return false;
  }

  if (
    (trimmed.startsWith('$$') && trimmed.endsWith('$$')) ||
    (trimmed.startsWith('$') && trimmed.endsWith('$')) ||
    (trimmed.startsWith('\\[') && trimmed.endsWith('\\]')) ||
    (trimmed.startsWith('\\(') && trimmed.endsWith('\\)'))
  ) {
    return false;
  }

  const hasLatexCommand = /\\[A-Za-z]+/.test(trimmed);
  const hasSubOrSup =
    /(?:^|[A-Za-z0-9)}\]])\s*[_^]\s*(?:\{[^{}]+\}|[A-Za-z0-9\\])/.test(trimmed);
  const hasMathOperator =
    /[=<>]/.test(trimmed) || INLINE_MATH_COMMAND_PATTERN.test(trimmed);
  const hasMathSpacing = /~/.test(trimmed);
  const hasSymbolicVariable = new RegExp(
    `(?:^|[\\s,(])${SYMBOLIC_VARIABLE_PATTERN.source}(?:[\\s,),]|$)`,
  ).test(trimmed);
  const hasVariableRelation = VARIABLE_RELATION_PATTERN.test(trimmed);

  return (
    hasLatexCommand ||
    hasSubOrSup ||
    hasVariableRelation ||
    ((hasMathOperator || hasMathSpacing) && hasSymbolicVariable)
  );
}

function wrapInlineLatexSegments(line: string) {
  if (!line.trim() || !/[\\_^=<>~]/.test(line)) {
    return line;
  }

  const protectedSegments: string[] = [];
  const protectedLine = line.replace(PROTECTED_MATH_PATTERN, (segment) => {
    const token = `\uE000${protectedSegments.length}\uE001`;
    protectedSegments.push(segment);
    return token;
  });

  let output = '';
  let index = 0;

  while (index < protectedLine.length) {
    const currentChar = protectedLine[index];

    if (index > 0 && protectedLine[index - 1] === '\\') {
      output += currentChar;
      index += 1;
      continue;
    }

    if (
      !INLINE_FORMULA_START_PATTERN.test(currentChar) ||
      !canStartInlineFormulaCandidate(protectedLine, index)
    ) {
      output += currentChar;
      index += 1;
      continue;
    }

    let end = index;

    while (end < protectedLine.length && INLINE_FORMULA_CHAR_PATTERN.test(protectedLine[end])) {
      if (end > index && /^\s+[A-Za-z]{2,}\b/.test(protectedLine.slice(end))) {
        break;
      }

      end += 1;
    }

    const candidate = protectedLine.slice(index, end);

    if (
      candidate &&
      looksLikeInlineFormulaSegment(candidate) &&
      isInlineFormulaBoundary(protectedLine[index - 1]) &&
      isInlineFormulaBoundary(protectedLine[end])
    ) {
      const leadingWhitespace = candidate.match(/^\s*/)?.[0] ?? '';
      const trailingWhitespace = candidate.match(/\s*$/)?.[0] ?? '';
      const normalized = normalizeLatexExpression(candidate.trim());

      output += `${leadingWhitespace}$${normalized}$${trailingWhitespace}`;
      index = end;
      continue;
    }

    output += currentChar;
    index += 1;
  }

  return output.replace(
    /\uE000(\d+)\uE001/g,
    (_, rawIndex) => protectedSegments[Number(rawIndex)] ?? '',
  );
}

const UNICODE_SUPERSCRIPT_MAP: Record<string, string> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
};

const CROSS_REF_SUPERSCRIPT_PATTERN =
  /\b(Table|Tables|Tab\.|Tabs\.|Figure|Figures|Fig\.|Figs\.|Equation|Equations|Eq\.|Eqs\.|Section|Sections|Sec\.|Secs\.|Algorithm|Algorithms|Algo\.|Algos\.|Ref\.|Refs\.|Reference|References|Theorem|Lemma|Proposition|Corollary|Definition|Def\.|Scheme|Schemes|Box|Boxes|Appendix|Appendices|App\.)\s*<sup>([0-9IVXLCDMivxlcdm]+[a-zA-Z]?|\d+[-.]\d+|[A-Z]\.?\d+)<\/sup>/gi;

const CONSECUTIVE_CROSS_REF_SUPERSCRIPT_PATTERN =
  /(\b(?:Table|Tables|Tab\.|Tabs\.|Figure|Figures|Fig\.|Figs\.|Equation|Equations|Eq\.|Eqs\.|Section|Sections|Sec\.|Secs\.|Algorithm|Algorithms|Algo\.|Algos\.|Ref\.|Refs\.|Reference|References|Theorem|Lemma|Proposition|Corollary|Definition|Def\.|Scheme|Schemes|Box|Boxes|Appendix|Appendices|App\.)\s+(?:(?:[0-9IVXLCDMivxlcdm]+[a-zA-Z]?|\d+[-.]\d+|[A-Z]\.?\d+)\s*(?:,\s*(?:and|or)?\s*|(?:and|or)\s*))+)<sup>([0-9IVXLCDMivxlcdm]+[a-zA-Z]?|\d+[-.]\d+|[A-Z]\.?\d+)<\/sup>/i;

const CROSS_REF_UNICODE_SUPERSCRIPT_PATTERN =
  /\b(Table|Tables|Tab\.|Tabs\.|Figure|Figures|Fig\.|Figs\.|Equation|Equations|Eq\.|Eqs\.|Section|Sections|Sec\.|Secs\.|Algorithm|Algorithms|Algo\.|Algos\.|Ref\.|Refs\.|Reference|References|Theorem|Lemma|Proposition|Corollary|Definition|Def\.|Scheme|Schemes|Box|Boxes|Appendix|Appendices|App\.)\s*([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/gi;

const CROSS_REF_COMMA_SPACING_PATTERN =
  /(\b(?:Table|Tables|Tab\.|Tabs\.|Figure|Figures|Fig\.|Figs\.|Equation|Equations|Eq\.|Eqs\.|Section|Sections|Sec\.|Secs\.|Algorithm|Algorithms|Algo\.|Algos\.|Ref\.|Refs\.|Reference|References|Theorem|Lemma|Proposition|Corollary|Definition|Def\.|Scheme|Schemes|Box|Boxes|Appendix|Appendices|App\.)\s+(?:(?:[0-9IVXLCDMivxlcdm]+[a-zA-Z]?|\d+[-.]\d+|[A-Z]\.?\d+)\s*(?:,|and|or)\s*)*(?:[0-9IVXLCDMivxlcdm]+[a-zA-Z]?|\d+[-.]\d+|[A-Z]\.?\d+)),([a-zA-Z])/i;

export function sanitizeFakeSuperscripts(text: string): string {
  if (!text || (!text.includes('<sup>') && !/[⁰¹²³⁴⁵⁶⁷⁸⁹]/.test(text))) {
    return text;
  }

  let result = text
    // 1. 还原 Table / Figure / Equation 等学术交叉引用后被误判的上标编号（HTML 形式，如 Table <sup>8</sup> -> Table 8）
    .replace(CROSS_REF_SUPERSCRIPT_PATTERN, '$1 $2')
    // 2. 还原学术交叉引用后被误判的 Unicode 上标数字（如 Table ⁸ -> Table 8）
    .replace(CROSS_REF_UNICODE_SUPERSCRIPT_PATTERN, (_, prefix: string, digits: string) => {
      const normalizedDigits = digits
        .split('')
        .map((d) => UNICODE_SUPERSCRIPT_MAP[d] ?? d)
        .join('');
      return `${prefix} ${normalizedDigits}`;
    });

  // 3. 循环还原可能连续出现的交叉引用后续上标（如 Figure 2, <sup>3</sup>, and <sup>4</sup> -> Figure 2, 3, and 4）
  let prev = '';
  while (result !== prev && CONSECUTIVE_CROSS_REF_SUPERSCRIPT_PATTERN.test(result)) {
    prev = result;
    result = result.replace(CONSECUTIVE_CROSS_REF_SUPERSCRIPT_PATTERN, '$1$2');
  }

  // 4. 循环修复交叉引用编号紧接标点逗号且缺失空格的粘连缺陷（如 Table 8,while -> Table 8, while）
  prev = '';
  while (result !== prev && CROSS_REF_COMMA_SPACING_PATTERN.test(result)) {
    prev = result;
    result = result.replace(CROSS_REF_COMMA_SPACING_PATTERN, '$1, $2');
  }

  return result
    // 5. 还原误打为上标的连字符、破折号、撇号、单双引号
    .replace(/<sup>([–—\-'’"“”])<\/sup>/gi, '$1')
    // 6. 词中伪上标（前后紧邻英文字母或连字符，如 signi<sup>fi</sup>cant, high-<sup>fi</sup>delity, ef-<sup>fi</sup>ciency）
    .replace(/([a-zA-Z\-])<sup>([a-zA-Z]{1,4})<\/sup>([a-zA-Z\-])/gi, '$1$2$3')
    // 7. 词首连字伪上标（fi, fl, ff, ffi, ffl：紧接英文字母，如 <sup>fi</sup>ndings, <sup>fl</sup>ight）
    .replace(/(^|[\s"'(\[])<sup>(fi|fl|ff|ffi|ffl)<\/sup>([a-zA-Z])/gi, '$1$2$3')
    // 8. 词尾连字伪上标（fi, fl, ff, ffi, ffl：前接英文字母且后跟非字母或行尾）
    .replace(/([a-zA-Z])<sup>(fi|fl|ff|ffi|ffl)<\/sup>(?=[^a-zA-Z]|$)/gi, '$1$2')
    // 9. 首字母大写连字（如 Fi, Fl）
    .replace(/(^|[\s"'(\[])<sup>(Fi|Fl|Ff|Ffi|Ffl)<\/sup>([a-zA-Z])/g, '$1$2$3');

  // 10. 修复学术论文首字下沉（Drop Cap）在 OCR 中被误识别为 <sup> 上标的缺陷
  // 案例：U<sup>RBAN air mobility (UAM)...</sup> -> Urban air mobility (UAM)...
  result = sanitizeDropCapArtifacts(result);

  return result;
}

/**
 * 清洗并修复学术论文首字下沉（Drop Cap / Initial Cap）在 OCR/MinerU 中被误判为上标或分离的缺陷
 * 典型模式：
 * 1. HTML 伪上标：U<sup>RBAN air mobility (UAM) is an emerging industry...</sup>
 * 2. Markdown/LaTeX 伪上标：U^{RBAN air mobility ...} 或 $U^{RBAN ...}$ 或 U^{RBAN}
 * 3. 词干分离：U RBAN air mobility -> Urban air mobility
 */
export function sanitizeDropCapArtifacts(text: string): string {
  if (!text) {
    return text;
  }

  let result = text;

  // 1. 修复 HTML <sup> 形式包裹的长短文本（如 U<sup>RBAN air mobility...</sup>）
  result = result.replace(
    /(^|[\n\r]|#{1,6}\s+)\b([A-Z])\s*<sup>([A-Z]{1,12}|[a-z]{1,12})\b([\s\S]*?)<\/sup>/g,
    (_, prefix: string, firstChar: string, restWord: string, tail: string) => {
      const normalizedWord = firstChar + restWord.toLowerCase();
      return `${prefix}${normalizedWord}${tail}`;
    },
  );

  // 2. 修复 Markdown/LaTeX 形式的伪上标（如 U^{RBAN air mobility...} 或 $U^{RBAN...}$）
  result = result.replace(
    /(^|[\n\r]|#{1,6}\s+|\$)\b([A-Z])\s*\^\{([A-Za-z]{1,12})\b([\s\S]*?)\}/g,
    (_, prefix: string, firstChar: string, restWord: string, tail: string) => {
      const normalizedWord = firstChar + restWord.toLowerCase();
      return `${prefix}${normalizedWord}${tail}`;
    },
  );

  // 3. 修复单字符与大写词干之间因排版分块产生的断裂空格（例如 "U RBAN air mobility" -> "Urban air mobility"）
  // 排除单独成词的冠词与人称代词（如 "A " 或 "I "，除非后跟 3 个以上大写字母且非缩写词）
  result = result.replace(
    /(^|[\n\r]|#{1,6}\s+)\b([B-HJ-Z])\s+([A-Z]{2,12})\b/g,
    (_, prefix: string, firstChar: string, restWord: string) => {
      return `${prefix}${firstChar}${restWord.toLowerCase()}`;
    },
  );

  result = result.replace(
    /(^|[\n\r]|#{1,6}\s+)\b([AI])\s+([A-Z]{3,12})\b/g,
    (_, prefix: string, firstChar: string, restWord: string) => {
      return `${prefix}${firstChar}${restWord.toLowerCase()}`;
    },
  );

  return result;
}

/**
 * 识别并重构排版崩溃的术语表（Nomenclature / Notation / 变量定义表）
 * 将单段被压平、粘连、丢失等号与换行的文本还原为排版规范的 Markdown 表格
 */
export function reconstructNomenclature(text: string): string {
  if (!text || text.length < 30) {
    return text;
  }

  // 判定是否处于 Nomenclature 上下文或包含典型的符号定义密集模式
  const hasNomenclatureHeader = /^(?:#{1,6}\s+)?(?:Nomenclature|Notation|List of Symbols|Variables)\b/i.test(
    text.trim(),
  );

  // 典型学术符号与单位粘连特征检测（例如 Bnumber, cchord, Tthrust, C_Bbattery, \rho density, wing span, m 等）
  const knownSymbolStickyPatterns = [
    /\b[BDEGLQT][a-z]{3,}\b/, // Bnumber, Dtotal, EYoung, Gshear, Llift, Qtorque, Tthrust
    /\b(?:cchord|mmass|qdynamic|rradial|sshear)\b/, // cchord, mmass, qdynamic, rradial, sshear
    /\b[A-Za-z](?:_[A-Za-z0-9,{}\\]+|\^[0-9]+)[a-z]{3,}\b/, // C_Bbattery, C_{D_p}parasitic, t_{\text{ply}}ply
    /\b(?:SOC|OCV|np|ns)[a-z]{3,}\b/, // npbattery, OCVbattery
    /\\(?:Omega|rho|sigma|eta|nu|theta|mu|lambda|infty)\b\s*[a-z]{3,}/, // \eta efficiency, \rho density
  ];

  const stickyMatchCount = knownSymbolStickyPatterns.filter((p) => p.test(text)).length;

  if (!hasNomenclatureHeader && stickyMatchCount < 2) {
    return text;
  }

  // 提取可能的标题
  let headerPrefix = '';
  let bodyText = text;
  const headerMatch = text.match(/^((?:#{1,6}\s+)?(?:Nomenclature|Notation|List of Symbols|Variables)\b[^\n]*\n*)/i);
  if (headerMatch) {
    headerPrefix = headerMatch[1].trim() + '\n\n';
    bodyText = text.slice(headerMatch[0].length);
  }

  // 1. 去除误识别的前导上标符号并解耦粘连：如 ^bwing span -> \uE002b\uE003wing span
  let cleaned = bodyText.replace(/\^([a-zA-Z])([a-z]{3,})/g, '\uE002$1\uE003$2');

  // 2. 将所有粘连或独立的符号用定界符 \uE002[符号]\uE003 标记出来
  // 大写单字母粘连：Bnumber -> \uE002B\uE003number, Dtotal -> \uE002D\uE003total, EYoung -> \uE002E\uE003Young
  cleaned = cleaned.replace(/\b([BDEGLQT])([A-Z][a-z]{2,}|[a-z]{3,})\b/g, '\uE002$1\uE003$2');

  // 典型学术双写/特异小写粘连：
  cleaned = cleaned.replace(/\b(c)(chord)\b/g, '\uE002$1\uE003$2');
  cleaned = cleaned.replace(/\b(m)(mass)\b/g, '\uE002$1\uE003$2');
  cleaned = cleaned.replace(/\b(q)(dynamic)\b/g, '\uE002$1\uE003$2');
  cleaned = cleaned.replace(/\b(r)(radial)\b/g, '\uE002$1\uE003$2');
  cleaned = cleaned.replace(/\b(s)(shear)\b/g, '\uE002$1\uE003$2');
  cleaned = cleaned.replace(/(?:^|[\s,])(t\/c)(thickness)\b/g, '\uE002$1\uE003$2');

  // 缩写符号粘连或带空格：npbattery -> \uE002np\uE003battery, SOC battery -> \uE002SOC\uE003battery
  cleaned = cleaned.replace(/\b(np|ns|OCV|SOC)\s*([a-z]{3,})\b/g, '\uE002$1\uE003$2');

  // 带下标的变量粘连：严格区分带花括号和单字符无花括号下标，避免贪婪吞噬
  // 如 C_Bbattery -> \uE002C_B\uE003battery, C_{D_p}parasitic -> \uE002C_{D_p}\uE003parasitic
  cleaned = cleaned.replace(/([A-Za-z](?:_\{[^{}]+\}|_[A-Za-z0-9]|\^[0-9]+))\s*([a-z]{3,})/g, '\uE002$1\uE003$2');

  // LaTeX 符号粘连：\eta efficiency -> \uE002\eta\uE003efficiency
  cleaned = cleaned.replace(/(\\[A-Za-z]+(?:_[A-Za-z0-9{}]+)?)\s*([a-z]{3,})/g, '\uE002$1\uE003$2');

  // 带等号的条目：SOC = battery state of charge
  cleaned = cleaned.replace(/(?:^|[\s,;])([A-Za-z\u0370-\u03FF\\](?:_[A-Za-z0-9,{}\\]+|\^[0-9]+)?|[A-Z]{2,4})\s*=\s*/g, '\uE002$1\uE003');

  // 3. 按 \uE002 切分出所有条目
  const segments = cleaned.split('\uE002');
  const extractedRows: Array<{ symbol: string; desc: string }> = [];

  for (const segment of segments) {
    const delimIndex = segment.indexOf('\uE003');
    if (delimIndex === -1) {
      continue;
    }

    const sym = segment.slice(0, delimIndex).trim();
    let desc = segment.slice(delimIndex + 1).trim();

    // 去除描述开头的等号、制表符或冒号
    desc = desc.replace(/^[=\t:\s-]+/, '').trim();

    if (sym && desc) {
      extractedRows.push({ symbol: sym, desc });
    }
  }

  // 若通过切分获得了 3 个以上的有效条目，则重构成标准 Markdown 表格
  if (extractedRows.length >= 3) {
    const tableHeader = '| 符号 (Symbol) | 说明与单位 (Description) |\n| :--- | :--- |';
    const tableBody = extractedRows
      .map((row) => {
        // 给纯数学符号自动添加 $ 包裹（如果尚未包裹）
        const formattedSymbol =
          row.symbol.startsWith('$') && row.symbol.endsWith('$')
            ? row.symbol
            : /[\\_^{}]|[A-Za-z]/.test(row.symbol)
              ? `$${row.symbol}$`
              : row.symbol;
        return `| ${formattedSymbol} | ${row.desc.replace(/\|/g, '\\|')} |`;
      })
      .join('\n');

    return `${headerPrefix}${tableHeader}\n${tableBody}`;
  }

  // 备用兜底：如果不满足成表条件但检测到了粘连，返回解耦粘连后的清晰文本
  return `${headerPrefix}${cleaned.replace(/\uE002|\uE003/g, ' ')}`;
}

/**
 * 防御性清洗大模型返回的重析文本
 * 严格剥离思考内容、外部代码块包裹与可能逃逸的废话前缀，确保输出纯净无瑕
 */
export function sanitizeClientReparsedText(text: string): string {
  if (!text) return '';
  let result = text.trim();

  // 1. 过滤思考标签
  result = result.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // 2. 剥离外层代码块包裹
  const codeBlockMatch = result.match(/^```(?:markdown|md|latex|text)?\s*\n([\s\S]*?)\n```$/i);
  if (codeBlockMatch) {
    result = codeBlockMatch[1].trim();
  }

  // 3. 剥离可能逃逸的多余开头话术
  result = result.replace(
    /^(?:(?:Here is|Below is|This is)(?: the)? (?:corrected|re-parsed|reconstructed|formatted) (?:text|content|markdown|table)?:?\s*)+/i,
    '',
  );
  result = result.replace(
    /^(?:(?:这是|以下|为您|如下|重新识别结果)[^\n\r：:]*?[：:]\s*)+/i,
    '',
  );

  return result.trim();
}

export function separateCollidingDollarMath(text: string): string {
  if (!text || !text.includes('$$')) {
    return text;
  }

  // 解耦行内公式粘连：例如 $A$$B$ 或 $formula1$$formula2$，避免 remark-math 误当成块公式
  return text.replace(/([^$\s\n])\$\$(?=[^$\s\n])/g, '$1$ $');
}

export function remarkSuperscriptPlugin() {
  return (tree: any) => {
    function processChildren(children: any[]): any[] {
      if (!Array.isArray(children)) return children;
      const newChildren: any[] = [];
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child.type === 'html' && /^<sup\b[^>]*>/i.test(child.value)) {
          let closeIndex = -1;
          for (let j = i + 1; j < children.length; j++) {
            if (children[j].type === 'html' && /<\/sup>/i.test(children[j].value)) {
              closeIndex = j;
              break;
            }
          }
          if (closeIndex !== -1) {
            const innerChildren = children.slice(i + 1, closeIndex);
            newChildren.push({
              type: 'sup',
              data: {
                hName: 'sup',
                hProperties: {
                  className: 'pq-superscript align-super text-[0.72em] font-medium leading-none',
                },
              },
              children: processChildren(innerChildren),
            });
            i = closeIndex;
            continue;
          }
        }
        if (child.type === 'html' && /^<sub\b[^>]*>/i.test(child.value)) {
          let closeIndex = -1;
          for (let j = i + 1; j < children.length; j++) {
            if (children[j].type === 'html' && /<\/sub>/i.test(children[j].value)) {
              closeIndex = j;
              break;
            }
          }
          if (closeIndex !== -1) {
            const innerChildren = children.slice(i + 1, closeIndex);
            newChildren.push({
              type: 'sub',
              data: {
                hName: 'sub',
                hProperties: {
                  className: 'pq-subscript align-sub text-[0.72em] font-medium leading-none',
                },
              },
              children: processChildren(innerChildren),
            });
            i = closeIndex;
            continue;
          }
        }
        if (child.type === 'text' && child.value && (child.value.includes('<sup>') || child.value.includes('<sub>'))) {
          const tagRegex = /<(sup|sub)\b[^>]*>([\s\S]*?)<\/\1>/gi;
          const textChildren: any[] = [];
          let lastIdx = 0;
          let m: RegExpExecArray | null;
          while ((m = tagRegex.exec(child.value)) !== null) {
            if (m.index > lastIdx) {
              textChildren.push({ type: 'text', value: child.value.slice(lastIdx, m.index) });
            }
            const tagName = m[1].toLowerCase();
            textChildren.push({
              type: tagName,
              data: {
                hName: tagName,
                hProperties: {
                  className: tagName === 'sup'
                    ? 'pq-superscript align-super text-[0.72em] font-medium leading-none'
                    : 'pq-subscript align-sub text-[0.72em] font-medium leading-none',
                },
              },
              children: [{ type: 'text', value: m[2] }],
            });
            lastIdx = tagRegex.lastIndex;
          }
          if (lastIdx < child.value.length) {
            textChildren.push({ type: 'text', value: child.value.slice(lastIdx) });
          }
          if (textChildren.length > 0) {
            newChildren.push(...textChildren);
            continue;
          }
        }
        if (child.children) {
          child.children = processChildren(child.children);
        }
        newChildren.push(child);
      }
      return newChildren;
    }

    tree.children = processChildren(tree.children);
  };
}

export function normalizeMarkdownMath(markdown: string) {
  if (!markdown.trim()) {
    return markdown;
  }

  const sanitizedMarkdown = separateCollidingDollarMath(
    sanitizeDropCapArtifacts(sanitizeFakeSuperscripts(markdown)),
  );
  const nomenclatureMarkdown = reconstructNomenclature(sanitizedMarkdown);
  const preparedMarkdown = normalizeExplicitMathSyntax(
    normalizeMineruFragmentedMathText(nomenclatureMarkdown),
  );
  const lines = preparedMarkdown.replace(/\r\n?/g, '\n').split('\n');
  const output: string[] = [];
  let mathFenceBuffer: string[] | null = null;
  let insideOtherFence = false;

  const flushMathFence = () => {
    if (mathFenceBuffer === null) {
      return;
    }

    const expression = normalizeRawLatexExpression(mathFenceBuffer.join('\n'));

    if (expression) {
      output.push('$$');
      output.push(expression);
      output.push('$$');
    }

    mathFenceBuffer = null;
  };

  for (const line of lines) {
    const cleanedLine = removeMineruFormulaImageNoise(normalizeSeparatedDollarLine(line));
    const trimmed = cleanedLine.trim();

    if (mathFenceBuffer !== null) {
      if (trimmed === '$$' || CODE_FENCE_PATTERN.test(trimmed)) {
        flushMathFence();
      } else {
        mathFenceBuffer.push(cleanedLine);
      }

      continue;
    }

    if (insideOtherFence) {
      output.push(cleanedLine);

      if (CODE_FENCE_PATTERN.test(trimmed)) {
        insideOtherFence = false;
      }

      continue;
    }

    if (trimmed.startsWith('$$')) {
      const restOfLine = cleanedLine.slice(cleanedLine.indexOf('$$') + 2);
      const endIndex = restOfLine.lastIndexOf('$$');

      if (endIndex >= 0) {
        const expression = normalizeRawLatexExpression(restOfLine.slice(0, endIndex));
        if (expression) {
          output.push('$$');
          output.push(expression);
          output.push('$$');
        }
        continue;
      }

      mathFenceBuffer = restOfLine.trim() ? [restOfLine] : [];
      continue;
    }

    if (MATH_FENCE_START_PATTERN.test(trimmed)) {
      mathFenceBuffer = [];
      continue;
    }

    if (CODE_FENCE_PATTERN.test(trimmed)) {
      insideOtherFence = true;
      output.push(cleanedLine);
      continue;
    }

    if (looksLikeStandaloneFormulaLine(trimmed)) {
      output.push('$$');
      output.push(normalizeLatexExpression(trimmed));
      output.push('$$');
      continue;
    }

    output.push(wrapInlineLatexSegments(cleanedLine));
  }

  flushMathFence();

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
