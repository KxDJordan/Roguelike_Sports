import { describe, expect, it } from 'vitest';
import { Rng } from '../src/sim/rng';
import { Match } from '../src/sim/match';
import { makeTeam } from '../src/data/generator';
import { overall, xpToNext } from '../src/data/player';
import { cloneTactics } from '../src/tactics/instructions';
import { Club, MIN_SQUAD, applyMatch, collectCosmetic, ensureLocker, equip, renameClub, sellPlayer, trainAttribute } from '../src/game/club';
import { STARTER, kitById } from '../src/data/cosmetics';
import { startSeason } from '../src/game/career';
import { PACKS, openCosmetic, openPack } from '../src/game/packs';
import { playerRating } from '../src/game/ratings';

function club(seed = 11): Club {
  const rng = new Rng(seed);
  return {
    version: 2,
    team: makeTeam(rng, 'Club', 'CLB', '#e63946', 62),
    coins: 1000,
    matchesPlayed: 0,
    record: { w: 0, d: 0, l: 0, gf: 0, ga: 0 },
    results: [],
  };
}

function playFor(c: Club, seed: number): Match {
  const rng = new Rng(seed);
  const opp = makeTeam(rng, 'Opp', 'OPP', '#3a86ff', 62);
  const m = new Match({ ...c.team, tactics: cloneTactics(c.team.tactics) }, opp, seed);
  m.simulateFull();
  return m;
}

describe('match ratings', () => {
  it('rates every player between 3 and 10, scorers above average', () => {
    const c = club();
    const m = playFor(c, 21);
    for (const p of m.players) {
      const r = playerRating(m, p);
      expect(r).toBeGreaterThanOrEqual(3);
      expect(r).toBeLessThanOrEqual(10);
      // A red card (-1.8) can outweigh a goal, so only judge scorers who stayed on.
      if (p.ps.goals >= 1 && !p.ps.red) expect(r).toBeGreaterThan(6.5);
    }
  });
});

describe('applyMatch', () => {
  it('pays coins, records the result and updates form, fitness and XP', () => {
    const c = club();
    const before = c.coins;
    const m = playFor(c, 4);
    const rep = applyMatch(c, m);
    expect(c.coins - before).toBe(rep.coins.total);
    expect(c.matchesPlayed).toBe(1);
    expect(c.results).toHaveLength(1);
    const starter = c.team.squad.find((p) => p.id === c.team.tactics.lineup[5])!;
    expect(starter.form).toHaveLength(1);
    expect(starter.condition).toBeLessThan(1);
    expect(starter.xp + (starter.level - 1) * xpToNext(1)).toBeGreaterThan(0);
    expect(rep.motm).not.toBeNull();
  });
});

describe('progression', () => {
  it('spends a skill point to raise an attribute', () => {
    const c = club();
    const p = c.team.squad[3];
    p.skillPoints = 1;
    const was = p.attrs.tackling;
    expect(trainAttribute(c, p, 'tackling')).toBe(true);
    expect(p.attrs.tackling).toBe(was + 1);
    expect(trainAttribute(c, p, 'tackling')).toBe(false);
  });

  it('sells a starter, refills the XI and respects the squad minimum', () => {
    const c = club();
    const starterId = c.team.tactics.lineup[9];
    const p = c.team.squad.find((q) => q.id === starterId)!;
    const coins = c.coins;
    expect(sellPlayer(c, p)).toBe(true);
    expect(c.coins).toBeGreaterThan(coins);
    expect(c.team.tactics.lineup).not.toContain(starterId);
    expect(new Set(c.team.tactics.lineup).size).toBe(11);
    while (c.team.squad.length > MIN_SQUAD) sellPlayer(c, c.team.squad[c.team.squad.length - 1]);
    expect(sellPlayer(c, c.team.squad[0])).toBe(false);
  });
});

