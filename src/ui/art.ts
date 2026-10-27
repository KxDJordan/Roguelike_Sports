import type { BallDef, CrestLook, Emblem, KitLook } from '../data/cosmetics';
import { seededRand } from '../data/skills';

/**
 * Vector art built as SVG markup: kits (shirts), match balls, club crests and player portraits.
 * Everything scales cleanly from a table chip to a large card.
 */

let uid = 0;
const nextId = (p: string) => `${p}${++uid}`;

/** Parse SVG markup into an element. */
export function svg(markup: string, cls = ''): SVGSVGElement {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  const el = t.content.firstElementChild as SVGSVGElement;
  if (cls) el.setAttribute('class', cls);
  return el;
}

/** Lighten (amt > 0) or darken (amt < 0) a #rrggbb colour. */
export function tone(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const f = (v: number) => Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/** Pattern shapes in the secondary colour, laid over the shirt area (clip them to the shirt). */
function patternShapes(kit: KitLook): string {
  const c = kit.secondary;
  switch (kit.pattern) {
    case 'stripes':
      return [14, 30, 46, 62, 78].map((x) => `<rect x="${x}" y="0" width="8" height="100" fill="${c}"/>`).join('');
    case 'pinstripes':
      return Array.from({ length: 14 }, (_, i) => `<rect x="${6 + i * 7}" y="0" width="1.4" height="100" fill="${c}" opacity="0.85"/>`).join('');
    case 'hoops':
      return [22, 40, 58, 76, 94].map((y) => `<rect x="0" y="${y}" width="100" height="9" fill="${c}"/>`).join('');
    case 'halves':
      return `<rect x="50" y="0" width="50" height="100" fill="${c}"/>`;
    case 'quarters':
      return `<rect x="50" y="0" width="50" height="56" fill="${c}"/><rect x="0" y="56" width="50" height="44" fill="${c}"/>`;
    case 'sash':
      return `<line x1="22" y1="8" x2="84" y2="104" stroke="${c}" stroke-width="15"/>`;
    case 'chevron':
      return `<polyline points="14,34 50,62 86,34" fill="none" stroke="${c}" stroke-width="10" stroke-linejoin="miter"/>`;
    default:
      return '';
  }
}

const SHIRT = 'M30 12 L41 8 Q50 15 59 8 L70 12 L91 27 L82 43 L72 37 L72 92 Q50 97 28 92 L28 37 L18 43 L9 27 Z';

/** A football shirt in the kit's colours and pattern. */
export function kitSvg(kit: KitLook, cls = 'art-kit'): SVGSVGElement {
  const clip = nextId('kc');
  const shade = nextId('ks');
  return svg(
    `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id="${clip}"><path d="${SHIRT}"/></clipPath>
        <linearGradient id="${shade}" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="#fff" stop-opacity="0.28"/>
          <stop offset="0.5" stop-color="#fff" stop-opacity="0"/>
          <stop offset="1" stop-color="#000" stop-opacity="0.32"/>
        </linearGradient>
      </defs>
      <path d="${SHIRT}" fill="${kit.primary}"/>
      <g clip-path="url(#${clip})">
        ${patternShapes(kit)}
        <path d="M28 37 Q36 60 30 92" stroke="#000" stroke-opacity="0.12" stroke-width="2" fill="none"/>
        <path d="M72 37 Q64 60 70 92" stroke="#000" stroke-opacity="0.12" stroke-width="2" fill="none"/>
        <rect width="100" height="100" fill="url(#${shade})"/>
      </g>
      <path d="M41 8 Q50 21 59 8" fill="none" stroke="${kit.secondary}" stroke-width="4" stroke-linecap="round"/>
      <path d="M9 27 L18 43 M91 27 L82 43" stroke="${kit.secondary}" stroke-width="4.5"/>
      <path d="${SHIRT}" fill="none" stroke="#000" stroke-opacity="0.45" stroke-width="1.6" stroke-linejoin="round"/>
    </svg>`,
    cls,
  );
}

/** A match ball: shaded sphere with pentagon panels and seams; the flashy ones glow. */
export function ballSvg(ball: BallDef, cls = 'art-ball'): SVGSVGElement {
  const grad = nextId('bg');
  const clip = nextId('bc');
  const pent = (cx: number, cy: number, r: number, a0: number) =>
    Array.from({ length: 5 }, (_, i) => {
      const a = a0 + (i * 2 * Math.PI) / 5;
      return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
    }).join(' ');
  const up = -Math.PI / 2;
  const outer = Array.from({ length: 5 }, (_, i) => {
    const a = up + Math.PI / 5 + (i * 2 * Math.PI) / 5;
    return `<polygon points="${pent(50 + 40 * Math.cos(a), 50 + 40 * Math.sin(a), 14, a)}" fill="${ball.panel}"/>`;
  }).join('');
  const seams = Array.from({ length: 5 }, (_, i) => {
    const a = up + (i * 2 * Math.PI) / 5;
    return `<line x1="${50 + 15.5 * Math.cos(a)}" y1="${50 + 15.5 * Math.sin(a)}" x2="${50 + 31 * Math.cos(a)}" y2="${50 + 31 * Math.sin(a)}" stroke="${ball.panel}" stroke-width="2" stroke-opacity="0.7"/>`;
  }).join('');
  const el = svg(
    `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="${grad}" cx="0.36" cy="0.32" r="0.75">
          <stop offset="0" stop-color="${tone(ball.base, 0.5)}"/>
          <stop offset="0.6" stop-color="${ball.base}"/>
          <stop offset="1" stop-color="${tone(ball.base, -0.4)}"/>
        </radialGradient>
        <clipPath id="${clip}"><circle cx="50" cy="50" r="44"/></clipPath>
      </defs>
      <circle cx="50" cy="50" r="44" fill="url(#${grad})"/>
      <g clip-path="url(#${clip})">
        <polygon points="${pent(50, 50, 15.5, up)}" fill="${ball.panel}"/>
        ${outer}${seams}
        <circle cx="50" cy="50" r="44" fill="url(#${grad})" opacity="0.25"/>
      </g>
      <ellipse cx="36" cy="30" rx="13" ry="8" fill="#fff" opacity="0.35" transform="rotate(-30 36 30)"/>
      <circle cx="50" cy="50" r="44" fill="none" stroke="#000" stroke-opacity="0.5" stroke-width="2"/>
    </svg>`,
    cls,
  );
  if (ball.glow) el.style.filter = `drop-shadow(0 0 6px ${ball.glow})`;
  return el;
}

const CREST_SHAPES: Record<CrestLook['shape'], string> = {
  shield: 'M50 4 L92 16 L92 56 Q92 88 50 106 Q8 88 8 56 L8 16 Z',
  heater: 'M10 8 H90 V48 Q90 88 50 106 Q10 88 10 48 Z',
  round: 'M50 9 A46 46 0 1 1 49.99 9 Z',
  diamond: 'M50 4 L96 55 L50 106 L4 55 Z',
  hex: 'M50 4 L92 28 L92 82 L50 106 L8 82 L8 28 Z',
};

/** Emblem artwork, centred on (50, 56) inside the crest. */
function emblem(e: Emblem, fg: string, bg: string): string {
  switch (e) {
    case 'star': {
      const pts = Array.from({ length: 10 }, (_, i) => {
        const r = i % 2 === 0 ? 24 : 10;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        return `${(50 + r * Math.cos(a)).toFixed(1)},${(56 + r * Math.sin(a)).toFixed(1)}`;
      }).join(' ');
      return `<polygon points="${pts}" fill="${fg}"/>`;
    }
    case 'bolt':
      return `<polygon points="56,30 36,60 49,60 42,84 66,50 53,50 60,30" fill="${fg}"/>`;
    case 'crown':
      return `<path d="M30 70 L30 46 L40 56 L50 38 L60 56 L70 46 L70 70 Z" fill="${fg}"/><rect x="30" y="72" width="40" height="6" rx="2" fill="${fg}"/><circle cx="30" cy="44" r="3.5" fill="${fg}"/><circle cx="50" cy="35" r="3.5" fill="${fg}"/><circle cx="70" cy="44" r="3.5" fill="${fg}"/>`;
    case 'ball':
      return `<circle cx="50" cy="56" r="20" fill="${fg}"/><polygon points="50,47 58.6,53.2 55.3,63.3 44.7,63.3 41.4,53.2" fill="${bg}"/>`;
    case 'flame':
      return `<path d="M50 30 C62 44 70 52 66 66 C63 78 54 82 50 82 C42 82 34 76 34 66 C34 56 42 52 44 44 C47 52 50 54 52 54 C54 46 52 38 50 30 Z" fill="${fg}"/><path d="M50 60 C56 66 58 70 55 76 C53 79 47 79 45 76 C43 72 46 66 50 60 Z" fill="${bg}"/>`;
    case 'chevrons':
      return `<polyline points="32,44 50,58 68,44" fill="none" stroke="${fg}" stroke-width="7"/><polyline points="32,60 50,74 68,60" fill="none" stroke="${fg}" stroke-width="7"/>`;
    case 'tower':
      return `<path d="M36 36 h6 v5 h5 v-5 h6 v5 h5 v-5 h6 V48 H36 Z" fill="${fg}"/><rect x="39" y="48" width="22" height="30" fill="${fg}"/><path d="M46 78 V67 a4 4 0 0 1 8 0 V78 Z" fill="${bg}"/>`;
    case 'wings':
      return `<path d="M48 50 C40 40 26 38 18 42 C26 44 30 48 32 52 C26 52 22 54 20 58 C28 56 34 58 38 62 C34 64 32 68 32 72 C40 66 46 62 48 56 Z" fill="${fg}"/><path d="M52 50 C60 40 74 38 82 42 C74 44 70 48 68 52 C74 52 78 54 80 58 C72 56 66 58 62 62 C66 64 68 68 68 72 C60 66 54 62 52 56 Z" fill="${fg}"/><circle cx="50" cy="52" r="5" fill="${fg}"/>`;
    case 'anchor':
      return `<circle cx="50" cy="36" r="5.5" fill="none" stroke="${fg}" stroke-width="4"/><rect x="47.5" y="41" width="5" height="38" fill="${fg}"/><rect x="38" y="49" width="24" height="4.5" rx="2" fill="${fg}"/><path d="M30 64 Q34 80 50 80 Q66 80 70 64" fill="none" stroke="${fg}" stroke-width="5" stroke-linecap="round"/>`;
    case 'trident':
      return `<rect x="47.5" y="44" width="5" height="40" fill="${fg}"/><path d="M34 38 Q34 54 50 54 Q66 54 66 38" fill="none" stroke="${fg}" stroke-width="5"/><polygon points="50,28 45,40 55,40" fill="${fg}"/><polygon points="34,32 30,42 38,42" fill="${fg}"/><polygon points="66,32 62,42 70,42" fill="${fg}"/>`;
  }
}

/** The club crest: its shape in the kit's main colour, trimmed and emblazoned in the second. */
export function crestSvg(crest: CrestLook, kit: KitLook, label = '', cls = 'art-crest'): SVGSVGElement {
  const grad = nextId('cg');
  const shape = CREST_SHAPES[crest.shape];
  const fg = kit.secondary;
  const text = label
    ? `<text x="50" y="${crest.shape === 'diamond' ? 84 : 87}" text-anchor="middle" font-family="Barlow Condensed, sans-serif" font-weight="900" font-size="12" fill="${fg}" letter-spacing="1">${label}</text>`
    : '';
  return svg(
    `<svg viewBox="0 0 100 110" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="${grad}" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stop-color="${tone(kit.primary, 0.3)}"/>
          <stop offset="0.55" stop-color="${kit.primary}"/>
          <stop offset="1" stop-color="${tone(kit.primary, -0.35)}"/>
        </linearGradient>
      </defs>
      <path d="${shape}" fill="url(#${grad})" stroke="#000" stroke-opacity="0.45" stroke-width="2"/>
      <path d="${shape}" fill="none" stroke="${fg}" stroke-width="4" transform="translate(50 55) scale(0.84) translate(-50 -55)"/>
      <g transform="translate(50 ${label ? 47 : 55}) scale(${label ? 0.68 : 0.95}) translate(-50 -56)">${emblem(crest.emblem, fg, kit.primary)}</g>
      ${text}
      <path d="M20 22 Q50 8 80 22" fill="none" stroke="#fff" stroke-opacity="0.25" stroke-width="3" stroke-linecap="round"/>
    </svg>`,
    cls,
  );
}

const SKIN = ['#f8d6b8', '#eebc94', '#d49a6a', '#b07246', '#8a5432', '#5e3920'];
const HAIR = ['#1b1410', '#2f1d12', '#5a3a22', '#a06a3a', '#d9b26a', '#b5502a', '#8e8e8e'];
const STYLES = ['buzz', 'short', 'quiff', 'curly', 'long', 'bald', 'mohawk', 'afro', 'side'] as const;

/** A stylised player bust in the club kit, his look seeded from his id so it never changes. */
export function portraitSvg(seed: string, kit: KitLook, number: number, cls = 'art-portrait'): SVGSVGElement {
  const rand = seededRand(seed);
  const skin = SKIN[Math.floor(rand() * SKIN.length)];
  const darkSkin = SKIN.indexOf(skin) >= 3;
  let hair = HAIR[Math.floor(rand() * HAIR.length)];
  if (darkSkin && rand() < 0.75) hair = HAIR[Math.floor(rand() * 2)];
  const style = STYLES[Math.floor(rand() * STYLES.length)];
  const beard = rand() < 0.3;
  const stubble = !beard && rand() < 0.3;
  const clip = nextId('pc');
  const face = nextId('pf');
  const hairShape: Record<(typeof STYLES)[number], string> = {
    buzz: `<path d="M35 34 Q36 18 50 17 Q64 18 65 34 Q60 26 50 25 Q40 26 35 34 Z" fill="${hair}" opacity="0.85"/>`,
    short: `<path d="M34 36 Q33 15 50 14 Q67 15 66 36 Q62 24 50 23 Q40 24 37 30 Q35 32 34 36 Z" fill="${hair}"/>`,
    quiff: `<path d="M34 36 Q32 16 46 12 Q58 8 66 18 Q68 26 66 36 Q63 25 52 24 Q42 25 34 36 Z" fill="${hair}"/><path d="M44 14 Q54 4 64 14 Q56 12 48 18 Z" fill="${hair}"/>`,
    curly: Array.from({ length: 9 }, (_, i) => `<circle cx="${36 + (i % 5) * 7}" cy="${i < 5 ? 22 : 17}" r="6.5" fill="${hair}"/>`).join('') + `<path d="M34 34 Q35 22 50 21 Q65 22 66 34 Q60 27 50 26 Q40 27 34 34 Z" fill="${hair}"/>`,
    long: `<path d="M33 52 Q28 14 50 13 Q72 14 67 52 Q66 34 62 28 Q50 24 38 28 Q34 34 33 52 Z" fill="${hair}"/>`,
    bald: `<path d="M38 22 Q50 16 62 22" fill="none" stroke="#fff" stroke-opacity="0.35" stroke-width="2"/>`,
    mohawk: `<path d="M45 30 Q44 10 50 6 Q56 10 55 30 Z" fill="${hair}"/><path d="M35 34 Q36 22 44 20 L44 28 Q38 30 35 34 Z M65 34 Q64 22 56 20 L56 28 Q62 30 65 34 Z" fill="${hair}" opacity="0.5"/>`,
    afro: `<ellipse cx="50" cy="24" rx="22" ry="17" fill="${hair}"/>`,
    side: `<path d="M34 36 Q32 15 52 13 Q68 15 66 34 Q60 22 44 24 Q38 28 34 36 Z" fill="${hair}"/><path d="M40 22 Q52 14 66 24" fill="none" stroke="#000" stroke-opacity="0.2" stroke-width="1.2"/>`,
  };
  const facial = beard
    ? `<path d="M37 44 Q38 62 50 64 Q62 62 63 44 Q60 54 50 55 Q40 54 37 44 Z" fill="${hair}" opacity="0.9"/>`
    : stubble
      ? `<path d="M38 46 Q40 61 50 62 Q60 61 62 46 Q58 56 50 57 Q42 56 38 46 Z" fill="${hair}" opacity="0.3"/>`
      : '';
  return svg(
    `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id="${clip}"><path d="M6 100 Q10 72 34 66 L42 61 Q50 67 58 61 L66 66 Q90 72 94 100 Z"/></clipPath>
        <radialGradient id="${face}" cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" stop-color="${tone(skin.slice(0, 7), 0.18)}"/>
          <stop offset="0.7" stop-color="${skin}"/>
          <stop offset="1" stop-color="${tone(skin, -0.25)}"/>
        </radialGradient>
      </defs>
      <path d="M43 50 L57 50 L58 64 Q50 70 42 64 Z" fill="${tone(skin, -0.22)}"/>
      <path d="M6 100 Q10 72 34 66 L42 61 Q50 67 58 61 L66 66 Q90 72 94 100 Z" fill="${kit.primary}"/>
      <g clip-path="url(#${clip})">
        ${patternShapes(kit)}
        <rect x="0" y="60" width="100" height="40" fill="#000" opacity="0.08"/>
        <path d="M60 60 Q86 70 94 100 L100 100 L100 60 Z" fill="#000" opacity="0.18"/>
      </g>
      <path d="M42 61 Q50 72 58 61" fill="none" stroke="${kit.secondary}" stroke-width="3.5" stroke-linecap="round"/>
      <text x="74" y="88" text-anchor="middle" font-family="Barlow Condensed, sans-serif" font-weight="900" font-size="12" fill="${kit.secondary}" opacity="0.9">${number}</text>
      <ellipse cx="34.5" cy="41" rx="3.2" ry="5" fill="${tone(skin, -0.12)}"/>
      <ellipse cx="65.5" cy="41" rx="3.2" ry="5" fill="${tone(skin, -0.12)}"/>
      <ellipse cx="50" cy="38" rx="15.5" ry="19" fill="url(#${face})"/>
      ${facial}
      <path d="M41 36.5 Q44 35 47 36.5 M53 36.5 Q56 35 59 36.5" stroke="${tone(hair, -0.2)}" stroke-width="1.8" stroke-linecap="round" fill="none"/>
      <ellipse cx="44" cy="40.5" rx="1.7" ry="1.9" fill="#1a1a1a"/>
      <ellipse cx="56" cy="40.5" rx="1.7" ry="1.9" fill="#1a1a1a"/>
      <path d="M50 42 Q48.5 47 50.5 48" stroke="${tone(skin, -0.3)}" stroke-width="1.3" fill="none" stroke-linecap="round"/>
      <path d="M46 52 Q50 54 54 52" stroke="${tone(skin, -0.4)}" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      ${hairShape[style]}
      <ellipse cx="44" cy="28" rx="6" ry="3" fill="#fff" opacity="0.12"/>
    </svg>`,
    cls,
  );
}
