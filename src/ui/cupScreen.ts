import { h } from './dom';
import { playerCard, cosmeticCard } from './playerCard';
import { crest } from './careerScreen';
import { icon } from './icons';
import { sound } from '../audio/sound';
import type { Club } from '../game/club';
import { squadRating } from '../game/club';
import { BOONS, BoonId, CupRun, ENTRY_FEE, REWARDS, ROUND_NAMES, TWISTS, emptyMeta, reachedName, roundPhrase } from '../game/cup';
import { FORMATIONS, FORMATION_IDS } from '../tactics/formations';
import type { TeamSetup } from '../data/generator';

export interface CupActions {
  onBack: () => void;
  coinsEl: () => HTMLElement;
  onStart: (formation: string) => void;
  onPick: (index: number) => void;
  onTactics: () => void;
  onPlay: () => void;
  onQuickSim: () => void;
  onBoon: (id: BoonId) => void;
  onNewRun: () => void;
}

let formationChoice = '4-3-3';

/** The cup run: lobby, draft, bracket and the end-of-run verdict. */
export function cupScreen(club: Club, a: CupActions): HTMLElement {
  const run = club.cup;
  const header = h(
    'header',
    { class: 'bar' },
    h('button', { class: 'ghost-btn', onclick: a.onBack }, '‹ Back'),
    h('div', { class: 'bar-title' }, h('b', {}, 'Cup Run'), h('div', { class: 'muted' }, run?.status === 'active' ? ROUND_NAMES[run.round] : run?.status === 'draft' ? 'Draft' : 'Knockout cup')),
    a.coinsEl(),
  );
  const body = !run ? lobby(club, a) : run.status === 'draft' ? draft(run, a) : run.status === 'active' ? bracket(run, a) : finished(club, run, a);
  return h('div', { class: 'screen cup fade-in' }, header, body);
}

function lobby(club: Club, a: CupActions): HTMLElement {
  const meta = club.cupMeta ?? emptyMeta();
  const afford = club.coins >= ENTRY_FEE;
  return h(
    'div',
    { class: 'cup-body' },
    h(
      'div',
      { class: 'cup-hero panel' },
      h('div', { class: 'cup-trophy' }, icon('career')),
      h('h2', {}, 'The Roguelike Cup'),
      h('p', { class: 'muted' }, 'Draft a squad from scratch, then win five knockout ties in a row. Every opponent is stronger than the last and brings a twist. Win and you choose a reward for the rest of the run. Lose once and it is over.'),
      h(
        'div',
        { class: 'cup-meta' },
        h('div', { class: 'led' }, h('b', {}, String(meta.runs)), h('small', {}, 'RUNS')),
        h('div', { class: 'led' }, h('b', {}, String(meta.cupsWon)), h('small', {}, 'CUPS')),
        h('div', { class: 'led wide' }, h('b', {}, '★'.repeat(meta.scouting) + '☆'.repeat(5 - meta.scouting)), h('small', {}, 'SCOUTING')),
      ),
      h('small', { class: 'muted' }, `Best: ${reachedName(meta.best)} · Each cup won improves scouting: future drafts offer better players.`),
    ),
    h(
      'div',
      { class: 'panel' },
      h('div', { class: 'sub-title' }, 'Pick your formation'),
      h(
        'div',
        { class: 'seg formation-seg' },
        ...FORMATION_IDS.map((f) => h('button', { class: f === formationChoice ? 'on' : '', onclick: (e: Event) => ((formationChoice = f), setOn(e)) }, f)),
      ),
      h('small', { class: 'muted' }, 'You will draft one player for each position in it, then get a five-man bench.'),
      h(
        'button',
        { class: 'primary big', disabled: !afford, onclick: () => a.onStart(formationChoice) },
        afford ? `Enter the cup · ${ENTRY_FEE} coins` : `Need ${ENTRY_FEE} coins to enter`,
      ),
    ),
    h(
      'div',
      { class: 'panel prizes' },
      h('div', { class: 'sub-title' }, 'Prize money'),
      ...ROUND_NAMES.map((_, i) => h('div', { class: 'prize-row' }, h('span', {}, `Out in ${roundPhrase(i)}`), h('b', { class: 'coin' }, REWARDS[i].toLocaleString()))),
      h('div', { class: 'prize-row win' }, h('span', {}, 'Win the cup'), h('b', { class: 'coin' }, `${REWARDS[ROUND_NAMES.length].toLocaleString()} + rare kit, ball or crest`)),
    ),
  );
}

/** Light up the tapped segmented button without re-rendering the screen. */
function setOn(e: Event): void {
  const btn = e.currentTarget as HTMLElement;
  btn.parentElement?.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
}

