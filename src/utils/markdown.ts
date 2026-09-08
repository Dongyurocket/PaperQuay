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

export function sanitizeFakeSuperscripts(text: string): string {
  if (!text || !text.includes('<sup>')) {
    return text;
  }

  return text
    // 1. 还原误打为上标的连字符、破折号、撇号、单双引号
    .replace(/<sup>([–—\-'’"“”])<\/sup>/gi, '$1')
    // 2. 词中伪上标（前后紧邻英文字母或连字符，如 signi<sup>fi</sup>cant, high-<sup>fi</sup>delity, ef-<sup>fi</sup>ciency）
    .replace(/([a-zA-Z\-])<sup>([a-zA-Z]{1,4})<\/sup>([a-zA-Z\-])/gi, '$1$2$3')
    // 3. 词首连字伪上标（fi, fl, ff, ffi, ffl：紧接英文字母，如 <sup>fi</sup>ndings, <sup>fl</sup>ight）
    .replace(/(^|[\s"'(\[])<sup>(fi|fl|ff|ffi|ffl)<\/sup>([a-zA-Z])/gi, '$1$2$3')
    // 4. 词尾连字伪上标（fi, fl, ff, ffi, ffl：前接英文字母且后跟非字母或行尾）
    .replace(/([a-zA-Z])<sup>(fi|fl|ff|ffi|ffl)<\/sup>(?=[^a-zA-Z]|$)/gi, '$1$2')
    // 5. 首字母大写连字（如 Fi, Fl）
    .replace(/(^|[\s"'(\[])<sup>(Fi|Fl|Ff|Ffi|Ffl)<\/sup>([a-zA-Z])/g, '$1$2$3');
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

  const sanitizedMarkdown = separateCollidingDollarMath(sanitizeFakeSuperscripts(markdown));
  const preparedMarkdown = normalizeExplicitMathSyntax(normalizeMineruFragmentedMathText(sanitizedMarkdown));
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
