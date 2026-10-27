import { describe, expect, it } from 'vitest';
import { Rng } from '../src/sim/rng';
import { makeTeam } from '../src/data/generator';
import type { Club } from '../src/game/club';
import {
  DIVISIONS,
  LEAGUE_SIZE,
  YOU,
  finishSeason,
  makeFixtures,
  recordUserResult,
  rounds,
  seasonOutcome,
  seasonOver,
  simulateRound,
  standings,
  startSeason,
  userFixture,
} from '../src/game/career';

function club(): Club {
  return {
    version: 2,
    team: makeTeam(new Rng(3), 'Your Club', 'YOU', '#e63946', 62),
    coins: 0,
    matchesPlayed: 0,
    record: { w: 0, d: 0, l: 0, gf: 0, ga: 0 },
    results: [],
  };
}

describe('fixtures', () => {
  it('has every club play every other twice, once at home, one game per matchday', () => {
    const ids = Array.from({ length: LEAGUE_SIZE }, (_, i) => `c${i}`);
    const fx = makeFixtures(ids, new Rng(1));
    expect(fx).toHaveLength(LEAGUE_SIZE * (LEAGUE_SIZE - 1));
    const pairs = new Set(fx.map((f) => `${f.home}>${f.away}`));
    expect(pairs.size).toBe(fx.length);
    for (const a of ids) for (const b of ids) if (a !== b) expect(pairs.has(`${a}>${b}`)).toBe(true);
    for (let r = 0; r < (LEAGUE_SIZE - 1) * 2; r++) {
      const day = fx.filter((f) => f.round === r).flatMap((f) => [f.home, f.away]);
      expect(new Set(day).size).toBe(LEAGUE_SIZE);
    }
  });
});

describe('season', () => {
  it('builds a division of clubs in its rating range, including yours', () => {
    const c = startSeason(club(), 1, 1, [], 42);
    expect(c.teams).toHaveLength(LEAGUE_SIZE);
    expect(c.teams.filter((t) => t.id === YOU)).toHaveLength(1);
    for (const t of c.teams.filter((t) => t.id !== YOU)) {
      expect(t.rating).toBeGreaterThanOrEqual(DIVISIONS[1].rating[0] - 1);
      expect(t.rating).toBeLessThanOrEqual(DIVISIONS[1].rating[1] + 1);
      expect(t.setup!.squad.length).toBeGreaterThan(15);
    }
  });

  it('plays a full season and keeps the table consistent', async () => {
    const cl = club();
    cl.career = startSeason(cl, 0, 1, [], 7);
    const c = cl.career;
    while (!seasonOver(c)) {
      recordUserResult(c, 2, 1); // the user wins every game
      await simulateRound(c);
    }
    expect(c.fixtures.every((f) => f.score)).toBe(true);
    const table = standings(c);
    const games = rounds();
    for (const r of table) {
      expect(r.p).toBe(games);
      expect(r.w + r.d + r.l).toBe(games);
      expect(r.pts).toBe(r.w * 3 + r.d);
    }
    expect(table.reduce((s, r) => s + r.gd, 0)).toBe(0);
    expect(table[0].team.id).toBe(YOU);
    expect(table[0].pts).toBe(games * 3);
  }, 120000);

  it('promotes the top two and relegates the bottom two, paying prize money', () => {
    const cl = club();
    cl.career = startSeason(cl, 1, 1, [], 9);
    const c = cl.career;
    // Fake a finished season where the user wins everything.
    for (const f of c.fixtures) f.score = f.home === YOU ? [3, 0] : f.away === YOU ? [0, 3] : [1, 1];
    c.round = rounds();
    expect(seasonOutcome(c).outcome).toBe('promoted');
    const rec = finishSeason(cl, 5);
    expect(rec.position).toBe(1);
    expect(cl.coins).toBe(DIVISIONS[1].prize);
    expect(cl.career!.tier).toBe(2);
    expect(cl.career!.season).toBe(2);
    expect(cl.career!.history).toHaveLength(1);
    expect(userFixture(cl.career!)).not.toBeNull();

    // Now lose everything: relegated back down.
    const d = cl.career!;
    for (const f of d.fixtures) f.score = f.home === YOU ? [0, 3] : f.away === YOU ? [3, 0] : [1, 1];
    d.round = rounds();
    expect(seasonOutcome(d).outcome).toBe('relegated');
    finishSeason(cl, 6);
    expect(cl.career!.tier).toBe(1);
  });

  it('crowns champions in the top division and keeps you in the bottom one', () => {
    const cl = club();
    cl.career = startSeason(cl, DIVISIONS.length - 1, 1, [], 11);
    for (const f of cl.career.fixtures) f.score = f.home === YOU ? [2, 0] : f.away === YOU ? [0, 2] : [0, 0];
    cl.career.round = rounds();
    expect(seasonOutcome(cl.career).outcome).toBe('champions');

    cl.career = startSeason(cl, 0, 1, [], 12);
    for (const f of cl.career.fixtures) f.score = f.home === YOU ? [0, 2] : f.away === YOU ? [2, 0] : [0, 0];
    cl.career.round = rounds();
    expect(seasonOutcome(cl.career).outcome).toBe('stayed');
  });
});
