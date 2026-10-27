import { h, toast } from './dom';
import { playerCard, fitColor, formClass, skillList } from './playerCard';
import { SKILLS } from '../data/skills';
import { sound } from '../audio/sound';
import { ATTR_KEYS, AttrKey, Player, SLOT_GROUP, avgForm, marketValue, overall, xpToNext } from '../data/player';
import { Club, MIN_SQUAD, buySkillPoint, restCost, restPlayer, sellPlayer, skillPointCost, trainAttribute } from '../game/club';

const ATTR_NAME: Record<AttrKey, string> = {
  pace: 'Pace',
  acceleration: 'Acceleration',
  stamina: 'Stamina',
  strength: 'Strength',
  passing: 'Passing',
  vision: 'Vision',
  dribbling: 'Dribbling',
  finishing: 'Finishing',
  crossing: 'Crossing',
  tackling: 'Tackling',
  marking: 'Marking',
  positioning: 'Positioning',
  heading: 'Heading',
  composure: 'Composure',
  aggression: 'Aggression',
  goalkeeping: 'Goalkeeping',
};

type Filter = 'ALL' | 'GK' | 'DEF' | 'MID' | 'FWD';
type Sort = 'ovr' | 'pos' | 'fit' | 'form';
const POS_ORDER = ['GK', 'RB', 'RWB', 'CB', 'LB', 'LWB', 'DM', 'CM', 'RM', 'LM', 'AM', 'RW', 'LW', 'ST'];

