import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import {
  inspectLibraryPdfAssets,
  previewLibraryPdfAssetNames,
} from '../../../services/library';
import type { PdfAssetInventoryReport, PdfAssetNamePlan } from '../../../types/library';

export interface PdfAssetAuditState {
  pdfAssetAuditOpen: boolean;
  setPdfAssetAuditOpen: Dispatch<SetStateAction<boolean>>;
  pdfAssetAuditLoading: boolean;
  pdfAssetAuditError: string;
  pdfAssetInventory: PdfAssetInventoryReport | null;
  pdfAssetNamePlan: PdfAssetNamePlan | null;
  duplicatePdfAttachmentIds: Set<string>;
  handleInspectPdfAssets: () => Promise<void>;
}

/** PDF 资产审计：检查已登记附件的存在性、hash 与命名计划（只读，不移动文件）。 */
export function usePdfAssetAudit(): PdfAssetAuditState {
  const [pdfAssetAuditOpen, setPdfAssetAuditOpen] = useState(false);
  const [pdfAssetAuditLoading, setPdfAssetAuditLoading] = useState(false);
  const [pdfAssetAuditError, setPdfAssetAuditError] = useState('');
  const [pdfAssetInventory, setPdfAssetInventory] = useState<PdfAssetInventoryReport | null>(null);
  const [pdfAssetNamePlan, setPdfAssetNamePlan] = useState<PdfAssetNamePlan | null>(null);
  const duplicatePdfAttachmentIds = useMemo(
    () => new Set(pdfAssetInventory?.duplicateGroups.flatMap((group) => group.map((entry) => entry.attachmentId)) ?? []),
    [pdfAssetInventory],
  );

  const handleInspectPdfAssets = async () => {
    setPdfAssetAuditOpen(true);
    setPdfAssetAuditLoading(true);
    setPdfAssetAuditError('');
    try {
      const [inventory, names] = await Promise.all([
        inspectLibraryPdfAssets(),
        previewLibraryPdfAssetNames(),
      ]);
      setPdfAssetInventory(inventory);
      setPdfAssetNamePlan(names);
    } catch (nextError) {
      setPdfAssetAuditError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setPdfAssetAuditLoading(false);
    }
  };

  return {
    pdfAssetAuditOpen,
    setPdfAssetAuditOpen,
    pdfAssetAuditLoading,
    pdfAssetAuditError,
    pdfAssetInventory,
    pdfAssetNamePlan,
    duplicatePdfAttachmentIds,
    handleInspectPdfAssets,
  };
}
