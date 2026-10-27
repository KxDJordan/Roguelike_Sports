import { h } from './dom';
import { Player, Rarity, avgForm, faceStats, overall } from '../data/player';
import { SKILLS, SKILL_SLOTS } from '../data/skills';
import { skillIcon } from './skillIcons';
import { BallDef, CosmeticDef, CosmeticKind, CrestDef, KIND_NAME, KITS, KitDef, KitLook, ballById, crestById } from '../data/cosmetics';
import { ballSvg, crestSvg, kitSvg, portraitSvg } from './art';

export interface CardOptions {
  size?: 'sm' | 'md' | 'lg';
  badge?: string;
  onClick?: () => void;
  /** Hide fitness/level, e.g. for pack reveals. */
  bare?: boolean;
}

/** The club's kit, worn by every player portrait (set whenever the club's look changes). */
let cardKit: KitLook = KITS[0];
let cardCrest = crestById('shield_star') as CrestDef;
export function setCardLook(kit: KitLook, crest: { shape: CrestDef['shape']; emblem: CrestDef['emblem'] }): void {
  cardKit = kit;
  cardCrest = { ...cardCrest, ...crest };
}

/** Shared card frame: metal body, texture, foil sheen and inner trim, sized from the card width. */
function frame(rarity: Rarity, size: string, onClick: (() => void) | undefined, extra: string, ...content: (HTMLElement | SVGElement | null)[]): HTMLElement {
  return h(
    'div',
    { class: `pcard ${rarity} ${size} ${onClick ? 'tappable' : ''} ${extra}`, onclick: onClick },
    h('div', { class: 'pc-body' }, h('div', { class: 'pc-tex' }), h('div', { class: 'pc-trim' }), ...(content as HTMLElement[]), h('div', { class: 'pc-holo' }), h('div', { class: 'pc-shine' })),
  );
}

/** Collectible player card, styled by rarity (bronze / silver / gold / elite). */
export function playerCard(p: Player, opts: CardOptions = {}): HTMLElement {
  const ovr = overall(p);
  const form = avgForm(p);
  const lastName = p.name.split(' ').slice(-1)[0];
  const stats = faceStats(p);
  const card = frame(
    p.rarity,
    opts.size ?? 'md',
    opts.onClick,
    '',
    h('div', { class: 'pc-glow' }),
    h('div', { class: 'pc-portrait' }, portraitSvg(p.id, cardKit, p.number)),
    h(
      'div',
      { class: 'pc-meta' },
      h('b', { class: 'pc-ovr' }, ovr),
      h('span', { class: 'pc-pos' }, p.positions[0]),
      h('span', { class: 'pc-club' }, crestSvg(cardCrest, cardKit)),
    ),
    p.skills.length ? h('div', { class: 'pc-skills' }, ...p.skills.map((id) => h('i', { title: SKILLS[id].name }, skillIcon(id)))) : null,
    opts.badge ? h('div', { class: 'pc-badge' }, opts.badge) : null,
    h('div', { class: 'pc-plate' }, h('span', { class: 'pc-name' }, lastName)),
    h(
      'div',
      { class: 'pc-stats' },
      h('div', {}, ...stats.slice(0, 3).map(([k, v]) => h('p', {}, h('b', {}, v), h('span', {}, k)))),
      h('i', { class: 'pc-div' }),
      h('div', {}, ...stats.slice(3).map(([k, v]) => h('p', {}, h('b', {}, v), h('span', {}, k)))),
    ),
    opts.bare
      ? null
      : h(
          'div',
          { class: 'pc-foot' },
          h('span', { class: 'pc-lvl' }, `Lv ${p.level}`, p.skillPoints ? h('i', { class: 'pc-sp' }, `+${p.skillPoints}`) : null),
          form !== null ? h('span', { class: `pc-form ${formClass(form)}` }, form.toFixed(1)) : h('span', { class: 'pc-form' }, '–'),
          h('span', { class: 'pc-fit' }, h('i', { style: { width: `${Math.round(p.condition * 100)}%`, background: fitColor(p.condition) } })),
        ),
  );
  return card;
}

/** A kit, ball or crest card: same frame as player cards, with the item's artwork. */
export function cosmeticCard(kind: CosmeticKind, def: CosmeticDef, opts: { size?: 'sm' | 'md' | 'lg'; onClick?: () => void; badge?: string; equipped?: boolean } = {}): HTMLElement {
  const art =
    kind === 'kit'
      ? kitSvg(def as KitDef)
      : kind === 'ball'
        ? ballSvg(ballById(def.id) as BallDef)
        : crestSvg(def as CrestDef, cardKit);
  return frame(
    def.rarity,
    opts.size ?? 'md',
    opts.onClick,
    `cosmetic ${opts.equipped ? 'equipped' : ''}`,
    h('div', { class: 'pc-glow' }),
    h('div', { class: 'pc-meta' }, h('span', { class: 'pc-kind' }, KIND_NAME[kind].toUpperCase())),
    opts.badge || opts.equipped ? h('div', { class: 'pc-badge' }, opts.equipped ? '✓' : opts.badge!) : null,
    h('div', { class: `pc-art ${kind}` }, art),
    h('div', { class: 'pc-plate' }, h('span', { class: 'pc-name' }, def.name)),
    h('div', { class: 'pc-rarity' }, def.rarity.toUpperCase()),
  );
}

const NEXT_RARITY: Partial<Record<Rarity, [string, number]>> = { bronze: ['Silver', 60], silver: ['Gold', 70], gold: ['Elite', 80] };

/** A player's skills with what they do, plus locked slots that open up at higher rarities. */
export function skillList(p: Player): HTMLElement {
  const locked = SKILL_SLOTS.elite - p.skills.length;
  const next = NEXT_RARITY[p.rarity];
  return h(
    'div',
    { class: 'skill-list' },
    h('div', { class: 'sub-title' }, 'Skills'),
    ...p.skills.map((id) => {
      const s = SKILLS[id];
      return h('div', { class: 'skill-row' }, h('span', { class: 'skill-ico' }, skillIcon(id)), h('div', {}, h('b', {}, s.name), h('small', {}, s.desc)));
    }),
    ...Array.from({ length: locked }, (_, i) =>
      h(
        'div',
        { class: 'skill-row locked' },
        h('span', { class: 'skill-ico' }, '🔒'),
        h('div', {}, h('b', {}, 'Locked'), h('small', {}, i === 0 && next ? `Reaches ${next[0]} at ${next[1]} overall: a new skill unlocks.` : 'Unlocks at a higher rarity.')),
      ),
    ),
  );
}

export const fitColor = (c: number) => (c > 0.75 ? '#4ade80' : c > 0.5 ? '#facc15' : '#f87171');
export const formClass = (r: number) => (r >= 7.5 ? 'great' : r >= 6.8 ? 'good' : r >= 6.2 ? 'ok' : 'poor');