describe('packs', () => {
  it('gold packs give better players than bronze packs', () => {
    const avg = (id: string) => {
      const pack = PACKS.find((p) => p.id === id)!;
      let s = 0;
      for (let i = 0; i < 20; i++) s += openPack(new Rng(i + 1), pack, new Set()).reduce((a, p) => a + overall(p), 0) / pack.count;
      return s / 20;
    };
    expect(avg('gold')).toBeGreaterThan(avg('bronze') + 12);
  });

  it('assigns unique shirt numbers and ids', () => {
    const taken = new Set([1, 2, 3]);
    const players = openPack(new Rng(5), PACKS[2], taken);
    const numbers = players.map((p) => p.number);
    expect(new Set(numbers).size).toBe(players.length);
    for (const n of numbers) expect([1, 2, 3]).not.toContain(n);
    expect(new Set(players.map((p) => p.id)).size).toBe(players.length);
  });
});

describe('defensive AI', () => {
  it('blocks shots and intercepts passes', () => {
    const c = club();
    let blocks = 0;
    let interceptions = 0;
    for (let i = 0; i < 4; i++) {
      const m = playFor(c, 100 + i);
      blocks += m.stats[0].blocks + m.stats[1].blocks;
      interceptions += m.stats[0].interceptions + m.stats[1].interceptions;
    }
    expect(blocks / 4).toBeGreaterThan(2);
    expect(interceptions / 4).toBeGreaterThan(8);
  });
});

describe('club identity and cosmetics', () => {
  it('starts with the starter kit, ball and crest, and wears them', () => {
    const c = club();
    ensureLocker(c);
    expect(c.look).toEqual({ kit: STARTER.kit, ball: STARTER.ball, crest: STARTER.crest });
    expect(c.team.color).toBe(kitById(STARTER.kit).primary);
    expect(c.team.kit?.pattern).toBe('solid');
    expect(c.team.ball).toBe(STARTER.ball);
  });

  it('collects new items, pays coins for duplicates, and equips only what it owns', () => {
    const c = club();
    ensureLocker(c);
    const coins = c.coins;
    expect(equip(c, 'kit', 'magpie')).toBe(false);
    expect(collectCosmetic(c, 'kit', 'magpie')).toBe(0);
    expect(c.locker!.kit).toContain('magpie');
    expect(collectCosmetic(c, 'kit', 'magpie')).toBeGreaterThan(0);
    expect(c.coins).toBeGreaterThan(coins);
    expect(equip(c, 'kit', 'magpie')).toBe(true);
    expect(c.team.kit).toEqual({ primary: '#111111', secondary: '#f5f5f5', pattern: 'stripes' });
    expect(c.team.color).toBe('#111111');
  });

  it('renames the club, validating the name and 3-letter code, and updates the league table', () => {
    const c = club();
    c.career = startSeason(c, 0, 1, [], 3);
    expect(renameClub(c, 'X', 'ABC')).not.toBeNull();
    expect(renameClub(c, 'Real Roguelike', 'RR')).not.toBeNull();
    expect(renameClub(c, '  Real   Roguelike ', 'rrl')).toBeNull();
    expect(c.team.name).toBe('Real Roguelike');
    expect(c.team.short).toBe('RRL');
    expect(c.career.teams.find((t) => t.id === 'you')!.short).toBe('RRL');
  });

  it('gold packs always hold a cosmetic; bronze ones sometimes', () => {
    const gold = PACKS.find((p) => p.id === 'gold')!;
    const bronze = PACKS.find((p) => p.id === 'bronze')!;
    let goldHits = 0;
    let bronzeHits = 0;
    for (let i = 0; i < 60; i++) {
      if (openCosmetic(new Rng(i + 1), gold)) goldHits++;
      if (openCosmetic(new Rng(i + 1), bronze)) bronzeHits++;
    }
    expect(goldHits).toBe(60);
    expect(bronzeHits).toBeGreaterThan(5);
    expect(bronzeHits).toBeLessThan(40);
  });
});
