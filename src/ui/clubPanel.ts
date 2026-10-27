import { h, toast } from './dom';
import { Club, NAME_MAX, equip, renameClub } from '../game/club';
import { COSMETICS, CosmeticDef, CosmeticKind, ballById, kitById, crestById } from '../data/cosmetics';
import { ballSvg, crestSvg, kitSvg } from './art';
import { cosmeticCard, setCardLook } from './playerCard';
import { rarityRank } from '../game/packs';

const SECTIONS: { kind: CosmeticKind; title: string; blurb: string }[] = [
  { kind: 'kit', title: 'Kits', blurb: 'Your shirt: sets the team colours on the pitch, the crest and every card.' },
  { kind: 'crest', title: 'Crests', blurb: 'Your club logo, coloured by the kit you wear.' },
  { kind: 'ball', title: 'Match balls', blurb: 'The ball used in your matches.' },
];

/**
 * The club's identity: name and short code, plus the kits, crests and balls collected from
 * packs. Tap an owned item to wear it; the rest show as locked slots to chase in packs.
 */
export function clubPanel(club: Club, rerender: () => void): HTMLElement {
  const look = club.look!;
  const kit = kitById(look.kit);
  const crest = crestById(look.crest);

  const name = h('input', { class: 'text-input', value: club.team.name, maxlength: String(NAME_MAX), 'aria-label': 'Club name' });
  const short = h('input', { class: 'text-input short', value: club.team.short, maxlength: '3', 'aria-label': 'Short code' });
  short.addEventListener('input', () => (short.value = short.value.toUpperCase().replace(/[^A-Z0-9]/g, '')));
  const save = () => {
    const err = renameClub(club, name.value, short.value);
    if (err) return toast(err);
    toast('Club renamed ✓');
    rerender();
  };

  const showcase = h(
    'div',
    { class: 'club-showcase panel' },
    h('div', { class: 'cs-crest' }, crestSvg(crest, kit, club.team.short)),
    h(
      'div',
      { class: 'cs-info' },
      h('h2', {}, club.team.name),
      h('div', { class: 'cs-items' }, h('div', { class: 'cs-kit' }, kitSvg(kit)), h('div', { class: 'cs-ball' }, ballSvg(ballById(look.ball)))),
      h('small', { class: 'muted' }, `${kit.name} · ${crest.name} · ${ballById(look.ball).name}`),
    ),
  );

  const identity = h(
    'div',
    { class: 'club-identity panel' },
    h('div', { class: 'sub-title' }, 'Club name'),
    h('div', { class: 'id-row' }, name, short, h('button', { class: 'primary', onclick: save }, 'Save')),
    h('small', { class: 'muted' }, 'The 3-letter code shows on the scoreboard and league table.'),
  );
  for (const input of [name, short]) input.addEventListener('keydown', (e) => e.key === 'Enter' && save());

  const sections = SECTIONS.map(({ kind, title, blurb }) => {
    const all = (COSMETICS[kind] as readonly CosmeticDef[]).slice().sort((a, b) => rarityRank(a.rarity) - rarityRank(b.rarity));
    const owned = club.locker![kind];
    const cards = all.map((def) => {
      if (!owned.includes(def.id)) return h('div', { class: `locked-card ${def.rarity}`, title: `${def.rarity} ${kind}: find it in packs` }, h('span', {}, '?'), h('small', {}, def.rarity.toUpperCase()));
      return cosmeticCard(kind, def, {
        size: 'sm',
        equipped: look[kind] === def.id,
        onClick: () => {
          equip(club, kind, def.id);
          setCardLook(club.team.kit!, club.team.crest!);
          rerender();
        },
      });
    });
    return h(
      'section',
      { class: 'locker-section' },
      h('div', { class: 'locker-head' }, h('b', {}, title), h('span', { class: 'muted' }, `${owned.length}/${all.length} collected`)),
      h('small', { class: 'muted' }, blurb),
      h('div', { class: 'locker-grid' }, ...cards),
    );
  });

  return h('div', { class: 'club-panel fade-in' }, showcase, identity, ...sections);
}

