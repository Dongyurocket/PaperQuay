// 验收用 PDF 夹具：运行时生成到临时目录，不把 PDF 二进制提交进仓库。
// - simple：pdf-lib 生成的多页英文 PDF，用于导入/阅读/笔记冒烟。
// - chineseCid：手写 Type0/CIDFontType0 + UniGB-UCS2-H 的中文 PDF，
//   字体不嵌入，依赖 pdfjs 的 cmaps（打包时随 pdfjs/cmaps 提供）。
import fs from 'node:fs/promises';
import path from 'node:path';

function hexUtf16Be(text) {
  return Array.from(text)
    .map((char) => char.charCodeAt(0).toString(16).padStart(4, '0'))
    .join('')
    .toUpperCase();
}

function buildPdf(objects) {
  const header = '%PDF-1.4\n%âãÏÓ\n';
  let body = '';
  const offsets = [];

  objects.forEach((object, index) => {
    offsets.push(header.length + body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = header.length + body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }

  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(header + body + xref + trailer, 'latin1');
}

export function buildChineseCidPdfBuffer() {
  const lines = ['中文测试文档', '公式与图表：E = mc²', 'PaperQuay CID font smoke'];
  const textOps = lines
    .map((line, index) => `${index === 0 ? '' : '0 -40 Td\n'}<${hexUtf16Be(line)}> Tj`)
    .join('\n');
  const stream = `BT\n/F1 22 Tf\n72 760 Td\n${textOps}\nET\n`;

  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [6 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor 7 0 R /DW 1000 >>',
    '<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [-25 -254 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 93 >>',
  ]);
}

export async function buildSimplePdfBuffer() {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  for (let pageIndex = 0; pageIndex < 3; pageIndex += 1) {
    const page = doc.addPage([595, 842]);
    page.drawText(`PaperQuay Audit Fixture ${pageIndex + 1}`, {
      x: 64,
      y: 760,
      size: 22,
      font: bold,
      color: rgb(0.1, 0.15, 0.25),
    });
    page.drawText('This PDF is generated at test time and never committed.', {
      x: 64,
      y: 720,
      size: 12,
      font,
      color: rgb(0.25, 0.3, 0.4),
    });
    page.drawText('Abstract: a deterministic fixture for reader, notes, RAG and backup smoke tests.', {
      x: 64,
      y: 690,
      size: 10,
      font,
    });
    for (let line = 0; line < 12; line += 1) {
      page.drawText(`Line ${line + 1}: lorem ipsum dolor sit amet, consectetur adipiscing elit.`, {
        x: 64,
        y: 650 - line * 18,
        size: 10,
        font,
        color: rgb(0.2, 0.2, 0.2),
      });
    }
  }

  return Buffer.from(await doc.save());
}

export async function writePdfFixtures(directory) {
  await fs.mkdir(directory, { recursive: true });
  const simplePath = path.join(directory, 'audit-simple.pdf');
  const chinesePath = path.join(directory, 'audit-chinese-cid.pdf');
  await fs.writeFile(simplePath, await buildSimplePdfBuffer());
  await fs.writeFile(chinesePath, buildChineseCidPdfBuffer());
  return { simplePath, chinesePath };
}
