// -----------------------------------------------------------------------------
// Generates cover.png (800×534, the store size): a dark-to-teal gradient, a
// processor chip with its pins, a temperature gauge around it and a load
// curve below. Plain Node (zlib), no dependency. Run: npm run cover
// -----------------------------------------------------------------------------

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const WIDTH = 800;
const HEIGHT = 534;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.min(1, Math.max(0, t))));
const smooth = (edge, distance) => Math.min(1, Math.max(0, edge - distance + 0.5));

const DARK = [12, 16, 28];
const TEAL = [14, 92, 104];
const CHIP = [36, 44, 60];
const CHIP_EDGE = [150, 170, 190];
const PIN = [196, 176, 120];
const COOL = [60, 200, 160];
const WARM = [250, 190, 60];
const HOT = [240, 80, 70];
const TRACK = [40, 60, 76];

const CX = 400;
const CY = 230;

/** Distance from a point to a rounded rectangle (negative inside). */
function roundedBox(x, y, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(x - cx) - halfW + radius;
  const qy = Math.abs(y - cy) - halfH + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

/** The gauge color along its arc (t from 0 to 1): cool, warm, hot. */
const gauge = (t) => (t < 0.5 ? mix(COOL, WARM, t * 2) : mix(WARM, HOT, (t - 0.5) * 2));

// The load curve: points [x, y] joined by segments.
const CURVE = Array.from({ length: 33 }, (_, i) => {
  const x = 140 + i * 16.25;
  const y = 470 - 38 * Math.abs(Math.sin(i * 0.55)) - 18 * Math.abs(Math.sin(i * 1.7 + 1));
  return [x, y];
});

function pixel(x, y) {
  let color = mix(DARK, TEAL, (x / WIDTH) * 0.4 + (y / HEIGHT) * 0.6);

  // The gauge: an arc of 270 degrees around the chip, filled to 70 %.
  const r = Math.hypot(x - CX, y - CY);
  let angle = Math.atan2(y - CY, x - CX) - Math.PI * 0.75; // start bottom-left
  if (angle < 0) angle += Math.PI * 2;
  const t = angle / (Math.PI * 1.5);
  if (t <= 1) {
    const ring = smooth(9, Math.abs(r - 165));
    color = mix(color, TRACK, ring);
    if (t <= 0.7) color = mix(color, gauge(t), ring);
  }

  // The chip: pins, then the body, then the die.
  for (let i = -3; i <= 3; i += 1) {
    const pinsH = Math.min(
      roundedBox(x, y, CX + i * 26, CY - 98, 6, 14, 3),
      roundedBox(x, y, CX + i * 26, CY + 98, 6, 14, 3),
    );
    const pinsV = Math.min(
      roundedBox(x, y, CX - 98, CY + i * 26, 14, 6, 3),
      roundedBox(x, y, CX + 98, CY + i * 26, 14, 6, 3),
    );
    color = mix(color, PIN, smooth(0, Math.min(pinsH, pinsV)));
  }
  const body = roundedBox(x, y, CX, CY, 92, 92, 12);
  color = mix(color, CHIP_EDGE, smooth(0, Math.abs(body) - 2));
  color = mix(color, CHIP, smooth(0, body + 2));
  const die = roundedBox(x, y, CX, CY, 46, 46, 8);
  color = mix(color, mix(CHIP, gauge(0.7), 0.55), smooth(0, die));
  // A thermometer in the die: bulb and stem.
  const bulb = Math.hypot(x - CX, y - (CY + 22)) - 13;
  const stem = roundedBox(x, y, CX, CY - 8, 6, 30, 6);
  color = mix(color, [245, 245, 250], smooth(0, Math.min(bulb, stem)));
  const mercury = Math.min(
    Math.hypot(x - CX, y - (CY + 22)) - 8,
    roundedBox(x, y, CX, CY + 2, 2.5, 22, 2.5),
  );
  color = mix(color, HOT, smooth(0, mercury));

  // The load curve.
  for (let i = 0; i < CURVE.length - 1; i += 1) {
    const [x0, y0] = CURVE[i];
    const [x1, y1] = CURVE[i + 1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const s = Math.min(1, Math.max(0, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy)));
    const d = Math.hypot(x - (x0 + s * dx), y - (y0 + s * dy));
    color = mix(color, COOL, smooth(2.5, d));
  }
  return color;
}

const raw = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
for (let y = 0; y < HEIGHT; y += 1) {
  const row = y * (WIDTH * 3 + 1);
  raw[row] = 0;
  for (let x = 0; x < WIDTH; x += 1) {
    const [r, g, b] = pixel(x, y);
    raw.set([r, g, b], row + 1 + x * 3);
  }
}

const header = Buffer.alloc(13);
header.writeUInt32BE(WIDTH, 0);
header.writeUInt32BE(HEIGHT, 4);
header[8] = 8; // bit depth
header[9] = 2; // RGB
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(new URL('../cover.png', import.meta.url), png);
console.log(`cover.png: ${WIDTH}×${HEIGHT}, ${png.length} bytes`);
