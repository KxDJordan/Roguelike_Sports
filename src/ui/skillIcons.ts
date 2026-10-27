import { h } from './dom';
import { SKILLS, SkillId } from '../data/skills';

/**
 * Artwork for skills, from src/img/icon. The source images are black glyphs of assorted sizes,
 * so each is turned into a white glyph on transparency, cropped to the drawing and centred in a
 * square; every icon then sits the same way in any badge. Skills without artwork use their emoji.
 */

const FILES = import.meta.glob('../img/icon/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/** Artwork whose file name isn't the skill id. */
const ALIASES: Record<string, SkillId> = { last_ditch_block: 'last_ditch', quick_reflexes: 'cat_reflexes' };

/** Side of the processed square icon, in pixels. */
const SIZE = 96;

const masks = new Map<SkillId, HTMLCanvasElement>();
const urls = new Map<SkillId, string>();
const tinted = new Map<string, HTMLCanvasElement>();

function idFor(path: string): SkillId | null {
  const base = path.split('/').pop()!.replace(/\.png$/i, '').toLowerCase().replace(/[\s-]+/g, '_');
  const id = ALIASES[base] ?? base;
  return id in SKILLS ? (id as SkillId) : null;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Dark ink becomes an opaque white glyph; light or transparent background becomes clear. */
function toGlyph(img: HTMLImageElement): HTMLCanvasElement {
  const w = img.naturalWidth;
  const hgt = img.naturalHeight;
  const src = document.createElement('canvas');
  src.width = w;
  src.height = hgt;
  const sctx = src.getContext('2d', { willReadFrequently: true })!;
  sctx.drawImage(img, 0, 0);
  const data = sctx.getImageData(0, 0, w, hgt);
  const px = data.data;
  let x0 = w;
  let y0 = hgt;
  let x1 = -1;
  let y1 = -1;
  for (let i = 0; i < px.length; i += 4) {
    const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    let a = Math.min(px[i + 3], 255 - lum);
    a = a < 24 ? 0 : Math.min(255, a * 1.15);
    px[i] = px[i + 1] = px[i + 2] = 255;
    px[i + 3] = a;
    if (a > 60) {
      const p = i / 4;
      const x = p % w;
      const y = (p - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  sctx.putImageData(data, 0, 0);
  if (x1 < 0) [x0, y0, x1, y1] = [0, 0, w - 1, hgt - 1];
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const out = document.createElement('canvas');
  out.width = out.height = SIZE;
  const k = (SIZE * 0.86) / Math.max(bw, bh);
  out.getContext('2d')!.drawImage(src, x0, y0, bw, bh, (SIZE - bw * k) / 2, (SIZE - bh * k) / 2, bw * k, bh * k);
  return out;
}

let loading: Promise<void> | null = null;

/** Load and prepare all skill artwork. Safe to call more than once; never rejects. */
export function loadSkillIcons(): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  loading ??= Promise.all(
    Object.entries(FILES).map(async ([path, url]) => {
      const id = idFor(path);
      if (!id) return;
      try {
        const glyph = toGlyph(await loadImage(url));
        masks.set(id, glyph);
        urls.set(id, glyph.toDataURL());
      } catch {
        // Missing or broken artwork: the emoji stands in.
      }
    }),
  ).then(() => undefined);
  return loading;
}

/** The skill's glyph drawn in `color`, for the canvas. Null when the skill has no artwork. */
export function skillGlyph(id: SkillId, color = '#fff'): HTMLCanvasElement | null {
  const mask = masks.get(id);
  if (!mask) return null;
  const key = `${id}|${color}`;
  let c = tinted.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(mask, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, SIZE, SIZE);
    tinted.set(key, c);
  }
  return c;
}

/** A skill's icon for the DOM: the artwork if there is some, otherwise its emoji. */
export function skillIcon(id: SkillId): HTMLElement {
  const url = urls.get(id);
  const s = SKILLS[id];
  return url ? h('img', { class: 'skill-img', src: url, alt: s.name, draggable: 'false' }) : h('span', { class: 'skill-emoji' }, s.icon);
}
