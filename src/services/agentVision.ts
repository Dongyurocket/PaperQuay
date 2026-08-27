import type { DocumentChatAttachment, RagRetrievalResult } from '../types/reader';

export const AGENT_VISION_LIMITS = {
  maxImagesPerTurn: 4,
  maxImageEdge: 1568,
  maxTotalBytes: 8 * 1024 * 1024,
} as const;

export interface AgentVisionCandidate {
  id: string;
  source: 'user' | 'rag' | 'tool';
  paperId?: string;
  paperTitle?: string;
  caption: string;
  path?: string;
  dataUrl?: string;
  mimeType?: string;
  pageIndex?: number;
  blockId?: string;
  kind: string;
  /** Lower is better, matching the local RAG retrieval contract. */
  score: number;
}

export interface AgentVisionPreparation {
  attachments: DocumentChatAttachment[];
  included: AgentVisionCandidate[];
  skippedCount: number;
  notice: string | null;
}

export function dataUrlByteLength(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

function mimeTypeFromDataUrl(dataUrl: string, fallback = 'image/jpeg'): string {
  const match = dataUrl.match(/^data:([^;,]+)[;,]/i);
  return match?.[1]?.trim() || fallback;
}

function imageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to decode Agent vision image.'));
    image.src = dataUrl;
  });
}

export async function compressAgentVisionDataUrl(
  dataUrl: string,
  options: { maxImageEdge?: number; quality?: number } = {},
): Promise<string> {
  const maxImageEdge = Math.max(1, Math.trunc(options.maxImageEdge ?? AGENT_VISION_LIMITS.maxImageEdge));
  const quality = Math.max(0.1, Math.min(1, options.quality ?? 0.85));
  const image = await imageFromDataUrl(dataUrl);
  const sourceWidth = Math.max(1, image.naturalWidth || image.width);
  const sourceHeight = Math.max(1, image.naturalHeight || image.height);
  const scale = Math.min(1, maxImageEdge / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });

  if (!context) {
    throw new Error('Unable to create Agent vision compression canvas.');
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}

export function matchRagVisionCandidates(input: {
  paperId: string;
  paperTitle: string;
  figures: Array<{
    id: string;
    caption: string;
    path: string;
    pageIndex?: number;
    blockId?: string;
    kind: string;
  }>;
  retrievals: RagRetrievalResult[];
}): AgentVisionCandidate[] {
  const scoreByBlockId = new Map<string, number>();

  for (const retrieval of input.retrievals) {
    const blockId = retrieval.blockId?.trim();
    if (!blockId) continue;
    const current = scoreByBlockId.get(blockId);
    if (current === undefined || retrieval.score < current) {
      scoreByBlockId.set(blockId, retrieval.score);
    }
  }

  return input.figures
    .filter((figure) => figure.blockId && scoreByBlockId.has(figure.blockId))
    .map((figure) => ({
      id: `${input.paperId}:${figure.id}`,
      source: 'rag' as const,
      paperId: input.paperId,
      paperTitle: input.paperTitle,
      caption: figure.caption,
      path: figure.path,
      pageIndex: figure.pageIndex,
      blockId: figure.blockId,
      kind: figure.kind,
      score: scoreByBlockId.get(figure.blockId ?? '') ?? Number.POSITIVE_INFINITY,
    }))
    .sort((left, right) => left.score - right.score || left.id.localeCompare(right.id));
}

export function userAttachmentVisionCandidates(
  attachments: DocumentChatAttachment[] | undefined,
): AgentVisionCandidate[] {
  return (attachments ?? [])
    .filter((attachment) =>
      Boolean(attachment.dataUrl || attachment.filePath) &&
      (attachment.kind === 'image' || attachment.kind === 'screenshot' || attachment.mimeType.startsWith('image/')),
    )
    .map((attachment, index) => ({
      id: attachment.id,
      source: 'user' as const,
      caption: attachment.summary || attachment.name,
      path: attachment.filePath,
      dataUrl: attachment.dataUrl,
      mimeType: attachment.mimeType,
      kind: attachment.kind,
      score: Number.NEGATIVE_INFINITY + index,
    }));
}

export async function prepareAgentVisionAttachments(input: {
  candidates: AgentVisionCandidate[];
  supportsVision: boolean;
  loadDataUrl?: (path: string) => Promise<string>;
  compress?: (dataUrl: string) => Promise<string>;
  limits?: Partial<typeof AGENT_VISION_LIMITS>;
}): Promise<AgentVisionPreparation> {
  const maxImages = Math.max(1, Math.trunc(input.limits?.maxImagesPerTurn ?? AGENT_VISION_LIMITS.maxImagesPerTurn));
  const maxTotalBytes = Math.max(1, Math.trunc(input.limits?.maxTotalBytes ?? AGENT_VISION_LIMITS.maxTotalBytes));
  const loadDataUrl = input.loadDataUrl ?? (async (path: string) => {
    const { loadLocalAssetDataUrl } = await import('./assets.ts');
    return loadLocalAssetDataUrl(path);
  });
  const compress = input.compress ?? ((dataUrl: string) => compressAgentVisionDataUrl(dataUrl, {
    maxImageEdge: input.limits?.maxImageEdge,
  }));
  const candidates = [...input.candidates]
    .sort((left, right) => left.score - right.score || left.id.localeCompare(right.id))
    .filter((candidate, index, all) => all.findIndex((item) => item.id === candidate.id) === index);

  if (!input.supportsVision) {
    return {
      attachments: [],
      included: [],
      skippedCount: candidates.length,
      notice: candidates.length > 0 ? '当前模型不支持视觉，图片未发送。' : null,
    };
  }

  const attachments: DocumentChatAttachment[] = [];
  const included: AgentVisionCandidate[] = [];
  let totalBytes = 0;
  let skippedCount = 0;

  for (const candidate of candidates) {
    if (attachments.length >= maxImages) {
      skippedCount += 1;
      continue;
    }

    try {
      const rawDataUrl = candidate.dataUrl || (candidate.path ? await loadDataUrl(candidate.path) : '');
      if (!rawDataUrl) {
        skippedCount += 1;
        continue;
      }
      const dataUrl = await compress(rawDataUrl);
      const size = dataUrlByteLength(dataUrl);

      if (size <= 0 || totalBytes + size > maxTotalBytes) {
        skippedCount += 1;
        continue;
      }

      totalBytes += size;
      included.push(candidate);
      attachments.push({
        id: `agent-vision:${candidate.id}`,
        kind: 'image',
        name: candidate.pageIndex === undefined ? candidate.id : `fig-p${candidate.pageIndex + 1}`,
        mimeType: mimeTypeFromDataUrl(dataUrl, candidate.mimeType),
        size,
        filePath: candidate.path,
        dataUrl,
        summary: candidate.caption,
      });
    } catch {
      skippedCount += 1;
    }
  }

  const notice = skippedCount > 0
    ? `已发送 ${included.length} 张图片，另有 ${skippedCount} 张因数量、大小或读取限制未发送。`
    : null;

  return { attachments, included, skippedCount, notice };
}
