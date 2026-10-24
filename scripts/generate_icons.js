// scripts/generate_icons.js - Generates branded 512x512 PNG icon and .ico for Coder Browser
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const assetsDir = path.join(__dirname, '../assets');
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

function createPng(width, height) {
  // RGBA buffer
  const rowBytes = width * 4 + 1; // 1 filter byte per row
  const rawData = Buffer.alloc(rowBytes * height);

  const cx = width / 2;
  const cy = height / 2;
  const rOuter = width * 0.44;
  const rInner = width * 0.38;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowBytes;
    rawData[rowOffset] = 0; // Filter type None

    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Background rounded shield/circle
      if (dist <= rOuter) {
        // Gradient from Dark Slate #0f172a to Indigo #1e1b4b
        const grad = (y / height);
        let red = Math.round(15 + grad * 15);
        let green = Math.round(23 + grad * 10);
        let blue = Math.round(42 + grad * 50);
        let alpha = 255;

        // Anti-aliased outer edge
        if (dist > rOuter - 2) {
          alpha = Math.round(255 * ((rOuter - dist) / 2));
        }

        // Inner glowing border
        if (dist > rInner && dist <= rInner + 4) {
          red = 59;
          green = 130;
          blue = 246; // Bright Blue border
        }

        // Code bracket symbols "< / >" in center
        // Let's draw "<" on left, "/" in center, ">" on right
        const inCenterY = Math.abs(y - cy) < height * 0.22;
        const normY = (y - cy) / (height * 0.22); // -1 to 1

        // Slash in middle
        const slashX = cx - (y - cy) * 0.4;
        const isSlash = inCenterY && Math.abs(x - slashX) < 8;

        // Left bracket '<'
        const leftBracketX = cx - 70 - Math.abs(normY) * 45;
        const isLeftBracket = inCenterY && Math.abs(x - leftBracketX) < 9;

        // Right bracket '>'
        const rightBracketX = cx + 70 + Math.abs(normY) * 45;
        const isRightBracket = inCenterY && Math.abs(x - rightBracketX) < 9;

        if (isSlash) {
          red = 147;
          green = 197;
          blue = 253; // Cyan-blue
        } else if (isLeftBracket || isRightBracket) {
          red = 96;
          green = 165;
          blue = 250; // Electric blue
        }

        rawData[pxOffset] = red;
        rawData[pxOffset + 1] = green;
        rawData[pxOffset + 2] = blue;
        rawData[pxOffset + 3] = alpha;
      } else {
        // Transparent
        rawData[pxOffset] = 0;
        rawData[pxOffset + 1] = 0;
        rawData[pxOffset + 2] = 0;
        rawData[pxOffset + 3] = 0;
      }
    }
  }

  // Compress with zlib
  const compressedData = zlib.deflateSync(rawData);

  // PNG Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = createChunk('IHDR', ihdr);
  const idatChunk = createChunk('IDAT', compressedData);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(len + 12);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4);
  data.copy(chunk, 8);

  const crc = crc32(chunk.slice(4, len + 8));
  chunk.writeInt32BE(crc, len + 8);
  return chunk;
}

// Simple CRC32 for PNG chunks
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) | 0;
}

function createIcoFromPng(pngBuffer) {
  // Standard ICO format containing the PNG image directly
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Type 1 = ICO
  header.writeUInt16LE(1, 4); // 1 Image

  const entry = Buffer.alloc(16);
  entry[0] = 0; // Width: 0 means 256+
  entry[1] = 0; // Height: 0 means 256+
  entry[2] = 0; // Color count
  entry[3] = 0; // Reserved
  entry.writeUInt16LE(1, 4); // Color planes
  entry.writeUInt16LE(32, 6); // Bits per pixel
  entry.writeUInt32LE(pngBuffer.length, 8); // Size of image data
  entry.writeUInt32LE(22, 12); // Offset to image data (6 header + 16 entry)

  return Buffer.concat([header, entry, pngBuffer]);
}

// Generate 512x512 PNG
console.log('Generating assets/icon.png...');
const png512 = createPng(512, 512);
fs.writeFileSync(path.join(assetsDir, 'icon.png'), png512);

console.log('Generating assets/icon.ico...');
// Generate 256x256 for optimal standard ICO compatibility
const png256 = createPng(256, 256);
const ico = createIcoFromPng(png256);
fs.writeFileSync(path.join(assetsDir, 'icon.ico'), ico);

console.log('✓ Successfully created assets/icon.png and assets/icon.ico');
