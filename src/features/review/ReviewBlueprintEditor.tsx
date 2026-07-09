import { useEffect, useState } from 'react';
import { GripVertical, ImageIcon, Loader2, Sparkles, Table2 } from 'lucide-react';
import type {
  ReviewBlueprint,
  ReviewBlueprintSection,
  ReviewBlueprintTask,
  ReviewContextItem,
  ReviewJsonFigure,
} from '../../services/reviewWriting';
import { loadLocalAssetDataUrl } from '../../services/assets';
import { cn } from '../../utils/cn';

type LocaleText = (zh: string, en: string) => string;

const MIN_SECTION_PARAGRAPHS = 1;
const MAX_SECTION_PARAGRAPHS = 6;
const MAX_REVIEW_FIGURES_PER_REVIEW = 6;

function clampSectionParagraphCount(value: number) {
  if (!Number.isFinite(value)) {
    return 2;
  }

  return Math.max(MIN_SECTION_PARAGRAPHS, Math.min(MAX_SECTION_PARAGRAPHS, Math.trunc(value)));
}

function createBlueprintParagraphTask(section: ReviewBlueprintSection, index: number): ReviewBlueprintTask {
  const fallbackEvidenceIds = section.evidenceIds.length > 0 ? section.evidenceIds : [];

  return {
    id: `paragraph-${index + 1}`,
    task: `Write paragraph ${index + 1} for "${section.heading}". ${section.task}`,
    evidenceIds: fallbackEvidenceIds,
    retrievalNotes: section.retrievalNotes,
    keyEvidence: section.keyEvidence,
    target: 'one academic paragraph',
  };
}

function resizeSectionParagraphTasks(section: ReviewBlueprintSection, count: number): ReviewBlueprintTask[] {
  const nextCount = clampSectionParagraphCount(count);
  const currentTasks = section.paragraphTasks.length > 0 ? section.paragraphTasks : [createBlueprintParagraphTask(section, 0)];

  if (currentTasks.length >= nextCount) {
    return currentTasks.slice(0, nextCount);
  }

  const nextTasks = [...currentTasks];
  while (nextTasks.length < nextCount) {
    nextTasks.push(createBlueprintParagraphTask(section, nextTasks.length));
  }

  return nextTasks;
}

function moveArrayItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return items;
  }

  const nextItems = [...items];
  const [item] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, item);
  return nextItems;
}

function normalizeFigureId(value: string) {
  return value.trim().toUpperCase();
}

function decodeBasicHtmlEntities(value: string) {
  const decodeCodePoint = (codePoint: number) => {
    try {
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : ' ';
    } catch {
      return ' ';
    }
  };

  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => decodeCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => decodeCodePoint(Number.parseInt(code, 16)));
}

function stripFigurePreviewText(value: string) {
  const text = decodeBasicHtmlEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/!\[([^\]]*)]\([^)]+\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s*\[(?:image|figure|table)\s*#?\d+\]\s*/i, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) {
    return '';
  }

  return text.length > 180 ? `${text.slice(0, 180).trimEnd()}...` : text;
}

