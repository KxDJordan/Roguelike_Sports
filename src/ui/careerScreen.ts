import { h } from './dom';
import type { Club } from '../game/club';
import { squadRating } from '../game/club';
import {
  Career,
  CareerTeam,
  DIVISIONS,
  Fixture,
  LEAGUE_SIZE,
  PROMOTED,
  RELEGATED,
  YOU,
  nextOpponent,
  ordinal,
  rounds,
  seasonOutcome,
  seasonOver,
  standings,
  teamById,
} from '../game/career';

export interface CareerActions {
  onBack: () => void;
  onPlay: () => void;
  onQuickSim: () => void;
  onNextSeason: () => void;
  coinsEl: () => HTMLElement;
}

type Tab = 'table' | 'fixtures' | 'history';
let lastTab: Tab = 'table';

const OUTCOME_TITLE = { champions: 'CHAMPIONS!', promoted: 'PROMOTED!', stayed: 'SEASON COMPLETE', relegated: 'RELEGATED' } as const;

/** Career hub: the next fixture (or the season's verdict), and the table, fixtures and history. */
export function careerScreen(club: Club, a: CareerActions): HTMLElement {
  const c = club.career!;
  const root = h('div', { class: 'screen career fade-in' });
  const div = DIVISIONS[c.tier];

  function render(): void {
    const over = seasonOver(c);
    root.replaceChildren(
      h(
        'header',
        { class: 'bar' },
        h('button', { class: 'ghost-btn', onclick: a.onBack }, '‹ Back'),
        h('div', { class: 'bar-title' }, h('b', {}, div.name), h('div', { class: 'muted' }, over ? `Season ${c.season} · finished` : `Season ${c.season} · Matchday ${c.round + 1} of ${rounds(c)}`)),
        a.coinsEl(),
      ),
      ladder(c),
      over ? verdict() : nextMatch(),
      tabs(),
      h('div', { class: 'career-body' }, lastTab === 'table' ? table(c) : lastTab === 'fixtures' ? fixtures(c) : history(c)),
    );
  }

  function nextMatch(): HTMLElement {
    const nx = nextOpponent(c)!;
    const you = c.teams.find((t) => t.id === YOU)!;
    const pos = (id: string) => standings(c).findIndex((r) => r.team.id === id) + 1;
    const started = c.round > 0;
    return h(
      'div',
      { class: 'next-match panel' },
      h('div', { class: 'nm-kicker' }, `Matchday ${c.round + 1}`, h('span', { class: `venue ${nx.home ? 'home' : 'away'}` }, nx.home ? 'HOME' : 'AWAY')),
      h(
        'div',
        { class: 'nm-teams' },
        side(you, `Rating ${squadRating(club.team)}`, started ? `${ordinal(pos(YOU))}` : ''),
        h('b', { class: 'nm-vs' }, 'VS'),
        side(nx.team, `Rating ${nx.team.rating} · ${nx.team.style ?? ''}`, started ? `${ordinal(pos(nx.team.id))}` : ''),
      ),
      h(
        'div',
        { class: 'nm-actions' },
        h('button', { class: 'primary big', onclick: a.onPlay }, 'PLAY MATCH'),
        h('button', { onclick: a.onQuickSim, title: 'Simulate your match instantly' }, 'Quick sim'),
      ),
    );
  }

  function side(t: CareerTeam, sub: string, pos: string): HTMLElement {
    return h('div', { class: 'nm-side' }, crest(t, 'lg'), h('b', {}, t.name), h('small', { class: 'muted' }, sub), pos ? h('small', { class: 'nm-pos' }, pos) : null);
  }

  function verdict(): HTMLElement {
    const { position, outcome, prize } = seasonOutcome(c);
    const nextTier = c.tier + (outcome === 'promoted' ? 1 : outcome === 'relegated' ? -1 : 0);
    return h(
      'div',
      { class: `verdict panel ${outcome}` },
      h('div', { class: 'vd-title' }, OUTCOME_TITLE[outcome]),
      h('div', {}, `You finished ${ordinal(position)} in the ${div.name}.`),
      h('div', { class: 'vd-prize' }, 'Prize money ', h('b', { class: 'coin' }, prize.toLocaleString())),
      h('button', { class: 'primary big', onclick: a.onNextSeason }, `Start season ${c.season + 1} · ${DIVISIONS[nextTier].name}`),
    );
  }

  function tabs(): HTMLElement {
    const tab = (t: Tab, label: string) => h('button', { class: lastTab === t ? 'on' : '', onclick: () => ((lastTab = t), render()) }, label);
    return h('div', { class: 'seg career-tabs' }, tab('table', 'Table'), tab('fixtures', 'Fixtures'), tab('history', 'History'));
  }

  render();
  return root;
}

/** The four divisions, bottom to top, with the user's current one lit. */
function ladder(c: Career): HTMLElement {
  return h(
    'div',
    { class: 'ladder' },
    ...DIVISIONS.map((d, i) => h('div', { class: `rung tier${i} ${i === c.tier ? 'on' : ''} ${i < c.tier ? 'done' : ''}` }, d.name.split(' ')[0])),
  );
}

