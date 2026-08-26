import { buildLocalPdfProtocolUrl } from '../pdf/pdfDocumentSource';

/**
 * 读取本地 PDF 的页数；读取失败（文件损坏、非 PDF 等）返回 null。
 * 使用动态 import，避免把 pdfjs 拉进文献库首屏加载路径。
 */
export async function readPdfPageCount(path: string): Promise<number | null> {
  const cleanPath = path.trim();

  if (!cleanPath) {
    return null;
  }

  try {
    const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');

    if (!GlobalWorkerOptions.workerSrc) {
      GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
      ).toString();
    }

    const loadingTask = getDocument({ url: buildLocalPdfProtocolUrl(cleanPath) });
    const document = await loadingTask.promise;

    try {
      return document.numPages;
    } finally {
      await document.destroy();
    }
  } catch {
    return null;
  }
}
