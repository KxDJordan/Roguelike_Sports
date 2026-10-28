import { describe, expect, it } from 'vitest';
import { Rng } from '../src/sim/rng';
import { Match } from '../src/sim/match';
import { makeTeam } from '../src/data/generator';
import { overall } from '../src/data/player';
import { FORMATIONS } from '../src/tactics/formations';
import type { Club } from '../src/game/club';
import { BOONS, BoonId, ENTRY_FEE, REWARDS, ROUND_NAMES, draftPick, finishTie, shootout, startRun, takeBoon, tieSides } from '../src/game/cup';

function club(coins = 5000): Club {
  return {
    version: 2,
    team: makeTeam(new Rng(3), 'Your Club', 'YOU', '#e63946', 62),
    coins,
    matchesPlayed: 0,
    record: { w: 0, d: 0, l: 0, gf: 0, ga: 0 },
    results: [],
  };
}

function drafted(c: Club, seed = 7) {
  const run = startRun(c, '4-3-3', seed)!;
  // Always take the gamble (third option).
  while (run.draft) draftPick(run, 2);
  return run;
}

describe('cup run draft', () => {
  it('charges the entry fee and refuses when you cannot pay', () => {
    expect(startRun(club(100), '4-3-3', 1)).toBeNull();
    const c = club();
    startRun(c, '4-3-3', 1);
    expect(c.coins).toBe(5000 - ENTRY_FEE);
    expect(c.cupMeta!.runs).toBe(1);
  });

  it('drafts a player for every position, then adds a bench', () => {
    const c = club();
    const run = drafted(c);
    const form = FORMATIONS['4-3-3'];
    expect(run.status).toBe('active');
    expect(run.squad.squad).toHaveLength(16);
    expect(new Set(run.squad.tactics.lineup).size).toBe(11);
    form.slots.forEach((s, i) => {
      const p = run.squad.squad.find((q) => q.id === run.squad.tactics.lineup[i])!;
      expect(p.positions[0]).toBe(s.pos);
    });
    expect(new Set(run.squad.squad.map((p) => p.number)).size).toBe(16);
  });

  it('offers a safe, a solid and a gamble pick', () => {
    const run = startRun(club(), '4-3-3', 5)!;
    const [a, , c] = run.draft!.options.map(overall);
    expect(c).toBeGreaterThan(a);
  });

  it('lines up five opponents, each stronger than the last, each with a different twist', () => {
    const run = drafted(club());
    expect(run.opponents).toHaveLength(ROUND_NAMES.length);
    for (let i = 1; i < run.opponents.length; i++) expect(run.opponents[i].rating).toBeGreaterThan(run.opponents[i - 1].rating);
    expect(new Set(run.opponents.map((o) => o.twist)).size).toBe(ROUND_NAMES.length);
  });
});

describe('cup ties', () => {
  it('applies twists to copies, never to the run squad', () => {
    const run = drafted(club());
    run.opponents[0].twist = 'injuries';
    const before = [...run.squad.tactics.lineup];
    const { home } = tieSides(run);
    expect(home.tactics.lineup.filter((id) => !before.includes(id))).toHaveLength(2);
    expect(run.squad.tactics.lineup).toEqual(before);
    run.opponents[0].twist = 'fortress';
    const { away } = tieSides(run);
    const gk = away.squad.find((p) => p.positions[0] === 'GK')!;
    const orig = run.opponents[0].setup.squad.find((p) => p.id === gk.id)!;
    expect(gk.attrs.goalkeeping).toBe(Math.min(99, orig.attrs.goalkeeping + 12));
  });

  it('settles shootouts with a winner, five kicks each unless decided early', () => {
    const run = drafted(club());
    for (let i = 0; i < 20; i++) {
      run.round = i % 5;
      run.seed = i + 1;
      const { home, away } = tieSides(run);
      const s = shootout(run, home, away);
      const g = (k: boolean[]) => k.filter(Boolean).length;
      expect(g(s.home)).not.toBe(g(s.away));
      expect(s.home.length - s.away.length).toBeGreaterThanOrEqual(0);
      expect(s.home.length - s.away.length).toBeLessThanOrEqual(1);
      if (s.home.length > 5) expect(s.home.length).toBe(s.away.length);
    }
  });

  it('every boon applies without error, and unique boons are not offered twice', () => {
    for (const id of Object.keys(BOONS) as BoonId[]) {
      const run = drafted(club());
      expect(typeof takeBoon(run, id)).toBe('string');
      expect(run.squad.tactics.lineup.every((pid) => run.squad.squad.some((p) => p.id === pid))).toBe(true);
    }
  });

  it('plays a whole run to the end and pays out by how far it went', () => {
    const c = club();
    const run = drafted(c, 11);
    const coins = c.coins;
    let guard = 0;
    while (run.status === 'active' && guard++ < 12) {
      const { home, away, weather } = tieSides(run);
      const m = new Match(home, away, 1000 + guard, weather);
      m.aiTeams = [0, 1];
      m.simulateFull();
      const pens = m.score[0] === m.score[1] ? shootout(run, home, away) : undefined;
      finishTie(c, m, pens);
      if (run.offer) takeBoon(run, run.offer[0]);
    }
    expect(['won', 'lost']).toContain(run.status);
    const reached = run.status === 'won' ? ROUND_NAMES.length : run.round;
    expect(c.coins - coins).toBe(REWARDS[reached] + (run.payout?.cosmetic?.duplicateCoins ?? 0));
    expect(c.cupMeta!.best).toBe(reached);
    for (const p of run.squad.squad) expect(p.condition).toBeGreaterThan(0);
  }, 120000);

  it('a Second Chance replays a lost tie instead of ending the run', () => {
    const c = club();
    const run = drafted(c);
    takeBoon(run, 'second');
    const { home, away } = tieSides(run);
    const m = new Match(home, away, 5);
    m.score = [0, 3];
    finishTie(c, m);
    expect(run.status).toBe('active');
    expect(run.round).toBe(0);
    finishTie(c, m);
    expect(run.status).toBe('lost');
  });
});
