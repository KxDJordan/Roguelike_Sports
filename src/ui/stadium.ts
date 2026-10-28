import { h } from './dom';
import { svg } from './art';

/**
 * The stadium behind every screen: night sky, floodlights, a packed crowd with camera flashes, and
 * the pitch in perspective with its markings.
 */
export function stadiumBackdrop(): HTMLElement {
  const flashes = Array.from({ length: 14 }, (_, i) =>
    h('i', { class: 'flash', style: { left: `${(i * 37) % 100}%`, top: `${20 + ((i * 53) % 60)}%`, animationDelay: `${(i * 0.73) % 5}s` } }),
  );
  return h(
    'div',
    { class: 'stadium-bg', 'aria-hidden': 'true' },
    h('div', { class: 'sky' }),
    h('div', { class: 'floodlight left' }),
    h('div', { class: 'floodlight right' }),
    h('div', { class: 'crowd' }, ...flashes),
    h('div', { class: 'pitch-wrap' }, h('div', { class: 'pitch-plane' }, pitchLines())),
  );
}

function pitchLines(): SVGSVGElement {
  return svg(
    `<svg viewBox="0 0 68 105" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="rgba(255,255,255,0.75)" stroke-width="0.45">
      <rect x="1" y="1" width="66" height="103"/>
      <line x1="1" y1="52.5" x2="67" y2="52.5"/>
      <circle cx="34" cy="52.5" r="9.15"/>
      <circle cx="34" cy="52.5" r="0.6" fill="rgba(255,255,255,0.75)"/>
      <rect x="13.8" y="1" width="40.3" height="16.5"/>
      <rect x="24.8" y="1" width="18.3" height="5.5"/>
      <rect x="13.8" y="87.5" width="40.3" height="16.5"/>
      <rect x="24.8" y="98.5" width="18.3" height="5.5"/>
      <path d="M26.7 17.5 A9.15 9.15 0 0 0 41.3 17.5 M26.7 87.5 A9.15 9.15 0 0 1 41.3 87.5"/>
    </svg>`,
    'pitch-lines',
  );
}

