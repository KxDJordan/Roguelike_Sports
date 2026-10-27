import type { Rng } from './rng';

export type WeatherId = 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'fog' | 'heat' | 'wind';

/**
 * Match conditions. The sim reads the multipliers; the renderer and sound read the visual
 * fields. Every multiplier is 1 (or 0) in clear weather.
 */
export interface Weather {
  id: WeatherId;
  name: string;
  icon: string;
  /** One line for the pre-match screen: what changes and how to play it. */
  tip: string;
  /** Rolling friction multiplier: a wet pitch lets the ball skid on, snow holds it up. */
  groundK: number;
  /** Extra pace a ground pass arrives with (m/s) because the surface is quick. */
  arrive: number;
  /** Heavy first-touch multiplier. */
  touch: number;
  /** Player top speed and acceleration multiplier (footing). */
  footing: number;
  /** Stamina drain multiplier. */
  stamina: number;
  /** Pass and cross error multiplier. */
  passErr: number;
  /** Chance a keeper holds a save rather than parrying, multiplier. */
  grip: number;
  /** Extra scoring chance for shots from distance that skid off a wet surface. */
  slick: number;
  /** How far up the pitch players can pick out a pass, multiplier. */
  visibility: number;
  /** Wind acceleration on a ball in the air (m/s^2 along x and y). */
  wind: { x: number; y: number };
  // Visuals
  rain: number;
  snow: number;
  fog: number;
  /** Darkening of the scene, 0..1. */
  gloom: number;
  lightning: boolean;
  heat: number;
  clouds: number;
}

const BASE: Omit<Weather, 'id' | 'name' | 'icon' | 'tip'> = {
  groundK: 1,
  arrive: 0,
  touch: 1,
  footing: 1,
  stamina: 1,
  passErr: 1,
  grip: 1,
  slick: 0,
  visibility: 1,
  wind: { x: 0, y: 0 },
  rain: 0,
  snow: 0,
  fog: 0,
  gloom: 0,
  lightning: false,
  heat: 0,
  clouds: 0,
};

const make = (id: WeatherId, name: string, icon: string, tip: string, w: Partial<Weather>): Weather => ({ ...BASE, id, name, icon, tip, ...w });

export const WEATHER: Record<WeatherId, Weather> = {
  clear: make('clear', 'Clear night', '🌙', 'Perfect conditions. Play your normal game.', {}),
  cloudy: make('cloudy', 'Overcast', '☁️', 'Grey skies, no real effect on play.', { clouds: 0.7, gloom: 0.08 }),
  rain: make('rain', 'Rain', '🌧️', 'The ball skids on: first touches and keepers get less reliable. Shoot from distance.', {
    groundK: 0.78,
    arrive: 2.5,
    touch: 1.6,
    footing: 0.97,
    grip: 0.72,
    slick: 0.3,
    passErr: 1.1,
    rain: 0.6,
    gloom: 0.15,
    clouds: 0.5,
  }),
  storm: make('storm', 'Thunderstorm', '⛈️', 'Heavy rain and wind. Keep it simple: long balls drift and keepers spill.', {
    groundK: 0.72,
    arrive: 3,
    touch: 1.9,
    footing: 0.95,
    grip: 0.62,
    slick: 0.35,
    passErr: 1.25,
    visibility: 0.85,
    rain: 1,
    gloom: 0.32,
    lightning: true,
    clouds: 0.9,
  }),
  snow: make('snow', 'Snow', '🌨️', 'The ball holds up in the snow and players slip. Short, simple passing wins.', {
    groundK: 1.35,
    touch: 1.4,
    footing: 0.92,
    stamina: 1.1,
    passErr: 1.12,
    grip: 0.85,
    visibility: 0.9,
    snow: 1,
    gloom: 0.05,
  }),
  fog: make('fog', 'Fog', '🌫️', 'Players can barely pick out long passes. Keep the ball and work it short.', {
    visibility: 0.6,
    passErr: 1.08,
    fog: 0.75,
    gloom: 0.1,
  }),
  heat: make('heat', 'Heatwave', '🔥', 'Legs go fast in this heat. Pressing will cost you; rotate and sub early.', {
    stamina: 1.4,
    footing: 0.99,
    heat: 1,
  }),
  wind: make('wind', 'Strong wind', '💨', 'Balls in the air drift with the wind. Play it on the ground.', {
    passErr: 1.1,
    clouds: 0.4,
  }),
};

const ODDS: [WeatherId, number][] = [
  ['clear', 30],
  ['cloudy', 18],
  ['rain', 17],
  ['wind', 10],
  ['heat', 8],
  ['fog', 6],
  ['snow', 6],
  ['storm', 5],
];

/** Weather for a match; windy weather gets a random direction and strength. */
export function rollWeather(rng: Rng): Weather {
  let r = rng.next() * ODDS.reduce((a, [, w]) => a + w, 0);
  let id: WeatherId = 'clear';
  for (const [k, w] of ODDS) {
    r -= w;
    if (r < 0) {
      id = k;
      break;
    }
  }
  const w = { ...WEATHER[id] };
  if (id === 'wind' || id === 'storm') {
    const ang = rng.next() * Math.PI * 2;
    const str = id === 'wind' ? rng.range(2.5, 4) : rng.range(1.5, 3);
    w.wind = { x: Math.cos(ang) * str, y: Math.sin(ang) * str };
  }
  return w;
}

/** Compass-style arrow for a wind vector in pitch coordinates (+x = toward the away goal). */
export function windLabel(w: Weather): string {
  const s = Math.hypot(w.wind.x, w.wind.y);
  if (s < 0.1) return '';
  const arrows = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
  const i = Math.round(Math.atan2(w.wind.y, w.wind.x) / (Math.PI / 4));
  return `${arrows[(i + 8) % 8]} ${Math.round(s * 9)} km/h`;
}
