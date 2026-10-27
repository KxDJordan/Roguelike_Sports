/**
 * Draws the game icon (a speeding football on a pitch-green tile) and writes it as PNGs into
 * public/icons. No dependencies: shapes are rasterised with 4x4 supersampling and encoded with
 * node's zlib. Usage: node scripts/make-icons.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const hex = (h, a = 1) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), a];
const INK = hex('#0b1016');

/** Inside a rounded rectangle [x0,y0]-[x1,y1] with corner radius r? */
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  const cx = Math.max(x0 + r, Math.min(x1 - r, x));
  const cy = Math.max(y0 + r, Math.min(y1 - r, y));
  return x >= x0 && x <= x1 && y >= y0 && y <= y1 && (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** Inside a regular pentagon centred at (cx, cy), circumradius r, first vertex at angle a0? */
function inPentagon(x, y, cx, cy, r, a0) {
  for (let i = 0; i < 5; i++) {
    const a1 = a0 + (i * 2 * Math.PI) / 5;
    const a2 = a0 + ((i + 1) * 2 * Math.PI) / 5;
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const x2 = cx + r * Math.cos(a2);
    const y2 = cy + r * Math.sin(a2);
    if ((x2 - x1) * (y - y1) - (y2 - y1) * (x - x1) < 0) return false;
  }
  return true;
}

/** Inside a capsule from (ax, ay) to (bx, by) with radius r? */
function inCapsule(x, y, ax, ay, bx, by, r) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 <= r * r;
}

/** Colour of the icon at (x, y) in 0..1 coordinates; `bleed` fills the whole square (maskable). */
function scene(x, y, bleed) {
  if (!bleed && !inRoundRect(x, y, 0, 0, 1, 1, 0.22)) return [0, 0, 0, 0];
  // Pitch-green tile with mown stripes, lighter at the top.
  const g = 1 - 0.35 * y;
  let col = [Math.round(30 * g), Math.round(170 * g + 20), Math.round(80 * g + 10), 1];
  if (Math.floor(y * 7) % 2 === 1) col = [col[0] * 0.9, col[1] * 0.9, col[2] * 0.9, 1];
  // Speed streaks behind the ball.
  const streaks = [
    [0.1, 0.38, 0.34, 0.38, 0.03],
    [0.05, 0.5, 0.33, 0.5, 0.035],
    [0.13, 0.62, 0.36, 0.62, 0.03],
  ];
  for (const [ax, ay, bx, by, r] of streaks) if (inCapsule(x, y, ax, ay, bx, by, r)) col = [245, 248, 252, 1];
  // The ball, with an ink outline.
  const bx = 0.6;
  const by = 0.5;
  const R = 0.27;
  const d = Math.hypot(x - bx, y - by);
  if (d <= R) {
    if (d > R - 0.018) return INK;
    // Centre pentagon, and five more around the edge (clipped by the ball).
    const up = -Math.PI / 2;
    if (inPentagon(x, y, bx, by, 0.095, up)) return INK;
    for (let i = 0; i < 5; i++) {
      const a = up + Math.PI / 5 + (i * 2 * Math.PI) / 5;
      if (inPentagon(x, y, bx + 0.245 * Math.cos(a), by + 0.245 * Math.sin(a), 0.085, a)) return INK;
    }
    // Seams from the centre pentagon's corners to the outer ones.
    for (let i = 0; i < 5; i++) {
      const a = up + (i * 2 * Math.PI) / 5;
      if (inCapsule(x, y, bx + 0.095 * Math.cos(a), by + 0.095 * Math.sin(a), bx + 0.19 * Math.cos(a), by + 0.19 * Math.sin(a), 0.008)) return INK;
    }
    // Soft shading toward the bottom right.
    const shade = 1 - 0.18 * Math.max(0, ((x - bx) + (y - by)) / R);
    return [245 * shade, 247 * shade, 250 * shade, 1];
  }
  return col;
}

function render(size, bleed = false) {
  const px = Buffer.alloc(size * size * 4);
  const S = 4;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const [cr, cg, cb, ca] = scene((i + (sx + 0.5) / S) / size, (j + (sy + 0.5) / S) / size, bleed);
          r += cr * ca;
          g += cg * ca;
          b += cb * ca;
          a += ca;
        }
      }
      const o = (j * size + i) * 4;
      px[o] = a ? Math.round(r / a) : 0;
      px[o + 1] = a ? Math.round(g / a) : 0;
      px[o + 2] = a ? Math.round(b / a) : 0;
      px[o + 3] = Math.round((a / (S * S)) * 255);
    }
  }
  return encodePng(size, px);
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync('public/icons', { recursive: true });
const out = [
  ['icon-512.png', 512, false],
  ['icon-192.png', 192, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true],
  ['favicon-32.png', 32, false],
];
for (const [name, size, bleed] of out) {
  writeFileSync(`public/icons/${name}`, render(size, bleed));
  console.log('wrote', `public/icons/${name}`);
}
