import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { AgentAnswerReference, AgentAnswerReferenceModel, AgentCitationClick } from './agentCitationRendering';
import type { LiteraturePaper } from '../../types/library';

export function referenceIdentityHint(reference: AgentAnswerReference, references: AgentAnswerReference[]): string {
  const samePreview = references.filter((other) => other !== reference &&
    other.citation.paperId === reference.citation.paperId && other.citation.pageIndex === reference.citation.pageIndex &&
    (other.citation.previewText?.trim() ?? '') === (reference.citation.previewText?.trim() ?? ''));
  if (!samePreview.length) return '';
  const blockId = reference.citation.blockId;
  return blockId && samePreview.every((other) => other.citation.blockId !== blockId) ? blockId : reference.citationId;
}

// Move a colliding preview to the first differing character, keeping same-page chunks distinguishable.
export function referencePreview(reference: AgentAnswerReference, references: AgentAnswerReference[]): string {
  const text = reference.citation.previewText?.trim() ?? '';
  let offset = 0;
  for (const other of references) {
    if (other === reference || other.citation.paperId !== reference.citation.paperId || other.citation.pageIndex !== reference.citation.pageIndex) continue;
    const otherText = other.citation.previewText?.trim() ?? '';
    if (text === otherText || text.slice(0, 280) !== otherText.slice(0, 280)) continue;
    let difference = 0;
    while (difference < Math.min(text.length, otherText.length) && text[difference] === otherText[difference]) difference++;
    offset = Math.max(offset, difference - 80);
  }
  return `${offset > 0 ? '…' : ''}${text.slice(offset, offset + 280)}${text.length > offset + 280 ? '…' : ''}`;
}

export function AgentAnswerReferenceEntry({ reference, preview, identityHint, paper, onOpenCitation, l }: {
  reference: AgentAnswerReference;
  preview: string;
  identityHint?: string;
  paper?: LiteraturePaper;
  onOpenCitation?: AgentCitationClick;
  l: (zh: string, en: string) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const { citation, number } = reference;
  const title = paper?.title.trim() || citation.paperTitle;
  const metadata = [paper?.authors.map((author) => author.name).filter(Boolean).join(', '), paper?.year, paper?.publication].filter(Boolean).join(' · ');
  const text = citation.previewText?.trim() ?? '';
  const long = text.length > 280;
  const page = citation.pageIndex == null ? '' : l(` · PDF 第 ${citation.pageIndex + 1} 页`, ` · PDF page ${citation.pageIndex + 1}`);
  return <li className="min-w-0 text-sm leading-6 [overflow-wrap:anywhere]">
    <button type="button" disabled={!onOpenCitation} onClick={() => onOpenCitation?.(citation, number)}
      aria-label={l(`引用 ${number}：${title}${page}`, `Reference ${number}: ${title}${page}`)}
      className="max-w-full text-left align-baseline font-medium text-[var(--pq-accent)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--pq-accent)] disabled:cursor-default">
      [{number}] {title}
    </button>
    <span className="text-xs text-[var(--pq-text-muted)]">{page}</span>
    {metadata ? <div className="text-xs text-[var(--pq-text-muted)]">{metadata}</div> : null}
    {preview ? <div className="mt-0.5 whitespace-pre-wrap text-xs leading-5 text-[var(--pq-text-muted)]">{expanded ? text : preview}</div> : null}
    {identityHint ? <div className="text-xs text-[var(--pq-text-faint)]">{l('片段标识：', 'Fragment ID: ')}{identityHint}</div> : null}
    {long ? <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}
      className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--pq-text-muted)] hover:text-[var(--pq-accent)]">
      {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      {expanded ? l('收起片段', 'Collapse excerpt') : l('展开片段', 'Expand excerpt')}
    </button> : null}
  </li>;
}

export default function AgentAnswerReferences({ model, papers, onOpenCitation, l }: {
  model: AgentAnswerReferenceModel;
  papers?: LiteraturePaper[];
  onOpenCitation?: AgentCitationClick;
  l: (zh: string, en: string) => string;
}) {
  if (!model.references.length) return null;
  const papersById = new Map(papers?.map((paper) => [paper.id, paper]));
  return <section className="mt-4 min-w-0" aria-label={l('参考文献', 'References')}>
    <h3 className="text-sm font-semibold text-[var(--pq-text)]">{l('参考文献', 'References')}</h3>
    <ol className="mt-2 list-none space-y-3">
      {model.references.map((reference) => <AgentAnswerReferenceEntry key={reference.citationId} reference={reference}
        paper={papersById.get(reference.citation.paperId)}
        preview={referencePreview(reference, model.references)} identityHint={referenceIdentityHint(reference, model.references)} onOpenCitation={onOpenCitation} l={l} />)}
    </ol>
  </section>;
}
