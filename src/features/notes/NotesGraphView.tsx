import { useMemo, useState } from 'react';
import { GLOBAL_NOTES_PAPER_ID } from '../../stores/useNotesStore';
import type { Note, NoteFolder } from '../../types/notes';
import { buildNoteHealthReport, noteHealthBadges, noteHealthCategoryIds, type NoteHealthCategory } from './noteHealth';
import { noteDisplayTitle } from './notesDisplay';
import { useAppLocale, useLocaleText } from '../../i18n/uiLanguage';

const TYPE_COLORS: Record<string, string> = {
  highlight: '#60a5fa',
  area: '#a78bfa',
  standalone: '#34d399',
  'ai-chat': '#f59e0b',
};

interface GraphNode {
  note: Note;
  x: number;
  y: number;
  group: string;
}

interface GraphEdge {
  sourceId: string;
  targetId: string;
}

type Localizer = <T>(zh: T, en: T) => T;

const WIDTH = 900;
const HEIGHT = 560;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2 + 10;

function nodeRadius(note: Note): number {
  const words = note.wordCount ?? (note.contentText ?? '').length;
  return Math.min(16, 6 + Math.sqrt(Math.max(0, words)) / 3);
}

/**
 * 确定性布局（无物理引擎、无第三方依赖）：
 * 按文件夹（或论文归属）分组，组在圆周上，组内笔记排在组内小圆环上。
 */
function layoutGraph(
  notes: Note[],
  folders: NoteFolder[],
  l: Localizer,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const folderNameById = new Map(folders.map((folder) => [folder.id, folder.name]));
  const groupOf = (note: Note): string =>
    (note.folderId && folderNameById.get(note.folderId)) ||
    (note.paperId && note.paperId !== GLOBAL_NOTES_PAPER_ID
      ? l('📄 论文关联', '📄 Paper notes')
      : l('未分类', 'Uncategorized'));

  const groups = new Map<string, Note[]>();
  for (const note of notes) {
    const key = groupOf(note);
    const list = groups.get(key) ?? [];
    list.push(note);
    groups.set(key, list);
  }

  const groupKeys = [...groups.keys()].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  const groupRadius = Math.max(120, Math.min(210, 60 + groupKeys.length * 22));
  const nodes: GraphNode[] = [];

  groupKeys.forEach((key, groupIndex) => {
    const angle = (2 * Math.PI * groupIndex) / Math.max(1, groupKeys.length) - Math.PI / 2;
    const gx = groupKeys.length === 1 ? CENTER_X : CENTER_X + groupRadius * Math.cos(angle);
    const gy = groupKeys.length === 1 ? CENTER_Y : CENTER_Y + groupRadius * Math.sin(angle);
    const members = groups.get(key) ?? [];
    const innerRadius = Math.max(26, Math.min(70, 12 + members.length * 5));
    members.forEach((note, memberIndex) => {
      const memberAngle = (2 * Math.PI * memberIndex) / Math.max(1, members.length) - Math.PI / 2;
      nodes.push({
        note,
        group: key,
        x: members.length === 1 ? gx : gx + innerRadius * Math.cos(memberAngle),
        y: members.length === 1 ? gy : gy + innerRadius * Math.sin(memberAngle),
      });
    });
  });

  const idSet = new Set(notes.map((note) => note.id));
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const note of notes) {
    for (const targetId of note.linkedNoteIds ?? []) {
      if (!idSet.has(targetId)) continue;
      const key = [note.id, targetId].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ sourceId: note.id, targetId });
    }
  }

  return { nodes, edges };
}

export function NotesGraphView({
  notes,
  folders,
  onOpenNote,
}: {
  notes: Note[];
  folders: NoteFolder[];
  onOpenNote: (noteId: string) => void;
}) {
  const [highlightCategory, setHighlightCategory] = useState<NoteHealthCategory | null>(null);
  const l = useLocaleText();
  const locale = useAppLocale();
  const report = useMemo(() => buildNoteHealthReport(notes), [notes]);
  const badges = useMemo(() => noteHealthBadges(report, locale), [locale, report]);
  const highlightedIds = useMemo(
    () => new Set(highlightCategory ? noteHealthCategoryIds(report, highlightCategory) : []),
    [highlightCategory, report],
  );
  const { nodes, edges } = useMemo(() => layoutGraph(notes, folders, l), [notes, folders, l]);
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.note.id, node])), [nodes]);

  if (notes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--pq-text-faint)]">
        {l('暂无笔记可展示', 'No notes to display')}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 体检 badges：点击高亮对应分类节点，再次点击取消 */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2">
        <span className="text-xs text-[var(--pq-text-faint)]">{l('体检：', 'Health:')}</span>
        {badges.map((badge) => (
          <button
            key={badge.category}
            type="button"
            onClick={() => setHighlightCategory((current) => (current === badge.category ? null : badge.category))}
            title={badge.description}
            aria-label={`${badge.label}: ${badge.description} (${badge.count})`}
            aria-pressed={highlightCategory === badge.category}
            className={`rounded-full border px-2 py-0.5 text-xs transition ${
              highlightCategory === badge.category
                ? 'border-[color-mix(in_srgb,var(--pq-danger)_28%,transparent)] bg-[var(--pq-error-bg)] text-[var(--pq-danger)]'
                : badge.count > 0
                  ? 'border-[var(--pq-border)] bg-[var(--pq-bg-secondary)] text-[var(--pq-text-muted)] hover:text-[var(--pq-text)]'
                  : 'border-transparent text-[var(--pq-text-faint)]'
            }`}
          >
            {badge.label} {badge.count}
          </button>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="min-h-0 flex-1"
        role="img"
        aria-label={l('笔记图谱', 'Notes graph')}
      >
        {edges.map((edge) => {
          const source = nodeById.get(edge.sourceId);
          const target = nodeById.get(edge.targetId);
          if (!source || !target) return null;
          return (
            <line
              key={`${edge.sourceId}-${edge.targetId}`}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              stroke="var(--pq-border)"
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.7}
            />
          );
        })}
        {nodes.map((node) => {
          const highlighted = highlightedIds.has(node.note.id);
          const dimmed = highlightCategory !== null && !highlighted;
          const radius = nodeRadius(node.note);
          const title = noteDisplayTitle(node.note.title, l);
          return (
            <g
              key={node.note.id}
              transform={`translate(${node.x}, ${node.y})`}
              opacity={dimmed ? 0.25 : 1}
              style={{ cursor: 'pointer' }}
              onClick={() => onOpenNote(node.note.id)}
            >
              <circle
                r={radius + (highlighted ? 3 : 0)}
                fill={TYPE_COLORS[node.note.type ?? 'standalone'] ?? TYPE_COLORS.standalone}
                stroke={highlighted ? '#f43f5e' : 'var(--pq-bg-primary)'}
                strokeWidth={highlighted ? 2.5 : 1.5}
              />
              <text
                y={radius + 12}
                textAnchor="middle"
                fontSize={10}
                fill="var(--pq-text-muted)"
                style={{ userSelect: 'none', pointerEvents: 'none' }}
              >
                {title.slice(0, 10)}
              </text>
              <title>{`${title} · ${node.group}`}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
