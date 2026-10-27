import { h } from './dom';
import { Player, Rarity, avgForm, faceStats, overall } from '../data/player';
import { SKILLS, SKILL_SLOTS } from '../data/skills';
import { skillIcon } from './skillIcons';

export interface CardOptions {
  size?: 'sm' | 'md' | 'lg';
  badge?: string;
  onClick?: () => void;
  /** Hide fitness/level, e.g. for pack reveals. */
  bare?: boolean;
}

/** Collectible player card, styled by rarity (bronze / silver / gold / elite). */
export function playerCard(p: Player, opts: CardOptions = {}): HTMLElement {
  const ovr = overall(p);
  const form = avgForm(p);
  const lastName = p.name.split(' ').slice(-1)[0];
  return h(
    'div',
    {
      class: `pcard ${p.rarity} ${opts.size ?? 'md'} ${opts.onClick ? 'tappable' : ''}`,
      onclick: opts.onClick,
    },
    h('div', { class: 'pc-shine' }),
    h(
      'div',
      { class: 'pc-top' },
      h('div', { class: 'pc-ovr' }, h('b', {}, ovr), h('span', {}, p.positions[0])),
      opts.badge ? h('div', { class: 'pc-badge' }, opts.badge) : null,
    ),
    h('div', { class: 'pc-avatar' }, h('span', {}, p.number)),
    h('div', { class: 'pc-name' }, lastName),
    p.skills.length ? h('div', { class: 'pc-skills' }, ...p.skills.map((id) => h('i', { title: SKILLS[id].name }, skillIcon(id)))) : null,
    h(
      'div',
      { class: 'pc-stats' },
      ...faceStats(p).map(([k, v]) => h('div', {}, h('b', {}, v), h('span', {}, k))),
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

export const fitColor =(c: number) => (c > 0.75 ? '#4ade80' : c > 0.5 ? '#facc15' : '#f87171');
export const formClass = (r: number) => (r >= 7.5 ? 'great' : r >= 6.8 ? 'good' : r >= 6.2 ? 'ok' : 'poor');