function ReviewFigureThumbnail({
  figure,
  l,
}: {
  figure: ReviewJsonFigure;
  l: LocaleText;
}) {
  const [dataUrl, setDataUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const isTable = figure.kind?.toLowerCase().includes('table');
  const Icon = isTable ? Table2 : ImageIcon;

  useEffect(() => {
    if (!figure.path?.trim()) {
      setDataUrl('');
      setLoading(false);
      setFailed(false);
      return;
    }

    let cancelled = false;

    setLoading(true);
    setFailed(false);
    void loadLocalAssetDataUrl(figure.path)
      .then((nextDataUrl) => {
        if (!cancelled) {
          setDataUrl(nextDataUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDataUrl('');
          setFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [figure.path]);

  return (
    <span className="relative flex h-16 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-bg-secondary)]">
      {dataUrl ? (
        <img
          src={dataUrl}
          alt={figure.caption || figure.title || figure.id}
          className="h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <span className="flex flex-col items-center gap-1 text-[10px] text-[var(--pq-text-faint)]">
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
          ) : (
            <Icon className="h-4 w-4" strokeWidth={1.8} />
          )}
          <span className="max-w-[4rem] truncate">
            {failed ? l('预览失败', 'No preview') : isTable ? l('表格', 'Table') : l('图片', 'Image')}
          </span>
        </span>
      )}
      <span className="absolute bottom-1 left-1 rounded bg-[var(--pq-surface)]/90 px-1 py-0.5 text-[9px] font-semibold uppercase text-[var(--pq-text-muted)] shadow-[var(--pq-shadow-sm)]">
        {isTable ? l('表', 'Tab') : l('图', 'Img')}
      </span>
    </span>
  );
}

function collectAvailableReviewFigures(contextItems: ReviewContextItem[]): ReviewJsonFigure[] {
  const figures: ReviewJsonFigure[] = [];
  const seenIds = new Set<string>();

  for (const item of contextItems) {
    for (const figure of item.figures ?? []) {
      const id = figure.id.trim();
      const normalizedId = normalizeFigureId(id);

      if (!id || seenIds.has(normalizedId)) {
        continue;
      }

      seenIds.add(normalizedId);
      figures.push({
        ...figure,
        id,
        sourceId: figure.sourceId || item.id,
        sourceTitle: figure.sourceTitle || item.title,
        caption: figure.caption || figure.title || id,
      });
    }
  }

  return figures;
}

export function ReviewBlueprintEditor({
  blueprint,
  contextItems,
  l,
  onChange,
}: {
  blueprint: ReviewBlueprint | null;
  contextItems: ReviewContextItem[];
  l: LocaleText;
  onChange: (blueprint: ReviewBlueprint) => void;
}) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const availableFigures = collectAvailableReviewFigures(contextItems);

  if (!blueprint) {
    return (
      <div className="rounded-[var(--pq-radius-md)] border border-dashed border-[var(--pq-border)] bg-[var(--pq-surface)] p-6 text-center text-xs leading-5 text-[var(--pq-text-muted)]">
        {l('先检索上下文并生成大纲，这里会显示可调整的章节分布。', 'Retrieve context and generate an outline first. Editable section distribution appears here.')}
      </div>
    );
  }

  const updateSection = (sectionIndex: number, patch: Partial<ReviewBlueprintSection>) => {
    onChange({
      ...blueprint,
      sections: blueprint.sections.map((section, index) =>
        index === sectionIndex ? { ...section, ...patch } : section,
      ),
    });
  };

  const moveSection = (fromIndex: number, toIndex: number) => {
    onChange({
      ...blueprint,
      sections: moveArrayItem(blueprint.sections, fromIndex, toIndex),
    });
  };
  const selectedFigureIds = new Set(blueprint.figures.map((figure) => normalizeFigureId(figure.id)));
  const figureChoices = [
    ...availableFigures,
    ...blueprint.figures.filter((figure) => !availableFigures.some((item) => normalizeFigureId(item.id) === normalizeFigureId(figure.id))),
  ];
  const updateFigureSelection = (figure: ReviewJsonFigure, checked: boolean) => {
    const figureId = normalizeFigureId(figure.id);

    if (checked) {
      if (selectedFigureIds.has(figureId) || blueprint.figures.length >= MAX_REVIEW_FIGURES_PER_REVIEW) {
        return;
      }

      onChange({
        ...blueprint,
        figures: [
          ...blueprint.figures,
          {
            ...figure,
            caption: figure.caption || figure.title || figure.id,
          },
        ],
      });
      return;
    }

    onChange({
      ...blueprint,
      figures: blueprint.figures.filter((item) => normalizeFigureId(item.id) !== figureId),
    });
  };

  const totalParagraphs = blueprint.sections.reduce(
    (count, section) => count + Math.max(1, section.paragraphTasks.length),
    0,
  );

  return (
    <div className="rounded-[var(--pq-radius-md)] border border-[var(--pq-border)] bg-[var(--pq-surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--pq-border)] px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--pq-text)]">
            <Sparkles className="h-4 w-4 text-[var(--pq-accent)]" strokeWidth={1.9} />
            {l('写作大纲', 'Writing Outline')}
          </div>
          <div className="mt-0.5 truncate text-xs text-[var(--pq-text-muted)]">
            {l(
              `${blueprint.sections.length} 个章节 · ${totalParagraphs} 个段落任务`,
              `${blueprint.sections.length} section(s) · ${totalParagraphs} paragraph task(s)`,
            )}
          </div>
        </div>
      </div>

      <div className="space-y-3 p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
          <label className="space-y-1 text-xs font-medium text-[var(--pq-text-muted)]">
            <span>{l('标题', 'Title')}</span>
            <input
              value={blueprint.title}
              onChange={(event) => onChange({ ...blueprint, title: event.target.value })}
              className="pq-input h-9 w-full px-2 text-sm"
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-[var(--pq-text-muted)]">
            <span>{l('关键词', 'Keywords')}</span>
            <input
              value={blueprint.keywords.join(', ')}
              onChange={(event) =>
                onChange({
                  ...blueprint,
                  keywords: event.target.value.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
                })
              }
              className="pq-input h-9 w-full px-2 text-sm"
            />
          </label>
        </div>

        <label className="space-y-1 text-xs font-medium text-[var(--pq-text-muted)]">
          <span>{l('核心论点', 'Thesis')}</span>
          <textarea
            value={blueprint.thesis}
            onChange={(event) => onChange({ ...blueprint, thesis: event.target.value })}
            className="pq-input min-h-16 w-full resize-none px-2 py-2 text-sm leading-5"
          />
        </label>

        <div className="space-y-2">
          {blueprint.sections.map((section, sectionIndex) => {
            const paragraphCount = Math.max(1, section.paragraphTasks.length);

            return (
              <div
                key={section.id}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggedIndex !== null) {
                    moveSection(draggedIndex, sectionIndex);
                  }
                  setDraggedIndex(null);
                }}
                className={cn(
                  'rounded-[var(--pq-radius-sm)] border bg-[var(--pq-bg-secondary)] p-3 transition',
                  draggedIndex === sectionIndex
                    ? 'border-[var(--pq-accent-border)] opacity-70'
                    : 'border-[var(--pq-border)] hover:border-[var(--pq-accent-border)]',
                )}
              >
                <div className="flex items-start gap-2">
                  <div
                    draggable
                    onDragStart={() => setDraggedIndex(sectionIndex)}
                    onDragEnd={() => setDraggedIndex(null)}
                    className="mt-1 flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded-md border border-[var(--pq-border)] bg-[var(--pq-surface)] text-[var(--pq-text-faint)] active:cursor-grabbing"
                    title={l('拖动调整章节顺序', 'Drag to reorder sections')}
                  >
                    <GripVertical className="h-4 w-4" strokeWidth={1.8} />
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_150px]">
                      <input
                        value={section.heading}
                        onChange={(event) => updateSection(sectionIndex, { heading: event.target.value })}
                        className="pq-input h-8 w-full px-2 text-sm font-semibold"
                      />
                      <div className="flex items-center gap-2 rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)] px-2">
                        <input
                          type="range"
                          min={MIN_SECTION_PARAGRAPHS}
                          max={MAX_SECTION_PARAGRAPHS}
                          value={paragraphCount}
                          onChange={(event) =>
                            updateSection(sectionIndex, {
                              paragraphTasks: resizeSectionParagraphTasks(section, Number(event.target.value)),
                            })
                          }
                          className="min-w-0 flex-1 accent-[var(--pq-accent)]"
                          aria-label={l('段落数', 'Paragraph count')}
                        />
                        <span className="w-10 text-right text-[11px] font-semibold text-[var(--pq-text-muted)]">
                          {paragraphCount} {l('段', 'para')}
                        </span>
                      </div>
                    </div>

                    <textarea
                      value={section.task}
                      onChange={(event) => updateSection(sectionIndex, { task: event.target.value })}
                      className="pq-input min-h-16 w-full resize-none px-2 py-2 text-xs leading-5"
                      placeholder={l('章节写作要求', 'Section writing requirement')}
                    />

                    <div className="flex flex-wrap gap-1">
                      {(section.evidenceIds.length > 0 ? section.evidenceIds : ['P1']).slice(0, 6).map((id) => (
                        <span
                          key={id}
                          className="rounded-md bg-[var(--pq-accent-bg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--pq-accent)]"
                        >
                          {id}
                        </span>
                      ))}
                      {section.retrievalNotes ? (
                        <span className="max-w-[220px] truncate rounded-md border border-[var(--pq-border)] bg-[var(--pq-surface)] px-1.5 py-0.5 text-[10px] text-[var(--pq-text-muted)]">
                          {section.retrievalNotes}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {figureChoices.length > 0 ? (
          <div className="space-y-2 rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-bg-secondary)] p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-semibold text-[var(--pq-text)]">{l('图表插入', 'Figures')}</div>
              <span className="rounded-md bg-[var(--pq-surface)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--pq-text-muted)]">
                {blueprint.figures.length}/{MAX_REVIEW_FIGURES_PER_REVIEW}
              </span>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {figureChoices.map((figure) => {
                const selected = selectedFigureIds.has(normalizeFigureId(figure.id));
                const disabled = !selected && blueprint.figures.length >= MAX_REVIEW_FIGURES_PER_REVIEW;
                const previewText = stripFigurePreviewText(figure.caption || figure.title || figure.kind);
                const sourceText = stripFigurePreviewText(figure.sourceTitle || figure.sourceId || figure.kind);

                return (
                  <label
                    key={figure.id}
                    className={cn(
                      'grid min-w-0 grid-cols-[auto_1fr_auto] items-start gap-2 rounded-[var(--pq-radius-sm)] border px-2 py-2 text-xs transition',
                      selected
                        ? 'border-[var(--pq-accent-border)] bg-[var(--pq-accent-bg)]'
                        : 'border-[var(--pq-border)] bg-[var(--pq-surface)] hover:border-[var(--pq-accent-border)]',
                      disabled ? 'opacity-60' : '',
                    )}
                  >
                    <ReviewFigureThumbnail figure={figure} l={l} />
                    <span className="min-w-0">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="shrink-0 rounded-md bg-[var(--pq-surface)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--pq-accent)]">
                          {figure.id}
                        </span>
                        {typeof figure.pageIndex === 'number' ? (
                          <span className="shrink-0 rounded-md border border-[var(--pq-border)] px-1.5 py-0.5 text-[10px] text-[var(--pq-text-faint)]">
                            p.{figure.pageIndex + 1}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 line-clamp-1 block font-medium leading-4 text-[var(--pq-text)]">
                        {sourceText || figure.kind}
                      </span>
                      <span className="mt-1 line-clamp-2 block leading-4 text-[var(--pq-text-muted)]">
                        {previewText || (figure.kind?.toLowerCase().includes('table') ? l('表格候选', 'Table candidate') : l('图片候选', 'Figure candidate'))}
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={disabled}
                      onChange={(event) => updateFigureSelection(figure, event.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--pq-accent)]"
                    />
                  </label>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
