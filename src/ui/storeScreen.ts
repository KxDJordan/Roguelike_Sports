import { sound } from '../audio/sound';
import { h, toast } from './dom';
import { playerCard } from './playerCard';
import { Rng } from '../sim/rng';
import { Player, marketValue } from '../data/player';
import { Club, MAX_SQUAD, addPlayer, canAdd, saveClub } from '../game/club';
import { PACKS, PackDef, openPack } from '../game/packs';

export function storeScreen(club: Club, onBack: () => void, coinsEl: () => HTMLElement): HTMLElement {
  const root = h('div', { class: 'screen store fade-in' });

  function render(): void {
    root.replaceChildren(
      h(
        'header',
        { class: 'bar' },
        h('button', { class: 'ghost-btn', onclick: onBack }, '‹ Back'),
        h('div', { class: 'bar-title' }, h('b', {}, 'Recruitment'), h('div', { class: 'muted' }, `Squad ${club.team.squad.length}/${MAX_SQUAD}`)),
        coinsEl(),
      ),
      h(
        'div',
        { class: 'pack-grid' },
        ...PACKS.map((pack) =>
          h(
            'div',
            { class: `pack ${pack.id}` },
            h('div', { class: 'pack-art' }, h('div', { class: 'pack-glow' }), h('b', {}, pack.name.split(' ')[0].toUpperCase()), h('span', {}, 'PACK')),
            h('p', { class: 'muted' }, pack.blurb),
            h(
              'div',
              { class: 'odds' },
              ...(['bronze', 'silver', 'gold', 'elite'] as const)
                .filter((r) => pack.odds[r] > 0)
                .map((r) => h('span', { class: `odd ${r}` }, `${r} ${Math.round(pack.odds[r] * 100)}%`)),
            ),
            h(
              'button',
              {
                class: 'primary',
                disabled: club.coins < pack.cost,
                onclick: () => buy(pack),
              },
              h('span', { class: 'coin' }, pack.cost.toLocaleString()),
            ),
          ),
        ),
      ),
    );
  }

  function buy(pack: PackDef): void {
    if (club.coins < pack.cost) return toast('Not enough coins');
    club.coins -= pack.cost;
    saveClub(club);
    const taken = new Set(club.team.squad.map((p) => p.number));
    const players = openPack(new Rng((Date.now() ^ (Math.random() * 1e9)) >>> 0), pack, taken);
    reveal(pack, players);
  }

  /** Cards drop in face down, then flip one by one, saving the best for last. */
  function reveal(pack: PackDef, players: Player[]): void {
    const decided = new Set<string>();
    const layer = h('div', { class: 'layer reveal-layer fade-in' });
    const row = h('div', { class: 'reveal-row' });
    const done = h('button', { class: 'primary big', disabled: true }, 'Continue');
    done.onclick = () => {
      layer.remove();
      render();
    };

    players.forEach((p, i) => {
      const slot = h('div', { class: 'reveal-slot' });
      const flip = h(
        'div',
        { class: `flip ${p.rarity}` },
        h('div', { class: 'flip-back' }, h('b', {}, pack.name.split(' ')[0].toUpperCase())),
        h('div', { class: 'flip-front' }, playerCard(p, { size: 'md', bare: true })),
      );
      const actions = h('div', { class: 'reveal-actions' });
      const decide = (msg: string) => {
        decided.add(p.id);
        actions.replaceChildren(h('span', { class: 'muted' }, msg));
        if (decided.size === players.length) done.disabled = false;
      };
      actions.append(
        h(
          'button',
          {
            class: 'primary',
            onclick: () => {
              if (!canAdd(club)) return toast(`Squad is full (${MAX_SQUAD}). Sell someone first.`);
              addPlayer(club, p);
              decide('Signed ✓');
            },
          },
          'Sign',
        ),
        h(
          'button',
          {
            onclick: () => {
              club.coins += marketValue(p);
              saveClub(club);
              decide(`Sold +${marketValue(p)}`);
            },
          },
          `Sell +${marketValue(p)}`,
        ),
      );
      slot.append(flip, actions);
      row.append(slot);
      const delay = 500 + i * 900 + (i === players.length - 1 && (p.rarity === 'gold' || p.rarity === 'elite') ? 500 : 0);
      setTimeout(() => {
        flip.classList.add('flipped');
        sound.reveal(p.rarity);
        slot.classList.add('revealed');
      }, delay);
    });

    layer.append(h('div', { class: 'reveal-wrap' }, h('h2', { class: 'reveal-title' }, pack.name), row, done));
    document.body.append(layer);
  }

  render();
  return root;
}
