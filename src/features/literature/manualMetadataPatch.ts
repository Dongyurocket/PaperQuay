import type { LiteraturePaper, UpdatePaperRequest } from '../../types/library';
import type { MetadataLookupResult } from '../../types/metadata';
import type { MetadataParseDialogState } from './dialogs/MetadataParseDialog';
import { metadataUpdateForPaper } from './literatureLibraryUtils.ts';

/**
 * 手动/自动元数据解析的待写补丁（唯一实现）。
 *
 * - 远程元数据字段走 `metadataUpdateForPaper`：只写真正变化的字段，并保留
 *   自动标题保护、语言/作者详情/分类等既有规则；
 * - 用户手输的标题/DOI 覆盖远程结果；
 * - publisher/volume/issue/pages/issn 与其它书目字段同等对待，避免“解析成功但
 *   卷期页从未写回”的静默丢失；
 * - expectedUpdatedAt 让写入带上乐观并发版本。
 *
 * 识别对话框与 `useMetadataJobs` 共用本函数，不再各维护一份 patch 逻辑。
 */
export function buildManualMetadataUpdateRequest(
  paper: LiteraturePaper,
  metadata: MetadataLookupResult | null,
  draft: Pick<MetadataParseDialogState, 'title' | 'doi'>,
): UpdatePaperRequest | null {
  const request = metadata ? metadataUpdateForPaper(paper, metadata) : null;
  const output: UpdatePaperRequest = {
    paperId: paper.id,
    expectedUpdatedAt: paper.updatedAt,
    ...(request ?? {}),
  };
  output.paperId = paper.id;
  output.expectedUpdatedAt = paper.updatedAt;

  const manualTitle = draft.title.trim();
  const manualDoi = draft.doi.trim();
  if (manualTitle && manualTitle !== paper.title.trim()) output.title = manualTitle;
  if (manualDoi && manualDoi !== (paper.doi ?? '').trim()) output.doi = manualDoi;

  return Object.keys(output).some((key) => key !== 'paperId' && key !== 'expectedUpdatedAt')
    ? output
    : null;
}