export function crest(t: Pick<CareerTeam, 'short' | 'color'>, size: 'sm' | 'lg' = 'sm'): HTMLElement {
  return h('span', { class: `crest-chip ${size}`, style: { background: t.color } }, t.short);
}

function table(c: Career): HTMLElement {
  const rows = standings(c);
  const top = c.tier === DIVISIONS.length - 1;
  return h(
    'div',
    { class: 'league-table' },
    h('div', { class: 'lt-row head' }, h('span', {}, '#'), h('span', {}, 'Club'), h('span', {}, 'P'), h('span', {}, 'W'), h('span', {}, 'D'), h('span', {}, 'L'), h('span', {}, 'GD'), h('span', {}, 'Pts'), h('span', { class: 'lt-form' }, 'Form')),
    ...rows.map((r, i) => {
      const pos = i + 1;
      const zone = !top && pos <= PROMOTED ? 'promo' : c.tier > 0 && pos > LEAGUE_SIZE - RELEGATED ? 'rel' : top && pos === 1 ? 'promo' : '';
      return h(
        'div',
        { class: `lt-row ${zone} ${r.team.id === YOU ? 'you' : ''}` },
        h('span', { class: 'lt-pos' }, pos),
        h('span', { class: 'lt-club' }, crest(r.team), h('b', {}, r.team.name)),
        h('span', {}, r.p),
        h('span', {}, r.w),
        h('span', {}, r.d),
        h('span', {}, r.l),
        h('span', {}, r.gd > 0 ? `+${r.gd}` : r.gd),
        h('b', {}, r.pts),
        h('span', { class: 'lt-form' }, ...r.form.map((f) => h('i', { class: `res res-${f}` }, f))),
      );
    }),
    h('div', { class: 'lt-key muted' }, top ? 'Top spot: champions' : `Top ${PROMOTED}: promotion`, c.tier > 0 ? ` · Bottom ${RELEGATED}: relegation` : ''),
  );
}

function fixtures(c: Career): HTMLElement {
  const days: HTMLElement[] = [];
  for (let r = 0; r < rounds(c); r++) {
    const games = c.fixtures.filter((f) => f.round === r);
    days.push(
      h(
        'div',
        { class: `fx-day ${r === c.round ? 'current' : ''}` },
        h('div', { class: 'sub-title' }, `Matchday ${r + 1}`),
        ...games.map((f) => fixtureRow(c, f)),
      ),
    );
  }
  return h('div', { class: 'fixtures' }, ...days);
}

export function fixtureRow(c: Career, f: Fixture): HTMLElement {
  const home = teamById(c, f.home);
  const away = teamById(c, f.away);
  const mine = f.home === YOU || f.away === YOU;
  let res = '';
  if (f.score && mine) {
    const [gf, ga] = f.home === YOU ? f.score : [f.score[1], f.score[0]];
    res = gf > ga ? 'W' : gf === ga ? 'D' : 'L';
  }
  return h(
    'div',
    { class: `fx-row ${mine ? 'mine' : ''} ${res ? `out-${res}` : ''}` },
    h('span', { class: 'fx-team home' }, h('b', {}, home.short), crest(home)),
    h('span', { class: 'fx-score' }, f.score ? `${f.score[0]} – ${f.score[1]}` : 'v'),
    h('span', { class: 'fx-team away' }, crest(away), h('b', {}, away.short)),
  );
}

function history(c: Career): HTMLElement {
  if (!c.history.length) return h('div', { class: 'muted empty-note' }, 'Finish your first season to start your honours list.');
  return h(
    'div',
    { class: 'history' },
    ...[...c.history].reverse().map((s) =>
      h(
        'div',
        { class: `hist-row ${s.outcome}` },
        h('b', {}, `Season ${s.season}`),
        h('span', {}, DIVISIONS[s.tier].name),
        h('span', {}, ordinal(s.position)),
        h('span', { class: 'hist-outcome' }, OUTCOME_TITLE[s.outcome].replace('!', '')),
        h('span', { class: 'coin' }, s.prize.toLocaleString()),
      ),
    ),
  );
}

/**
 * Shown while the rest of the matchday is simulated: the other fixtures, with scores appearing
 * as each one finishes.
 */
export function roundScreen(c: Career, round: number): { el: HTMLElement; update: (f: Fixture) => void; done: (onContinue: () => void) => void } {
  const games = c.fixtures.filter((f) => f.round === round);
  const rows = new Map(games.map((f) => [f, fixtureRow(c, f)]));
  const status = h('div', { class: 'muted' }, 'Simulating the other matches…');
  const actions = h('div', { class: 'actions' });
  const el = h(
    'div',
    { class: 'screen round-screen fade-in' },
    h('div', { class: 'modal-kicker' }, `Matchday ${round + 1}`),
    h('h2', {}, 'Around the league'),
    status,
    h('div', { class: 'round-list' }, ...rows.values()),
    actions,
  );
  return {
    el,
    update: (f) => {
      const row = fixtureRow(c, f);
      row.classList.add('pop-in');
      rows.get(f)?.replaceWith(row);
      rows.set(f, row);
    },
    done: (onContinue) => {
      status.textContent = 'All results in.';
      actions.replaceChildren(h('button', { class: 'primary big', onclick: onContinue }, 'Continue'));
    },
  };
}
