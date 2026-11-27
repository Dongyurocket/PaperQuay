import { useMemo, useState } from 'react';
import { RotateCcw, Trash2, X } from 'lucide-react';

import { useLocaleText } from '../../i18n/uiLanguage';
import type { MineruBlockEdits } from '../../services/parseEdits';
import { confirmAction } from '../../ui/confirmHost';
import { Dialog } from '../../ui/dialog';
import type { PositionedMineruBlock } from '../../types/reader';

interface ParseEditsDialogProps {
  blocks: PositionedMineruBlock[];
  edits: MineruBlockEdits;
  staleCount: number;
  onRestoreBlock: (blockId: string) => Promise<void>;
  onRestoreAll: () => Promise<void>;
  onClose: () => void;
}

function previewText(text: string | undefined): string {
  const normalized = (text ?? '').replace(/\s+/g, ' ').trim();

  return normalized.length > 140 ? `${normalized.slice(0, 140)}…` : normalized;
}

/**
 * 识别结果调整列表。
 *
 * 被隐藏的块不会出现在正文里，因此必须有一个入口能看见并恢复它们；
 * 同时展示文本修正过的块，便于逐条回退到 MinerU 原始识别。
 */
export function ParseEditsDialog({
  blocks,
  edits,
  staleCount,
  onRestoreBlock,
  onRestoreAll,
  onClose,
}: ParseEditsDialogProps) {
  const l = useLocaleText();
  const [busyBlockId, setBusyBlockId] = useState('');
  const [restoringAll, setRestoringAll] = useState(false);
  const [error, setError] = useState('');
  const blockOrder = useMemo(
    () => new Map(blocks.map((block, index) => [block.blockId, index])),
    [blocks],
  );
  const blockById = useMemo(
    () => new Map(blocks.map((block) => [block.blockId, block])),
    [blocks],
  );
  const entries = useMemo(
    () => Object.entries(edits)
      .map(([blockId, edit]) => ({ blockId, edit, block: blockById.get(blockId) }))
      .sort((left, right) => (
        (blockOrder.get(left.blockId) ?? Number.MAX_SAFE_INTEGER)
        - (blockOrder.get(right.blockId) ?? Number.MAX_SAFE_INTEGER)
      )),
    [blockById, blockOrder, edits],
  );

  const handleRestore = async (blockId: string) => {
    if (busyBlockId || restoringAll) return;
    setBusyBlockId(blockId);
    setError('');
    try {
      await onRestoreBlock(blockId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyBlockId('');
    }
  };

  const handleRestoreAll = async () => {
    if (busyBlockId || restoringAll || entries.length === 0) return;

    const confirmed = await confirmAction({
      title: l('恢复全部识别结果？', 'Restore all recognized content?'),
      description: l(
        `将清除 ${entries.length} 处手动调整，全部回到 MinerU 原始识别结果。`,
        `This clears ${entries.length} manual adjustments and returns to the original MinerU result.`,
      ),
      confirmLabel: l('全部恢复', 'Restore all'),
    });

    if (!confirmed) return;

    setRestoringAll(true);
    setError('');
    try {
      await onRestoreAll();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRestoringAll(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      overlay="soft"
      dismissOnBackdrop={!busyBlockId && !restoringAll}
      size="lg"
      labelledBy="pq-parse-edits-title"
      className="flex max-h-[85vh] flex-col bg-white dark:bg-[var(--pq-surface-1)]"
    >
      <div className="flex items-center justify-between border-b border-[var(--pq-border)] px-5 py-4 dark:border-white/10">
        <div>
          <h3 id="pq-parse-edits-title" className="text-sm font-semibold text-[var(--pq-text)]">
            {l('识别结果调整', 'Recognition Adjustments')}
          </h3>
          <p className="text-xs text-[var(--pq-text-faint)]">
            {l(
              `${entries.length} 处调整${staleCount > 0 ? ` · ${staleCount} 处因重新解析已失效` : ''}；重新索引后进入知识库检索`,
              `${entries.length} adjustment(s)${staleCount > 0 ? ` · ${staleCount} stale after re-parse` : ''}; applied to knowledge search after re-indexing`,
            )}
          </p>
        </div>
        <button type="button" onClick={onClose} disabled={Boolean(busyBlockId) || restoringAll} aria-label={l('关闭', 'Close')} className="rounded-lg p-1 text-[var(--pq-text-faint)] disabled:opacity-40"><X className="h-4 w-4" /></button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
        {entries.length === 0 ? (
          <p className="py-8 text-center text-xs text-[var(--pq-text-muted)]">
            {l('当前没有手动调整的识别结果。', 'No manual adjustments yet.')}
          </p>
        ) : (
          <ul className="space-y-2">
            {entries.map(({ blockId, edit, block }) => (
              <li key={blockId} className="flex items-start gap-3 rounded-xl border border-[var(--pq-border)] px-3 py-2.5 dark:border-white/10">
                <span className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${edit.deleted ? 'bg-[var(--pq-error-bg)] text-[var(--pq-danger)]' : 'bg-[var(--pq-accent-bg)] text-[var(--pq-accent)]'}`}>
                  {edit.deleted ? <Trash2 className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--pq-text-muted)]">
                    <span className="font-semibold text-[var(--pq-text)]">{edit.deleted ? l('已删除', 'Deleted') : l('已编辑', 'Edited')}</span>
                    <span>{block ? l(`第 ${block.pageIndex + 1} 页 · 块 ${block.blockIndex + 1}`, `Page ${block.pageIndex + 1} · Block ${block.blockIndex + 1}`) : blockId}</span>
                    {block ? <span className="uppercase tracking-wide">{block.type}</span> : null}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--pq-text-muted)]">
                    {edit.deleted
                      ? l('该块已从正文、翻译与索引中排除。', 'Excluded from reading, translation and indexing.')
                      : previewText(edit.text)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={Boolean(busyBlockId) || restoringAll}
                  onClick={() => void handleRestore(blockId)}
                  className="shrink-0 rounded-lg border border-[var(--pq-border)] px-2.5 py-1 text-[11px] text-[var(--pq-text-muted)] disabled:opacity-40"
                >
                  {busyBlockId === blockId ? l('恢复中…', 'Restoring…') : l('恢复', 'Restore')}
                </button>
              </li>
            ))}
          </ul>
        )}
        {error ? <p role="alert" className="mt-3 text-xs text-[var(--pq-danger)]">{error}</p> : null}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-[var(--pq-border)] px-5 py-3.5 dark:border-white/10">
        <button
          type="button"
          disabled={entries.length === 0 || Boolean(busyBlockId) || restoringAll}
          onClick={() => void handleRestoreAll()}
          className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs disabled:opacity-40"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {restoringAll ? l('恢复中…', 'Restoring…') : l('恢复全部', 'Restore all')}
        </button>
        <button type="button" disabled={Boolean(busyBlockId) || restoringAll} onClick={onClose} className="px-3 py-1.5 text-xs disabled:opacity-40">
          {l('关闭', 'Close')}
        </button>
      </div>
    </Dialog>
  );
}
