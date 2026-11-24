import { X } from 'lucide-react';
import { useLocaleText } from '../../../i18n/uiLanguage';
import { Dialog } from '../../../ui/dialog';
import { getFileNameFromPath } from '../../../utils/text';
import type { PdfAssetInventoryReport, PdfAssetNamePlan } from '../../../types/library';

interface PdfAssetAuditDialogProps {
  open: boolean;
  loading: boolean;
  error: string;
  inventory: PdfAssetInventoryReport | null;
  namePlan: PdfAssetNamePlan | null;
  duplicateAttachmentIds: ReadonlySet<string>;
  onClose: () => void;
}

/** PDF 存储体检对话框：从 LiteratureLibraryView 原样搬出，只读报告与文案保持不变。 */
export default function PdfAssetAuditDialog({
  open,
  loading,
  error,
  inventory,
  namePlan,
  duplicateAttachmentIds,
  onClose,
}: PdfAssetAuditDialogProps) {
  const l = useLocaleText();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      labelledBy="pdf-asset-audit-title"
      className="max-h-[88vh]"
    >
      <div className="flex items-center justify-between border-b border-[var(--pq-border)] px-5 py-4">
        <div className="min-w-0">
          <h2 id="pdf-asset-audit-title" className="text-base font-semibold">
            {l('PDF 存储体检', 'PDF storage audit')}
          </h2>
          <p className="mt-1 text-xs text-[var(--pq-text-muted)]">
            {l('只核查文库已登记的附件；此报告不会移动或删除文件。', 'Checks registered attachments only. This report does not move or delete files.')}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="pq-icon-button h-8 w-8 shrink-0"
          aria-label={l('关闭', 'Close')}
        >
          <X className="h-4 w-4" strokeWidth={1.9} />
        </button>
      </div>
      <div className="max-h-[calc(88vh-72px)] overflow-auto px-5 py-4">
        {loading ? (
          <div className="py-10 text-center text-sm text-[var(--pq-text-muted)]">{l('正在核验已登记的 PDF…', 'Verifying registered PDFs…')}</div>
        ) : error ? (
          <div role="alert" className="rounded border border-[var(--pq-danger)]/30 bg-[var(--pq-error-bg)] p-3 text-sm text-[var(--pq-danger)]">{error}</div>
        ) : inventory && namePlan ? (
          <>
            <dl className="grid grid-cols-2 gap-x-5 gap-y-3 border-b border-[var(--pq-border)] pb-4 text-sm sm:grid-cols-4">
              <div><dt className="text-xs text-[var(--pq-text-muted)]">{l('附件', 'Attachments')}</dt><dd className="mt-1 font-medium">{inventory.attachmentCount}</dd></div>
              <div><dt className="text-xs text-[var(--pq-text-muted)]">{l('已核验 / 唯一内容', 'Verified / unique')}</dt><dd className="mt-1 font-medium">{inventory.verifiedCount} / {inventory.uniqueVerifiedAssetCount}</dd></div>
              <div><dt className="text-xs text-[var(--pq-text-muted)]">{l('准确重复组', 'Exact duplicate groups')}</dt><dd className="mt-1 font-medium">{inventory.duplicateGroups.length}</dd></div>
              <div><dt className="text-xs text-[var(--pq-text-muted)]">{l('缺失 / 不可读 / hash 不符', 'Missing / unreadable / hash mismatch')}</dt><dd className="mt-1 font-medium">{inventory.missingCount} / {inventory.unreadableCount} / {inventory.hashMismatchCount}</dd></div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--pq-text-muted)]">
              <span>{l('可管理路径的命名预览', 'Managed-path naming preview')}: {namePlan.renameCount}</span>
              <span>{l('外链或未知归属', 'External or unknown ownership')}: {namePlan.externalCount}</span>
            </div>
            <div className="mt-3 overflow-x-auto border-y border-[var(--pq-border)]">
              <table className="w-full min-w-[760px] table-fixed text-left text-xs">
                <thead className="sticky top-0 bg-[var(--pq-bg-primary)] text-[var(--pq-text-muted)]">
                  <tr>
                    <th className="w-[22%] px-2 py-2 font-medium">{l('文献 / 角色', 'Paper / role')}</th>
                    <th className="w-[30%] px-2 py-2 font-medium">{l('当前文件', 'Current file')}</th>
                    <th className="w-[30%] px-2 py-2 font-medium">{l('命名预览', 'Name preview')}</th>
                    <th className="w-[18%] px-2 py-2 font-medium">{l('核验 / 归属', 'Verification / ownership')}</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.entries.map((entry) => {
                    const proposed = namePlan.operations.find((item) => item.attachmentId === entry.attachmentId);
                    const isExactDuplicate = duplicateAttachmentIds.has(entry.attachmentId);
                    const status = entry.status === 'verified'
                      ? l('已核验', 'Verified')
                      : entry.status === 'missing'
                        ? l('缺失', 'Missing')
                        : entry.status === 'hash-mismatch'
                          ? l('hash 不符', 'Hash mismatch')
                          : l('不可读', 'Unreadable');
                    return (
                      <tr key={entry.attachmentId} className="border-t border-[var(--pq-border-subtle)] align-top">
                        <td className="px-2 py-2">
                          <div className="truncate font-medium" title={entry.paperTitle}>{entry.paperTitle}</div>
                          <div className="mt-1 text-[var(--pq-text-muted)]">{entry.role}</div>
                        </td>
                        <td className="px-2 py-2">
                          <div className="truncate" title={entry.path}>{entry.path}</div>
                          <div className="mt-1 text-[var(--pq-text-muted)]">{entry.byteLength == null ? '—' : `${entry.byteLength.toLocaleString()} B`}</div>
                        </td>
                        <td className="px-2 py-2">
                          <div className="truncate" title={proposed?.proposedPath}>{proposed ? getFileNameFromPath(proposed.proposedPath) : '—'}</div>
                          <div className="mt-1 text-[var(--pq-text-muted)]">{proposed?.action === 'unchanged' ? l('已符合规则', 'Already compliant') : proposed?.ownership ? l('预览；未执行', 'Preview only') : l('外部文件不改名', 'External file unchanged')}</div>
                        </td>
                        <td className="px-2 py-2">
                          <div>{status}{isExactDuplicate ? ` · ${l('准确重复', 'Exact duplicate')}` : ''}</div>
                          <div className="mt-1 text-[var(--pq-text-muted)]">{entry.ownership ? l('受管路径', 'Managed path') : l('外链 / 未知', 'External / unknown')}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