function draft(run: CupRun, a: CupActions): HTMLElement {
  const d = run.draft!;
  const form = FORMATIONS[run.squad.tactics.formation];
  const pos = form.slots[d.slot].pos;
  const labels = ['Safe pick', 'Solid', 'The gamble'];
  return h(
    'div',
    { class: 'cup-body' },
    h(
      'div',
      { class: 'draft-head panel' },
      h('div', { class: 'draft-title' }, h('b', {}, `Pick your ${pos}`), h('span', { class: 'muted' }, `${d.slot + 1} of ${form.slots.length} · ${run.squad.tactics.formation}`)),
      h('div', { class: 'bar-track' }, h('i', { style: { width: `${(d.slot / form.slots.length) * 100}%` } })),
    ),
    h(
      'div',
      { class: 'draft-options' },
      ...d.options.map((p, i) => h('div', { class: 'draft-option' }, h('small', { class: 'draft-label' }, labels[i]), playerCard(p, { size: 'md', bare: true, onClick: () => a.onPick(i) }))),
    ),
    run.squad.squad.length
      ? h(
          'div',
          { class: 'panel' },
          h('div', { class: 'sub-title' }, 'Your XI so far'),
          h('div', { class: 'draft-xi' }, ...run.squad.squad.map((p) => playerCard(p, { size: 'sm', bare: true }))),
        )
      : null,
  );
}

function bracket(run: CupRun, a: CupActions): HTMLElement {
  const choosing = !!run.offer;
  return h(
    'div',
    { class: 'cup-body' },
    run.offer ? boonOffer(run.offer, a) : null,
    h(
      'div',
      { class: 'panel cup-bracket' },
      h('div', { class: 'sub-title' }, `${run.squad.name} · rating ${squadRating(run.squad)}`),
      ...ROUND_NAMES.map((name, i) => {
        const opp = run.opponents[i];
        const res = run.results[i];
        const t = TWISTS[opp.twist];
        const state = res ? (res.won ? 'won' : 'lost') : i === run.round ? 'next' : 'locked';
        return h(
          'div',
          { class: `tie ${state}` },
          h('span', { class: 'tie-round' }, name),
          h('span', { class: 'tie-opp' }, crest(i <= run.round ? opp : { short: '?', color: '#334155' }), h('b', {}, i <= run.round ? opp.name : '???'), h('small', { class: 'muted' }, i <= run.round ? `Rating ${opp.rating} · ${opp.style}` : 'Unknown')),
          i <= run.round ? h('span', { class: 'twist', title: t.desc }, `${t.icon} ${t.name}`) : h('span', { class: 'twist hidden' }, '?'),
          h('span', { class: 'tie-res' }, res ? `${res.gf}–${res.ga}${res.pens ? ` (${res.pens[0]}–${res.pens[1]} p)` : ''}` : state === 'next' ? 'NEXT' : ''),
        );
      }),
    ),
    h(
      'div',
      { class: 'panel next-tie' },
      h('div', { class: 'sub-title' }, `Next: ${ROUND_NAMES[run.round]}`),
      h('p', { class: 'twist-desc' }, `${TWISTS[run.opponents[run.round].twist].icon} ${TWISTS[run.opponents[run.round].twist].desc}`),
      run.notice ? h('p', { class: 'cup-notice' }, run.notice) : null,
      run.secondChance ? h('small', { class: 'muted' }, '❤️ Second Chance ready: lose this and you get to replay it.') : null,
      h(
        'div',
        { class: 'nm-actions' },
        h('button', { class: 'primary big', disabled: choosing, onclick: a.onPlay }, choosing ? 'Choose a reward first' : 'PLAY TIE'),
        h('button', { disabled: choosing, onclick: a.onQuickSim }, 'Quick sim'),
      ),
      h('button', { onclick: a.onTactics }, 'Squad, tactics & fitness'),
    ),
    run.boons.length
      ? h(
          'div',
          { class: 'panel' },
          h('div', { class: 'sub-title' }, 'Your rewards'),
          h('div', { class: 'boon-chips' }, ...run.boons.map((id) => h('span', { class: 'boon-chip', title: BOONS[id].desc }, `${BOONS[id].icon} ${BOONS[id].name}`))),
        )
      : null,
  );
}

function boonOffer(offer: BoonId[], a: CupActions): HTMLElement {
  return h(
    'div',
    { class: 'panel boon-offer pop-in' },
    h('div', { class: 'sub-title' }, 'Through! Choose a reward'),
    h(
      'div',
      { class: 'boon-grid' },
      ...offer.map((id) => {
        const b = BOONS[id];
        return h('button', { class: 'boon', onclick: () => a.onBoon(id) }, h('span', { class: 'boon-ico' }, b.icon), h('b', {}, b.name), h('small', {}, b.desc));
      }),
    ),
  );
}

