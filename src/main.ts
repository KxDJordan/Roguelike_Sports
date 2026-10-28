import './style.css';
import { h, toast } from './ui/dom';
import { tacticsScreen } from './ui/tacticsScreen';
import { matchScreen } from './ui/matchScreen';
import { squadScreen } from './ui/squadScreen';
import { storeScreen } from './ui/storeScreen';
import { reportScreen } from './ui/reportScreen';
import { playerCard, setCardLook } from './ui/playerCard';
import { crestSvg } from './ui/art';
import { IconName, icon } from './ui/icons';
import { stadiumBackdrop } from './ui/stadium';
import { Rng } from './sim/rng';
import { TEAM_NAMES, TeamSetup, makeTeam, randomAiTactics } from './data/generator';
import { overall } from './data/player';
import { contrastingKit } from './data/kits';
import { cloneTactics } from './tactics/instructions';
import { Club, applyMatch, loadClub, newClub, saveClub, squadRating } from './game/club';
import { Weather, rollWeather, windLabel } from './sim/weather';
import { sound } from './audio/sound';
import { loadSkillIcons } from './ui/skillIcons';
import { careerScreen, crest, roundScreen } from './ui/careerScreen';
import { DIVISIONS, finishSeason, matchSide, nextOpponent, recordUserResult, rounds, seasonOver, simulateRound, startSeason, userFixture } from './game/career';
import { Match } from './sim/match';
import { cupScreen, shootoutScreen } from './ui/cupScreen';
import { ROUND_NAMES, draftPick, finishTie, reachedName, shootout, startRun, takeBoon, tieSides } from './game/cup';

const app = document.getElementById('app')!;
let teardown: (() => void) | null = null;
let backdrop: HTMLElement | null = null;

function show(el: HTMLElement, destroy?: () => void): void {
  teardown?.();
  teardown = destroy ?? null;
  app.replaceChildren(el);
  // The stadium sits behind every screen; away from the main menu it is dimmed so dense screens stay readable.
  if (!backdrop) document.body.prepend((backdrop = stadiumBackdrop()));
  document.body.classList.toggle('dim', !el.classList.contains('home-stadium'));
  window.scrollTo(0, 0);
}

let club: Club = loadClub() ?? newClub();
setCardLook(club.team.kit!, club.team.crest!);

const coins = () => h('div', { class: 'coins' }, h('span', { class: 'coin' }, club.coins.toLocaleString()));

function home(): void {
  const team = club.team;
  const best = [...team.squad].sort((a, b) => overall(b) - overall(a))[0];
  const { w, d, l, gf, ga } = club.record;
  const led = (label: string, value: number | string) => h('div', { class: 'led' }, h('b', {}, String(value)), h('small', {}, label));
  show(
    h(
      'div',
      { class: 'screen home-stadium fade-in' },
      h(
        'div',
        { class: 'home' },
        h(
          'div',
          { class: 'home-top' },
          h('div', { class: 'logo' }, h('span', { class: 'logo-ball' }, icon('ball')), h('div', {}, h('span', {}, 'ROGUELIKE'), h('b', {}, 'SPORTS FC'), h('small', {}, 'FOOTBALL MANAGER'))),
          coins(),
        ),
        h(
          'div',
          { class: 'club-hero scoreboard', style: { '--kit': team.color } as unknown as Partial<CSSStyleDeclaration> },
          h('div', { class: 'crest art', title: 'Club identity', onclick: () => show(squadScreen(club, home, coins, 'club')) }, crestSvg(team.crest!, team.kit!, team.short)),
          h(
            'div',
            { class: 'club-meta' },
            h('b', {}, team.name),
            h('div', { class: 'muted' }, `${team.tactics.formation} · Rating ${squadRating(team)} · ${team.squad.length} players`),
            h('div', { class: 'leds' }, led('W', w), led('D', d), led('L', l), led('GOALS', `${gf}:${ga}`)),
            h('div', { class: 'results' }, ...club.results.slice(-5).map((r) => h('i', { class: `res res-${r}` }, r))),
          ),
          h('div', { class: 'hero-card' }, playerCard(best, { size: 'sm', badge: 'STAR' })),
        ),
        nextUp(),
        h(
          'button',
          { class: 'primary big play-btn', onclick: () => preMatch() },
          h('span', { class: 'kick-ball' }, icon('ball')),
          h('span', { class: 'kick-text' }, h('span', {}, 'KICK OFF'), h('small', {}, 'Friendly · earn coins & XP')),
        ),
        h(
          'div',
          { class: 'tile-grid' },
          tile('tactics', 'Tactics', 'Formation, roles, instructions', () => editTactics()),
          tile('squad', 'Squad', 'Train, rest and sell players', () => show(squadScreen(club, home, coins))),
          tile('recruit', 'Recruit', 'Players, kits, balls & crests', () => show(storeScreen(club, home, coins))),
          tile('club', 'Club', 'Name, kits, crest & ball', () => show(squadScreen(club, home, coins, 'club'))),
          tile('career', 'Career', careerBlurb(), careerHub),
          tile('cup', 'Cup Run', cupBlurb(), cupHub),
        ),
        adBoard(),
        // Starting over wipes everything, so it's a quiet link rather than a big tile.
        h(
          'button',
          {
            class: 'ghost-btn new-club',
            onclick: () => {
              if (confirm('Start over with a brand new club? Your current progress will be lost.')) {
                club = newClub();
                setCardLook(club.team.kit!, club.team.crest!);
                home();
              }
            },
          },
          icon('restart'),
          'Start a new club',
        ),
      ),
    ),
  );
}

