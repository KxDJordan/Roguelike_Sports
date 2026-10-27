import './style.css';
import { h } from './ui/dom';
import { tacticsScreen } from './ui/tacticsScreen';
import { matchScreen } from './ui/matchScreen';
import { squadScreen } from './ui/squadScreen';
import { storeScreen } from './ui/storeScreen';
import { reportScreen } from './ui/reportScreen';
import { playerCard } from './ui/playerCard';
import { Rng } from './sim/rng';
import { TEAM_NAMES, TeamSetup, makeTeam, randomAiTactics } from './data/generator';
import { overall } from './data/player';
import { contrastingKit } from './data/kits';
import { cloneTactics } from './tactics/instructions';
import { Club, applyMatch, loadClub, newClub, saveClub, squadRating } from './game/club';
import { Weather, rollWeather, windLabel } from './sim/weather';
import { sound } from './audio/sound';
import { loadSkillIcons } from './ui/skillIcons';

const app = document.getElementById('app')!;
let teardown: (() => void) | null = null;

function show(el: HTMLElement, destroy?: () => void): void {
  teardown?.();
  teardown = destroy ?? null;
  app.replaceChildren(el);
  window.scrollTo(0, 0);
}

let club: Club = loadClub() ?? newClub();

const coins = () => h('div', { class: 'coins' }, h('span', { class: 'coin' }, club.coins.toLocaleString()));

function home(): void {
  const team = club.team;
  const best = [...team.squad].sort((a, b) => overall(b) - overall(a))[0];
  const { w, d, l, gf, ga } = club.record;
  show(
    h(
      'div',
      { class: 'screen home fade-in' },
      h('div', { class: 'home-top' }, h('div', { class: 'logo' }, h('span', {}, 'ROGUELIKE'), h('b', {}, 'SPORTS'), h('small', {}, 'FOOTBALL MANAGER')), coins()),
      h(
        'div',
        { class: 'club-hero', style: { '--kit': team.color } as unknown as Partial<CSSStyleDeclaration> },
        h('div', { class: 'crest' }, h('span', {}, team.short)),
        h(
          'div',
          { class: 'club-meta' },
          h('b', {}, team.name),
          h('div', { class: 'muted' }, `${team.tactics.formation} · Rating ${squadRating(team)} · ${team.squad.length} players`),
          h('div', { class: 'record' }, `W${w} D${d} L${l} · ${gf}:${ga}`),
          h('div', { class: 'results' }, ...club.results.slice(-5).map((r) => h('i', { class: `res res-${r}` }, r))),
        ),
        h('div', { class: 'hero-card' }, playerCard(best, { size: 'sm', badge: 'STAR' })),
      ),
      h('button', { class: 'primary big play-btn', onclick: () => preMatch() }, h('span', {}, 'PLAY MATCH'), h('small', {}, 'Friendly · earn coins & XP')),
      h(
        'div',
        { class: 'tile-grid' },
        tile('🧠', 'Tactics', 'Formation, roles, instructions', () => editTactics()),
        tile('👥', 'Squad', 'Train, rest and sell players', () => show(squadScreen(club, home, coins))),
        tile('🎴', 'Recruit', 'Open player packs', () => show(storeScreen(club, home, coins))),
        tile('🏆', 'Career', 'Coming next phase', null),
        tile('🎲', 'Cup Run', 'Roguelike runs · coming soon', null),
        tile('♻', 'New club', 'Start over', () => {
          if (confirm('Start over with a brand new club? Your current progress will be lost.')) {
            club = newClub();
            home();
          }
        }),
      ),
    ),
  );
}

function tile(icon: string, title: string, sub: string, onclick: (() => void) | null): HTMLElement {
  return h('button', { class: 'tile', disabled: !onclick, onclick: onclick ?? undefined }, h('span', { class: 'tile-ico' }, icon), h('b', {}, title), h('small', {}, sub));
}

function editTactics(): void {
  show(
    tacticsScreen({
      team: club.team,
      tactics: club.team.tactics,
      title: 'Tactics',
      confirmLabel: 'Save',
      onConfirm: (t) => {
        club.team.tactics = t;
        saveClub(club);
        home();
      },
      onCancel: home,
    }),
  );
}

const STYLE_NAMES = new Map<TeamSetup, string>();

function makeOpponent(): TeamSetup {
  const rng = new Rng((Date.now() * 7919) >>> 0);
  const pick = rng.pick(TEAM_NAMES);
  const opp = makeTeam(rng, pick.name, pick.short, pick.color, squadRating(club.team) + rng.int(-4, 4));
  STYLE_NAMES.set(opp, randomAiTactics(rng, opp));
  return opp;
}

function preMatch(opp = makeOpponent(), weather = rollWeather(new Rng((Date.now() * 104729) >>> 0))): void {
  show(
    tacticsScreen({
      team: club.team,
      tactics: club.team.tactics,
      title: `vs ${opp.name}`,
      subtitle: `${opp.tactics.formation} · ${STYLE_NAMES.get(opp)} · rating ${squadRating(opp)} · ${weather.icon} ${[weather.name, windLabel(weather)].filter(Boolean).join(" ")}: ${weather.tip}`,
      confirmLabel: 'Kick off',
      onConfirm: (t) => {
        club.team.tactics = t;
        saveClub(club);
        playMatch(opp, weather);
      },
      onCancel: home,
    }),
  );
}

function playMatch(opp: TeamSetup, weather: Weather): void {
  // The match mutates tactics (subs, AI half-time changes), so give it copies.
  const homeSide = { ...club.team, tactics: cloneTactics(club.team.tactics) };
  // Away side changes kit if the colours are too close to tell apart.
  const awaySide = { ...opp, color: contrastingKit(club.team.color, opp.color), tactics: cloneTactics(opp.tactics) };
  const screen = matchScreen({
    home: homeSide,
    away: awaySide,
    seed: (Date.now() ^ (Math.random() * 1e9)) >>> 0,
    weather,
    onExit: (m) => {
      const report = applyMatch(club, m);
      show(reportScreen(report, club.team, home));
    },
  });
  show(screen.el, screen.destroy);
}

// Browsers only allow audio after a user gesture: wake it on the first tap, and give the main buttons a click.
document.addEventListener(
  'pointerdown',
  (e) => {
    sound.unlock();
    if ((e.target as HTMLElement).closest('.primary, .tile, .seg button')) sound.click();
  },
  true,
);

// Skill artwork is prepared before the first screen so cards show it straight away.
void loadSkillIcons().then(home);