function finished(club: Club, run: CupRun, a: CupActions): HTMLElement {
  const won = run.status === 'won';
  const last = run.results[run.results.length - 1];
  const prize = run.payout?.cosmetic;
  return h(
    'div',
    { class: 'cup-body' },
    h(
      'div',
      { class: `panel cup-verdict ${won ? 'won' : 'lost'}` },
      won ? h('div', { class: 'cup-trophy big' }, icon('career')) : null,
      h('div', { class: 'vd-title' }, won ? 'CUP WINNERS!' : 'KNOCKED OUT'),
      h('div', {}, won ? `${run.squad.name} won all five ties.` : `Out in ${roundPhrase(run.round)}${last ? `, ${last.gf}–${last.ga}${last.pens ? ` (${last.pens[0]}–${last.pens[1]} on penalties)` : ''}` : ''}.`),
      h('div', { class: 'vd-prize' }, 'Prize money ', h('b', { class: 'coin' }, (run.payout?.coins ?? 0).toLocaleString())),
      prize
        ? h(
            'div',
            { class: 'cup-prize' },
            cosmeticCard(prize.kind, prize.def),
            h('small', { class: 'muted' }, prize.duplicateCoins ? `Already owned: +${prize.duplicateCoins} coins instead.` : 'Added to your locker. Equip it from the Club tab.'),
          )
        : null,
      won ? h('small', { class: 'muted' }, `Scouting is now ${'★'.repeat(club.cupMeta!.scouting)}: your next draft starts stronger.`) : null,
      h('button', { class: 'primary big', onclick: a.onNewRun }, 'Back to the cup lobby'),
    ),
    h(
      'div',
      { class: 'panel' },
      h('div', { class: 'sub-title' }, 'Your run'),
      ...run.results.map((r, i) => h('div', { class: `tie ${r.won ? 'won' : 'lost'}` }, h('span', { class: 'tie-round' }, ROUND_NAMES[i]), h('span', { class: 'tie-opp' }, crest(run.opponents[i]), h('b', {}, run.opponents[i].name)), h('span', {}), h('span', { class: 'tie-res' }, `${r.gf}–${r.ga}${r.pens ? ` (${r.pens[0]}–${r.pens[1]} p)` : ''}`))),
    ),
  );
}

/**
 * Penalty shootout, kick by kick: the two rows of spots fill in with goals and misses, then the
 * verdict. Calls onDone when the user continues.
 */
export function shootoutScreen(home: TeamSetup, away: TeamSetup, pens: { home: boolean[]; away: boolean[] }, onDone: () => void): HTMLElement {
  const rows = [h('div', { class: 'pen-row' }), h('div', { class: 'pen-row' })];
  const total = Math.max(5, pens.home.length);
  for (const r of rows) for (let i = 0; i < total; i++) r.append(h('i', { class: 'pen' }));
  const score = h('b', { class: 'pen-score' }, '0 – 0');
  const verdict = h('div', { class: 'pen-verdict' });
  const actions = h('div', { class: 'actions' });
  const el = h(
    'div',
    { class: 'screen shootout fade-in' },
    h('div', { class: 'modal-kicker' }, 'Penalty shootout'),
    h(
      'div',
      { class: 'pen-board panel' },
      h('div', { class: 'pen-team' }, crest(home), h('span', {}, home.short), rows[0]),
      h('div', { class: 'pen-team' }, crest(away), h('span', {}, away.short), rows[1]),
    ),
    score,
    verdict,
    actions,
  );
  const kicks: [number, number, boolean][] = [];
  for (let i = 0; i < pens.home.length; i++) {
    kicks.push([0, i, pens.home[i]]);
    if (i < pens.away.length) kicks.push([1, i, pens.away[i]]);
  }
  let hs = 0;
  let as = 0;
  kicks.forEach(([side, i, scored], k) => {
    setTimeout(() => {
      rows[side].children[i].classList.add(scored ? 'scored' : 'missed');
      if (scored) side === 0 ? hs++ : as++;
      score.textContent = `${hs} – ${as}`;
      sound.kick(1);
      if (scored) sound.goal(side === 0);
      else sound.save();
      if (k === kicks.length - 1) {
        const won = hs > as;
        verdict.textContent = won ? `${home.short} WIN ${hs}–${as} ON PENALTIES` : `${away.short} WIN ${as}–${hs} ON PENALTIES`;
        verdict.classList.add(won ? 'won' : 'lost');
        actions.append(h('button', { class: 'primary big', onclick: onDone }, 'Continue'));
      }
    }, 700 + k * 850);
  });
  return el;
}