export function squadScreen(club: Club, onBack: () => void, coinsEl: () => HTMLElement): HTMLElement {
  let filter: Filter = 'ALL';
  let sort: Sort = 'ovr';
  const root = h('div', { class: 'screen squad fade-in' });

  function render(): void {
    const team = club.team;
    let list = team.squad.filter((p) => filter === 'ALL' || SLOT_GROUP[p.positions[0]] === filter);
    list = [...list].sort((a, b) => {
      if (sort === 'pos') return POS_ORDER.indexOf(a.positions[0]) - POS_ORDER.indexOf(b.positions[0]) || overall(b) - overall(a);
      if (sort === 'fit') return b.condition - a.condition;
      if (sort === 'form') return (avgForm(b) ?? 0) - (avgForm(a) ?? 0);
      return overall(b) - overall(a);
    });
    root.replaceChildren(
      h(
        'header',
        { class: 'bar' },
        h('button', { class: 'ghost-btn', onclick: onBack }, '‹ Back'),
        h('div', { class: 'bar-title' }, h('b', {}, 'Squad'), h('div', { class: 'muted' }, `${team.squad.length} players`)),
        coinsEl(),
      ),
      h(
        'div',
        { class: 'squad-tools' },
        h('div', { class: 'chips' }, ...(['ALL', 'GK', 'DEF', 'MID', 'FWD'] as Filter[]).map((f) => h('button', { class: f === filter ? 'on' : '', onclick: () => ((filter = f), render()) }, f))),
        h(
          'div',
          { class: 'chips' },
          ...(
            [
              ['ovr', 'Rating'],
              ['pos', 'Position'],
              ['fit', 'Fitness'],
              ['form', 'Form'],
            ] as [Sort, string][]
          ).map(([k, l]) => h('button', { class: k === sort ? 'on' : '', onclick: () => ((sort = k), render()) }, l)),
        ),
      ),
      h(
        'div',
        { class: 'card-grid' },
        ...list.map((p) =>
          playerCard(p, {
            badge: team.tactics.lineup.includes(p.id) ? 'XI' : undefined,
            onClick: () => openPlayer(p),
          }),
        ),
      ),
    );
  }

  function openPlayer(p: Player): void {
    const layer = h('div', { class: 'layer modal-layer fade-in', onclick: (e: Event) => e.target === layer && close() });
    const close = () => {
      layer.remove();
      render();
    };
    const draw = () => {
      const form = avgForm(p);
      const keys = ATTR_KEYS.filter((k) => p.positions[0] === 'GK' || k !== 'goalkeeping');
      layer.replaceChildren(
        h(
          'div',
          { class: 'modal player-modal pop-in' },
          h('button', { class: 'close-x', onclick: close }, '✕'),
          h(
            'div',
            { class: 'pm-head' },
            playerCard(p, { size: 'lg' }),
            h(
              'div',
              { class: 'pm-info' },
              h('h2', {}, p.name),
              h('div', { class: 'muted' }, `${p.positions.join(' / ')} · #${p.number} · ${p.rarity.toUpperCase()}`),
              h('div', { class: 'pm-meter' }, h('span', {}, `Level ${p.level}`), h('div', { class: 'bar-track' }, h('i', { style: { width: `${(p.xp / xpToNext(p.level)) * 100}%` } })), h('small', {}, `${p.xp}/${xpToNext(p.level)} XP`)),
              h('div', { class: 'pm-meter' }, h('span', {}, 'Fitness'), h('div', { class: 'bar-track' }, h('i', { style: { width: `${p.condition * 100}%`, background: fitColor(p.condition) } })), h('small', {}, `${Math.round(p.condition * 100)}%`)),
              h(
                'div',
                { class: 'pm-form' },
                h('span', {}, 'Form'),
                ...(p.form.length ? p.form.map((r) => h('i', { class: `form-chip ${formClass(r)}` }, r.toFixed(1))) : [h('small', { class: 'muted' }, 'No matches yet')]),
                form !== null ? h('b', { class: formClass(form) }, ` avg ${form.toFixed(2)}`) : null,
              ),
              h('div', { class: 'pm-value' }, 'Value ', h('b', { class: 'coin' }, marketValue(p).toLocaleString())),
            ),
          ),
          skillList(p),
          h(
            'div',
            { class: 'pm-train' },
            h('div', { class: 'sub-title' }, `Training · ${p.skillPoints} skill point${p.skillPoints === 1 ? '' : 's'}`),
            h(
              'div',
              { class: 'attr-list' },
              ...keys.map((k) =>
                h(
                  'div',
                  { class: 'attr-row' },
                  h('span', {}, ATTR_NAME[k]),
                  h('div', { class: 'bar-track' }, h('i', { style: { width: `${p.attrs[k]}%`, background: attrColor(p.attrs[k]) } })),
                  h('b', {}, p.attrs[k]),
                  h(
                    'button',
                    {
                      class: 'plus',
                      disabled: p.skillPoints <= 0 || p.attrs[k] >= 99,
                      onclick: () => {
                        const had = p.skills.length;
                        trainAttribute(club, p, k);
                        if (p.skills.length > had) {
                          const s = SKILLS[p.skills[p.skills.length - 1]];
                          sound.reveal(p.rarity);
                          toast(`${p.rarity.toUpperCase()}! New skill: ${s.icon} ${s.name}`);
                        }
                        draw();
                      },
                    },
                    '+',
                  ),
                ),
              ),
            ),
          ),
          h(
            'div',
            { class: 'actions' },
            h(
              'button',
              {
                onclick: () => {
                  if (!buySkillPoint(club, p)) return toast('Not enough coins');
                  draw();
                },
              },
              `Coaching +1 SP · ${skillPointCost(p)}`,
            ),
            h(
              'button',
              {
                disabled: restCost(p) <= 0,
                onclick: () => {
                  if (!restPlayer(club, p)) return toast('Not enough coins');
                  draw();
                },
              },
              restCost(p) > 0 ? `Physio · ${restCost(p)}` : 'Fully fit',
            ),
            h(
              'button',
              {
                class: 'danger',
                onclick: () => {
                  if (club.team.squad.length <= MIN_SQUAD) return toast(`You need at least ${MIN_SQUAD} players`);
                  if (!confirm(`Sell ${p.name} for ${marketValue(p).toLocaleString()} coins?`)) return;
                  sellPlayer(club, p);
                  toast(`${p.name} sold`);
                  close();
                },
              },
              `Sell · ${marketValue(p).toLocaleString()}`,
            ),
          ),
        ),
      );
    };
    draw();
    document.body.append(layer);
  }

  render();
  return root;
}

const attrColor = (v: number) => (v >= 80 ? '#22c55e' : v >= 65 ? '#84cc16' : v >= 50 ? '#facc15' : '#f97316');