/** The next fixture, when a league season is on. */
function nextUp(): HTMLElement | null {
  const c = club.career;
  if (!c || seasonOver(c)) return null;
  const nx = nextOpponent(c);
  if (!nx) return null;
  return h(
    'button',
    { class: 'next-up', onclick: careerHub },
    h('span', { class: 'nu-label' }, 'NEXT UP'),
    h('span', { class: 'nu-teams' }, crest({ short: club.team.short, color: club.team.color }), h('b', {}, 'v'), crest(nx.team)),
    h('span', { class: 'nu-info' }, h('b', {}, nx.team.name), h('small', {}, `${DIVISIONS[c.tier].name} · Matchday ${c.round + 1} · ${nx.home ? 'Home' : 'Away'}`)),
    h('span', { class: 'nu-go' }, '›'),
  );
}

/** A scrolling LED advertising board along the bottom of the menu. */
function adBoard(): HTMLElement {
  const c = club.career;
  const items = [
    club.team.name.toUpperCase(),
    c ? `${DIVISIONS[c.tier].name.toUpperCase()} · SEASON ${c.season}` : 'START YOUR CAREER · CLIMB TO THE ELITE LEAGUE',
    'NEW KITS · BALLS · CRESTS IN EVERY GOLD PACK',
    `RECORD W${club.record.w} D${club.record.d} L${club.record.l}`,
    'ROGUELIKE SPORTS FC',
  ];
  const run = () => h('span', { class: 'ad-run' }, ...items.flatMap((t) => [h('b', {}, t), h('i', {}, '✦')]));
  return h('div', { class: 'ad-board', 'aria-hidden': 'true' }, h('div', { class: 'ad-track' }, run(), run()));
}

/** Career tile subtitle: where the season stands. */
function careerBlurb(): string {
  const c = club.career;
  if (!c) return 'Leagues, promotion & prize money';
  return seasonOver(c) ? `${DIVISIONS[c.tier].name} · season over` : `${DIVISIONS[c.tier].name} · MD ${c.round + 1}/${rounds(c)}`;
}

function tile(name: IconName, title: string, sub: string, onclick: (() => void) | null): HTMLElement {
  return h('button', { class: 'tile', disabled: !onclick, onclick: onclick ?? undefined }, h('span', { class: 'tile-ico' }, icon(name)), h('b', {}, title), h('small', {}, sub));
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

// ---------------------------------------------------------------- cup runs

/** Cup tile subtitle: the run in progress, or the best so far. */
function cupBlurb(): string {
  const run = club.cup;
  if (run?.status === 'draft') return 'Draft in progress';
  if (run?.status === 'active') return `${ROUND_NAMES[run.round]} next`;
  const meta = club.cupMeta;
  return meta && meta.runs ? `${reachedName(meta.best)} · ${meta.cupsWon} cup${meta.cupsWon === 1 ? '' : 's'}` : 'Draft a squad · win 5 knockout ties';
}

function cupHub(): void {
  show(
    cupScreen(club, {
      onBack: home,
      coinsEl: coins,
      onStart: (formation) => {
        if (!startRun(club, formation)) return toast('Not enough coins');
        saveClub(club);
        cupHub();
      },
      onPick: (i) => {
        draftPick(club.cup!, i);
        saveClub(club);
        cupHub();
      },
      onTactics: () => {
        const run = club.cup!;
        show(
          tacticsScreen({
            team: run.squad,
            tactics: run.squad.tactics,
            title: 'Cup squad',
            subtitle: `${ROUND_NAMES[run.round]} next · fitness carries over between ties, so rotate tired legs`,
            confirmLabel: 'Save',
            onConfirm: (t) => {
              run.squad.tactics = t;
              saveClub(club);
              cupHub();
            },
            onCancel: cupHub,
          }),
        );
      },
      onPlay: () => {
        const run = club.cup!;
        const { home: homeSide, away, weather } = tieSides(run);
        const screen = matchScreen({
          home: homeSide,
          away: { ...away, color: contrastingKit(homeSide.color, away.color) },
          seed: (Date.now() ^ (Math.random() * 1e9)) >>> 0,
          weather,
          onExit: (m) => afterTie(m, homeSide, away),
        });
        show(screen.el, screen.destroy);
      },
      onQuickSim: () => {
        const run = club.cup!;
        const { home: homeSide, away, weather } = tieSides(run);
        const m = new Match(homeSide, away, (Date.now() ^ (Math.random() * 1e9)) >>> 0, weather);
        m.aiTeams = [0, 1];
        m.simulateFull();
        toast(`${ROUND_NAMES[run.round]}: ${homeSide.short} ${m.score[0]}–${m.score[1]} ${away.short}`);
        afterTie(m, homeSide, away);
      },
      onBoon: (id) => {
        const msg = takeBoon(club.cup!, id);
        saveClub(club);
        sound.reveal('gold');
        toast(msg);
        cupHub();
      },
      onNewRun: () => {
        club.cup = undefined;
        saveClub(club);
        cupHub();
      },
    }),
  );
}

/** A tie is over: a drawn one goes to penalties, then the run moves on (or ends). */
function afterTie(m: Match, homeSide: TeamSetup, away: TeamSetup): void {
  const run = club.cup!;
  const settle = (pens?: { home: boolean[]; away: boolean[] }) => {
    finishTie(club, m, pens);
    saveClub(club);
    if (run.status === 'won') sound.goal(true);
    cupHub();
  };
  if (m.score[0] !== m.score[1]) return settle();
  const pens = shootout(run, homeSide, away);
  show(shootoutScreen(homeSide, away, pens, () => settle(pens)));
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
