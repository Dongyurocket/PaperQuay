// 生成 Word 加载项清单需要的 PNG 图标（16/32/64/80）。
//
// 纯 Node 实现（zlib + 手写 PNG 分块），不引入图像库：圆角方块底 + 白色「PQ」字形。
// 用法：node scripts/generate-office-addin-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const OUTPUT_DIR = path.join(process.cwd(), 'office-addin', 'assets');
const SIZES = [16, 32, 64, 80];

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/** 把 RGBA 像素缓冲编码成 PNG。 */
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 5x7 点阵字形：P 与 Q。
const GLYPHS = {
  P: [
    '11110',
    '10001',
    '10001',
    '11110',
    '10000',
    '10000',
    '10000',
  ],
  Q: [
    '01110',
    '10001',
    '10001',
    '10001',
    '10011',
    '01110',
    '00001',
  ],
};

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4, 0);
  const radius = Math.max(2, Math.round(size * 0.22));
  const top = [59, 130, 246];
  const bottom = [29, 78, 216];

  const setPixel = (x, y, color, alpha) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const offset = (y * size + x) * 4;
    rgba[offset] = color[0];
    rgba[offset + 1] = color[1];
    rgba[offset + 2] = color[2];
    rgba[offset + 3] = alpha;
  };

  const inRoundedRect = (x, y) => {
    const inner = { left: radius, top: radius, right: size - 1 - radius, bottom: size - 1 - radius };
    if (x >= inner.left && x <= inner.right) return y >= 0 && y <= size - 1;
    if (y >= inner.top && y <= inner.bottom) return x >= 0 && x <= size - 1;
    const cornerX = x < inner.left ? inner.left : inner.right;
    const cornerY = y < inner.top ? inner.top : inner.bottom;
    const dx = x - cornerX;
    const dy = y - cornerY;
    return dx * dx + dy * dy <= radius * radius;
  };

  for (let y = 0; y < size; y += 1) {
    const mix = size === 1 ? 0 : y / (size - 1);
    const color = [
      Math.round(top[0] + (bottom[0] - top[0]) * mix),
      Math.round(top[1] + (bottom[1] - top[1]) * mix),
      Math.round(top[2] + (bottom[2] - top[2]) * mix),
    ];
    for (let x = 0; x < size; x += 1) {
      if (inRoundedRect(x, y)) setPixel(x, y, color, 255);
    }
  }

  const scale = Math.max(1, Math.floor((size * 0.52) / 7));
  const glyphWidth = 5 * scale;
  const glyphHeight = 7 * scale;
  const gap = scale;
  const textWidth = glyphWidth * 2 + gap;
  const originX = Math.round((size - textWidth) / 2);
  const originY = Math.round((size - glyphHeight) / 2);
  const white = [255, 255, 255];

  ['P', 'Q'].forEach((letter, letterIndex) => {
    const rows = GLYPHS[letter];
    const baseX = originX + letterIndex * (glyphWidth + gap);
    rows.forEach((row, rowIndex) => {
      for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
        if (row[columnIndex] !== '1') continue;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            setPixel(baseX + columnIndex * scale + dx, originY + rowIndex * scale + dy, white, 255);
          }
        }
      }
    });
  });

  return encodePng(size, size, rgba);
}

mkdirSync(OUTPUT_DIR, { recursive: true });
for (const size of SIZES) {
  const target = path.join(OUTPUT_DIR, `icon-${size}.png`);
  writeFileSync(target, drawIcon(size));
  process.stdout.write(`wrote ${path.relative(process.cwd(), target)}\n`);
}
