import { h } from './dom';
import { playerCard } from './playerCard';
import type { LevelUp, MatchReport } from '../game/club';
import { SKILLS } from '../data/skills';
import { sound } from '../audio/sound';
import { ATTR_NAME } from './squadScreen';

const ratingClass = (r: number) => (r >= 8 ? 'r-elite' : r >= 7 ? 'r-good' : r >= 6 ? 'r-ok' : 'r-poor');

/** "+2 Finishing, +1 Pace · New skill: 💥 Power Shot" */
function gainText(l: LevelUp): string {
  const counts = new Map<string, number>();
  for (const k of l.gains) counts.set(ATTR_NAME[k], (counts.get(ATTR_NAME[k]) ?? 0) + 1);
  const stats = [...counts].map(([name, n]) => `+${n} ${name}`).join(', ');
  const skill = l.skill ? SKILLS[l.skill as keyof typeof SKILLS] : null;
  return skill ? `${stats} · New skill: ${skill.icon} ${skill.name}` : stats;
}

/** Post-match: result, rewards, ratings, man of the match and level-ups. */
export function reportScreen(rep: MatchReport, club: { name: string; color: string }, onContinue: () => void): HTMLElement {
  const label = rep.result === 'W' ? 'VICTORY' : rep.result === 'D' ? 'DRAW' : 'DEFEAT';
  const coinEl = h('b', { class: 'coin big-coin' }, '0');
  // Count the coins up for a bit of payoff.
  const start = performance.now();
  let lastChime = 0;
  const tick = () => {
    const t = Math.min(1, (performance.now() - start) / 1200);
    coinEl.textContent = Math.round(rep.coins.total * (1 - Math.pow(1 - t, 3))).toLocaleString();
    if (t < 1 && performance.now() - lastChime > 110) {
      lastChime = performance.now();
      sound.coin();
    }
    if (t < 1 && coinEl.isConnected) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  return h(
    'div',
    { class: 'screen report fade-in' },
    h(
      'div',
      { class: `report-hero res-${rep.result}` },
      h('div', { class: 'res-label' }, label),
      h('div', { class: 'res-score' }, h('span', {}, club.name), h('b', {}, `${rep.score[0]} – ${rep.score[1]}`), h('span', {}, rep.opponent)),
    ),
    h(
      'div',
      { class: 'report-grid' },
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'sub-title' }, 'Rewards'),
        h('div', { class: 'reward-row' }, h('span', {}, `Result (${label.toLowerCase()})`), h('b', { class: 'coin' }, rep.coins.result)),
        h('div', { class: 'reward-row' }, h('span', {}, 'Goal bonus'), h('b', { class: 'coin' }, rep.coins.goals)),
        h('div', { class: 'reward-row total' }, h('span', {}, 'Total'), coinEl),
        rep.levelUps.length
          ? h(
              'div',
              { class: 'levelups' },
              h('div', { class: 'sub-title' }, 'Level up!'),
              ...rep.levelUps.map((l) => h('div', { class: 'lvl-row pop-in' }, h('b', {}, `${l.player.name} · Lv ${l.level}`), h('span', {}, gainText(l)))),
            )
          : null,
      ),
      rep.motm
        ? h(
            'section',
            { class: 'panel motm' },
            h('div', { class: 'sub-title' }, 'Player of the match'),
            h('div', { class: 'motm-body' }, playerCard(rep.motm.player, { size: 'md', badge: rep.motm.rating.toFixed(1) }), h('div', { class: 'motm-line' }, rep.motm.goals ? `${rep.motm.goals} goal${rep.motm.goals > 1 ? 's' : ''}` : '', rep.motm.assists ? ` ${rep.motm.assists} assist${rep.motm.assists > 1 ? 's' : ''}` : '')),
          )
        : null,
      h(
        'section',
        { class: 'panel ratings' },
        h('div', { class: 'sub-title' }, 'Ratings'),
        ...rep.ratings.map((r) =>
          h(
            'div',
            { class: 'rating-row' },
            h('span', { class: 'rr-pos' }, r.player.positions[0]),
            h('span', { class: 'rr-name' }, r.player.name, r.goals ? h('i', { class: 'rr-ico' }, ' ⚽'.repeat(r.goals)) : null, r.assists ? h('i', { class: 'rr-ico' }, ' 🅰'.repeat(r.assists)) : null),
            h('span', { class: 'muted' }, `${r.minutes}'`),
            h('b', { class: `rr-rating ${ratingClass(r.rating)}` }, r.rating.toFixed(1)),
          ),
        ),
      ),
    ),
    h('div', { class: 'report-actions' }, h('button', { class: 'primary big', onclick: onContinue }, 'Continue')),
  );
}
