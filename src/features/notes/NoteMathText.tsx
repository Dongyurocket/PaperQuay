import type { ReactNode } from 'react';
import katex from 'katex';

type MathTextProps = { value: string };

function renderMath(latex: string, displayMode: boolean, key: string): ReactNode {
  try {
    return (
      <span
        key={key}
        className={displayMode ? 'pq-note-excerpt-math pq-note-excerpt-math-display' : 'pq-note-excerpt-math'}
        dangerouslySetInnerHTML={{
          __html: katex.renderToString(latex.trim(), { displayMode, throwOnError: false }),
        }}
      />
    );
  } catch {
    return <span key={key}>{latex}</span>;
  }
}

export function NoteMathText({ value }: MathTextProps) {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let index = 0;
  const pattern = /(\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|(\$([^$\n]+)\$))/g;

  for (const match of value.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) nodes.push(<span key={`text-${index++}`}>{value.slice(cursor, start)}</span>);
    const display = match[1].startsWith('$$') || match[1].startsWith('\\[');
    const latex = match[2] ?? match[3] ?? match[4] ?? match[6] ?? '';
    nodes.push(renderMath(latex, display, `math-${index++}`));
    cursor = start + match[0].length;
  }

  if (cursor < value.length) {
    const tail = value.slice(cursor);
    // Some imported OCR excerpts contain only the opening `$`. Render the LaTeX run
    // up to the first Chinese punctuation mark instead of exposing raw commands.
    const dollarIndex = tail.indexOf('$');
    const malformed = dollarIndex >= 0
      ? tail.slice(dollarIndex).match(/^\$([^\n，。；：！？、]+)(?=[，。；：！？、]|$)/)
      : null;
    if (malformed && /\\(?:times|mathrm|frac|sum|sqrt|[a-zA-Z])/.test(malformed[1])) {
      if (dollarIndex > 0) nodes.push(<span key={`text-${index++}`}>{tail.slice(0, dollarIndex)}</span>);
      nodes.push(renderMath(malformed[1], false, `math-${index++}`));
      cursor = value.length;
    } else {
      nodes.push(<span key={`text-${index++}`}>{tail}</span>);
    }
  }

  return <>{nodes}</>;
}
