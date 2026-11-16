/**
 * scripts/generate-icons.mjs
 * ---------------------------------------------------------------------------
 * Generatore delle icone PNG della PWA.
 *
 * Non essendo disponibili librerie di imaging nel progetto (l'obiettivo e'
 * ridurre al minimo le dipendenze), le icone vengono disegnate a mano su un
 * buffer RGBA e serializzate in PNG con un encoder minimale basato su zlib
 * (disponibile nativamente in Node).
 *
 * Uso: node scripts/generate-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'icons');

/* ------------------------------------------------------------------ */
/* Encoder PNG minimale                                                */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

/**
 * Serializza un buffer RGBA in un file PNG.
 * @param {Uint8Array} rgba width*height*4 byte
 * @param {number} width
 * @param {number} height
 * @returns {Buffer}
 */
function encodePng(rgba, width, height) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Scanline: 1 byte di filtro (0 = None) + pixel RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1
    );
  }

  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ */
/* Disegno                                                             */
/* ------------------------------------------------------------------ */

class Canvas {
  constructor(size) {
    this.size = size;
    this.data = new Uint8Array(size * size * 4);
  }

  set(x, y, [r, g, b, a]) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    const i = (y * this.size + x) * 4;
    // Composizione "source-over" semplificata.
    const alpha = a / 255;
    this.data[i] = Math.round(this.data[i] * (1 - alpha) + r * alpha);
    this.data[i + 1] = Math.round(this.data[i + 1] * (1 - alpha) + g * alpha);
    this.data[i + 2] = Math.round(this.data[i + 2] * (1 - alpha) + b * alpha);
    this.data[i + 3] = Math.max(this.data[i + 3], a);
  }

  /** Rettangolo pieno. */
  rect(x0, y0, w, h, color) {
    for (let y = Math.round(y0); y < Math.round(y0 + h); y++) {
      for (let x = Math.round(x0); x < Math.round(x0 + w); x++) {
        this.set(x, y, color);
      }
    }
  }

  /** Rettangolo con angoli arrotondati (usato per lo sfondo). */
  roundedRect(x0, y0, w, h, radius, color) {
    for (let y = Math.round(y0); y < Math.round(y0 + h); y++) {
      for (let x = Math.round(x0); x < Math.round(x0 + w); x++) {
        const dx = Math.min(x - x0, x0 + w - 1 - x);
        const dy = Math.min(y - y0, y0 + h - 1 - y);
        if (dx < radius && dy < radius) {
          const ddx = radius - dx;
          const ddy = radius - dy;
          if (ddx * ddx + ddy * ddy > radius * radius) continue;
        }
        this.set(x, y, color);
      }
    }
  }

  toPng() {
    return encodePng(this.data, this.size, this.size);
  }
}

const BLUE = [11, 61, 145, 255];
const BLUE_DARK = [7, 42, 106, 255];
const BLUE_LIGHT = [30, 91, 196, 255];
const WHITE = [255, 255, 255, 255];
const GRID = [255, 255, 255, 150];
const ACCENT = [255, 193, 7, 255];

/**
 * Icona "foglio di calcolo": sfondo blu, tabella bianca 3x3 con la cella
 * in alto a sinistra evidenziata in giallo.
 * @param {number} size
 * @param {boolean} maskable se true il disegno e' rientrato (safe zone)
 */
function drawIcon(size, maskable = false) {
  const c = new Canvas(size);
  const s = size;

  // Sfondo
  if (maskable) {
    c.rect(0, 0, s, s, BLUE);
    c.roundedRect(0, 0, s, s * 0.5, s * 0.18, BLUE_LIGHT);
  } else {
    c.roundedRect(0, 0, s, s, s * 0.22, BLUE);
    // riflesso diagonale sullo sfondo
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const t = (x + y) / (2 * s);
        if (t < 0.45) c.set(x, y, BLUE_LIGHT);
      }
    }
    c.roundedRect(s * 0.02, s * 0.02, s * 0.96, s * 0.96, s * 0.2, BLUE);
  }

  // Tabella
  const pad = maskable ? s * 0.28 : s * 0.2;
  const tableX = pad;
  const tableY = pad + s * 0.04;
  const tableW = s - pad * 2;
  const tableH = s - pad * 2 - s * 0.08;
  const cols = 3;
  const rows = 3;
  const cellW = tableW / cols;
  const cellH = tableH / rows;
  const line = Math.max(1, Math.round(s * 0.018));

  // fondo tabella
  c.rect(tableX, tableY, tableW, tableH, [255, 255, 255, 235]);

  // celle alternate (effetto "foglio")
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      if ((r + col) % 2 === 0) {
        c.rect(
          tableX + col * cellW + line,
          tableY + r * cellH + line,
          cellW - line * 2,
          cellH - line * 2,
          [226, 234, 248, 255]
        );
      }
    }
  }

  // griglia
  for (let col = 1; col < cols; col++) {
    c.rect(tableX + col * cellW - line / 2, tableY, line, tableH, GRID);
  }
  for (let r = 1; r < rows; r++) {
    c.rect(tableX, tableY + r * cellH - line / 2, tableW, line, GRID);
  }

  // cella evidenziata con il "valore"
  c.rect(
    tableX + line,
    tableY + line,
    cellW - line * 2,
    cellH - line * 2,
    ACCENT
  );

  // bordo esterno
  c.rect(tableX, tableY, tableW, line, WHITE);
  c.rect(tableX, tableY + tableH - line, tableW, line, WHITE);
  c.rect(tableX, tableY, line, tableH, WHITE);
  c.rect(tableX + tableW - line, tableY, line, tableH, WHITE);

  return c;
}

/* ------------------------------------------------------------------ */

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['icon-maskable-192.png', 192, true],
];

for (const [name, size, maskable] of targets) {
  const png = drawIcon(size, maskable).toPng();
  writeFileSync(join(OUT_DIR, name), png);
  console.log(`scritto ${name} (${size}x${size}, ${png.length} byte)`);
}

// Favicon SVG (testuale, usata anche come icona "any" nel manifest).
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Mini-Foglio">
  <rect width="64" height="64" rx="14" fill="#0b3d91"/>
  <rect x="14" y="16" width="36" height="32" rx="3" fill="#ffffff" opacity="0.94"/>
  <path d="M26 16v32M38 16v32M14 26h36M14 37h36" stroke="#0b3d91" stroke-opacity="0.45" stroke-width="2"/>
  <rect x="15.5" y="17.5" width="9" height="7" fill="#ffc107"/>
</svg>
`;
writeFileSync(join(OUT_DIR, 'favicon.svg'), favicon, 'utf8');
console.log('scritto favicon.svg');
