import './style.css';
import { h } from './ui/dom';
import { tacticsScreen } from './ui/tacticsScreen';
import { matchScreen } from './ui/matchScreen';
import { squadScreen } from './ui/squadScreen';
import { storeScreen } from './ui/storeScreen';
import { reportScreen } from './ui/reportScreen';
import { playerCard, setCardLook } from './ui/playerCard';
import { crestSvg } from './ui/art';
import { Rng } from './sim/rng';
import { TEAM_NAMES, TeamSetup, makeTeam, randomAiTactics } from './data/generator';
import { overall } from './data/player';
import { contrastingKit } from './data/kits';
import { cloneTactics } from './tactics/instructions';
import { Club, applyMatch, loadClub, newClub, saveClub, squadRating } from './game/club';
import { Weather, rollWeather, windLabel } from './sim/weather';
import { sound } from './audio/sound';
import { loadSkillIcons } from './ui/skillIcons';
import { careerScreen, roundScreen } from './ui/careerScreen';
import { DIVISIONS, finishSeason, matchSide, nextOpponent, recordUserResult, rounds, seasonOver, simulateRound, startSeason, userFixture } from './game/career';
import { Match } from './sim/match';

const app = document.getElementById('app')!;
let teardown: (() => void) | null = null;

function show(el: HTMLElement, destroy?: () => void): void {
  teardown?.();
  teardown = destroy ?? null;
  app.replaceChildren(el);
  window.scrollTo(0, 0);
}

let club: Club = loadClub() ?? newClub();
setCardLook(club.team.kit!, club.team.crest!);

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
        h('div', { class: 'crest art', title: 'Club identity', onclick: () => show(squadScreen(club, home, coins, 'club')) }, crestSvg(team.crest!, team.kit!, team.short)),
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
        tile('🎴', 'Recruit', 'Players, kits, balls & crests', () => show(storeScreen(club, home, coins))),
        tile('🎽', 'Club', 'Name, kits, crest & ball', () => show(squadScreen(club, home, coins, 'club'))),
        tile('🏆', 'Career', careerBlurb(), careerHub),
        tile('🎲', 'Cup Run', 'Roguelike runs · coming soon', null),
        tile('♻', 'New club', 'Start over', () => {
          if (confirm('Start over with a brand new club? Your current progress will be lost.')) {
            club = newClub();
            setCardLook(club.team.kit!, club.team.crest!);
            home();
          }
        }),
      ),
    ),
  );
}

/** Career tile subtitle: where the season stands. */
function careerBlurb(): string {
  const c = club.career;
  if (!c) return 'Leagues, promotion & prize money';
  return seasonOver(c) ? `${DIVISIONS[c.tier].name} · season over` : `${DIVISIONS[c.tier].name} · MD ${c.round + 1}/${rounds(c)}`;
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

const newWeather = () => rollWeather(new Rng((Date.now() * 104729) >>> 0));

/** What a match is for: a friendly by default, or a league fixture that reports back when done. */
interface MatchContext {
  label: string;
  /** After the match report; defaults to the home screen. */
  after: (m: Match) => void;
  back: () => void;
}

const FRIENDLY: MatchContext = { label: 'Friendly', after: () => home(), back: () => home() };

function preMatch(opp = makeOpponent(), weather = newWeather(), ctx: MatchContext = FRIENDLY): void {
  show(
    tacticsScreen({
      team: club.team,
      tactics: club.team.tactics,
      title: `vs ${opp.name}`,
      subtitle: `${ctx.label} · ${opp.tactics.formation} · ${STYLE_NAMES.get(opp)} · rating ${squadRating(opp)} · ${weather.icon} ${[weather.name, windLabel(weather)].filter(Boolean).join(' ')}: ${weather.tip}`,
      confirmLabel: 'Kick off',
      onConfirm: (t) => {
        club.team.tactics = t;
        saveClub(club);
        playMatch(opp, weather, ctx);
      },
      onCancel: ctx.back,
    }),
  );
}

/** Both sides for a match: copies (the match mutates tactics), away kit changed if it clashes. */
function sides(opp: TeamSetup): [TeamSetup, TeamSetup] {
  return [
    { ...club.team, tactics: cloneTactics(club.team.tactics) },
    { ...opp, color: contrastingKit(club.team.color, opp.color), tactics: cloneTactics(opp.tactics) },
  ];
}

function playMatch(opp: TeamSetup, weather: Weather, ctx: MatchContext): void {
  const [homeSide, awaySide] = sides(opp);
  const screen = matchScreen({
    home: homeSide,
    away: awaySide,
    seed: (Date.now() ^ (Math.random() * 1e9)) >>> 0,
    weather,
    onExit: (m) => {
      const report = applyMatch(club, m);
      show(reportScreen(report, club.team, () => ctx.after(m)));
    },
  });
  show(screen.el, screen.destroy);
}

// ---------------------------------------------------------------- career

function careerHub(): void {
  if (!club.career) {
    club.career = startSeason(club, 0, 1, []);
    saveClub(club);
  }
  // Your result is in but the rest of the matchday never finished (the app was closed): finish it.
  if (userFixture(club.career)?.score) return void playOutRound();
  show(
    careerScreen(club, {
      onBack: home,
      coinsEl: coins,
      onPlay: () => {
        const { opp, ctx } = leagueMatch();
        preMatch(opp, newWeather(), ctx);
      },
      onQuickSim: () => {
        // Play the user's fixture headless and go straight to the report.
        const { opp, ctx } = leagueMatch();
        const [homeSide, awaySide] = sides(opp);
        const m = new Match(homeSide, awaySide, (Date.now() ^ (Math.random() * 1e9)) >>> 0, newWeather());
        m.aiTeams = [0, 1];
        m.simulateFull();
        const report = applyMatch(club, m);
        show(reportScreen(report, club.team, () => ctx.after(m)));
      },
      onNextSeason: () => {
        const rec = finishSeason(club);
        saveClub(club);
        sound.reveal(rec.outcome === 'champions' || rec.outcome === 'promoted' ? 'elite' : 'silver');
        careerHub();
      },
    }),
  );
}

/** The current league fixture as a match: the opponent's side and how to carry on afterwards. */
function leagueMatch(): { opp: TeamSetup; ctx: MatchContext } {
  const c = club.career!;
  const nx = nextOpponent(c)!;
  const opp = matchSide(nx.team);
  STYLE_NAMES.set(opp, nx.team.style ?? '');
  return {
    opp,
    ctx: {
      label: `${DIVISIONS[c.tier].name} · Matchday ${c.round + 1} · ${nx.home ? 'Home' : 'Away'}`,
      after: (m) => void finishMatchday(m),
      back: careerHub,
    },
  };
}

/** Record the user's result, then play out the rest of the matchday on the results screen. */
async function finishMatchday(m: Match): Promise<void> {
  recordUserResult(club.career!, m.score[0], m.score[1]);
  saveClub(club);
  await playOutRound();
}

async function playOutRound(): Promise<void> {
  const c = club.career!;
  const screen = roundScreen(c, c.round);
  show(screen.el);
  await simulateRound(c, (_done, _total, f) => screen.update(f));
  saveClub(club);
  screen.done(careerHub);
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
