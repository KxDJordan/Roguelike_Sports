import { svg } from './art';

/**
 * Line icons for the main menu, drawn in the current text colour so they can be tinted with CSS.
 * 24x24 grid, 1.8px strokes, rounded joins.
 */

const wrap = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

const ICONS = {
  /** Tactics board: a clipboard with a pitch, an X, an O and a run arrow. */
  tactics: `<rect x="4" y="3.5" width="16" height="18" rx="2"/><path d="M9 3.5h6v2.5H9z"/><path d="M4 12.5h16"/><circle cx="12" cy="12.5" r="2"/><path d="M7.5 8l2 2M9.5 8l-2 2"/><circle cx="16" cy="17" r="1.4"/><path d="M8 18c1.5-2.5 4-3 6.5-1.5"/><path d="M14 15.3l.6 1.3-1.4.4"/>`,
  /** Squad: two players' shirts. */
  squad: `<path d="M3.5 9l3-3h3c.3 1.2 1 2 2 2s1.7-.8 2-2h3l3 3-2 2-1.3-1v9.5h-9.5V10L5.5 11z" opacity=".45"/><path d="M6 11l3-3h2.5c.3 1 1 1.7 2 1.7s1.7-.7 2-1.7H18l3 3-2 2-1.2-1v8.5H8.2V12L7 13z"/>`,
  /** Recruit: a fanned pack of cards with a star. */
  recruit: `<rect x="3.5" y="6" width="9" height="13" rx="1.5" transform="rotate(-12 8 12.5)" opacity=".5"/><rect x="9" y="4" width="10" height="15" rx="1.6"/><path d="M14 8.2l1 2.1 2.3.3-1.7 1.6.4 2.3-2-1.1-2 1.1.4-2.3-1.7-1.6 2.3-.3z"/>`,
  /** Club: the club shirt. */
  club: `<path d="M8 3.5l-4.5 3 2 4 2-1.2V20.5h9V9.3l2 1.2 2-4-4.5-3c-.5 1.6-1.8 2.6-4 2.6s-3.5-1-4-2.6z"/><path d="M12 9.5v4"/>`,
  /** Career: a trophy. */
  career: `<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 5.5H5a3 3 0 0 0 3 4M16 5.5h3a3 3 0 0 1-3 4"/><path d="M12 13v3.5"/><path d="M8.5 20.5h7l-1-4h-5z"/>`,
  /** Cup run: a knockout bracket. */
  cup: `<path d="M3.5 5h4v4h-4M3.5 15h4v4h-4M7.5 7h3v10h-3M10.5 12h3"/><path d="M13.5 9.5h3.5l3 2.5-3 2.5h-3.5z"/>`,
  /** New club: restart arrows. */
  restart: `<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4v4.5H15"/>`,
  /** Match ball. */
  ball: `<circle cx="12" cy="12" r="8.5"/><path d="M12 8.2l3.2 2.3-1.2 3.8h-4l-1.2-3.8z"/><path d="M12 8.2V3.6M15.2 10.5l4.4-1.4M14 14.3l2.7 3.7M10 14.3l-2.7 3.7M8.8 10.5L4.4 9.1"/>`,
  /** Whistle, for the kick-off button. */
  whistle: `<path d="M3.5 13.5a5 5 0 0 0 9.6 1.9l7.4-3.4V8.5h-10a5 5 0 0 0-7 5z"/><circle cx="8.5" cy="13.5" r="1.6"/><path d="M14 8.5V6"/>`,
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, cls = 'icon'): SVGSVGElement {
  return svg(wrap(ICONS[name]), cls);
}
