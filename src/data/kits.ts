/** Kit colour helpers: make sure the two teams (and their keepers) are easy to tell apart. */

const KIT_COLORS = ['#e63946', '#3a86ff', '#ffbe0b', '#06d6a0', '#8338ec', '#f1f1f1', '#111827', '#f97316', '#ec4899', '#0ea5e9'];
const KEEPER_COLORS = ['#111111', '#facc15', '#a3e635', '#c084fc', '#f472b6', '#22d3ee'];

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Perceptual-ish colour distance ("redmean"), 0..~765. */
export function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const rm = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

const MIN_DISTANCE = 200;

function farthest(options: string[], from: string[]): string {
  let best = options[0];
  let bestD = -1;
  for (const c of options) {
    const d = Math.min(...from.map((f) => colorDistance(c, f)));
    if (d > bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** The away kit: its own colour if it contrasts with the home kit, otherwise the most different alternative. */
export function contrastingKit(home: string, preferred: string): string {
  return colorDistance(home, preferred) >= MIN_DISTANCE ? preferred : farthest(KIT_COLORS, [home]);
}

/** A goalkeeper kit that stands out from both outfield kits (and the other keeper). */
export function keeperKits(home: string, away: string): [string, string] {
  const gk0 = farthest(KEEPER_COLORS, [home, away]);
  const gk1 = farthest(KEEPER_COLORS.filter((c) => c !== gk0), [home, away, gk0]);
  return [gk0, gk1];
}

/** Readable text colour on top of a kit colour. */
export function inkFor(color: string): string {
  const [r, g, b] = rgb(color);
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#111' : '#fff';
}
