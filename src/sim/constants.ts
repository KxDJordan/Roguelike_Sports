// Pitch geometry in meters. Team 0 attacks toward x = PITCH_L, team 1 toward x = 0.
export const PITCH_L = 105;
export const PITCH_W = 68;
export const GOAL_W = 7.32;
export const GOAL_Y0 = (PITCH_W - GOAL_W) / 2;
export const GOAL_Y1 = GOAL_Y0 + GOAL_W;
export const BOX_DEPTH = 16.5;
export const BOX_W = 40.32;
export const SIX_DEPTH = 5.5;
export const SIX_W = 18.32;
export const PEN_SPOT = 11;
export const CIRCLE_R = 9.15;

// Simulation timing. A half is HALF_SECONDS of simulated play, shown as 45 minutes.
export const TICK = 0.05;
export const HALF_SECONDS = 420;

// Ball physics: velocity decays exponentially (v *= e^-k*dt), so a ball kicked at v0
// travels v0/k meters and arrives at distance d with speed v0 - k*d.
export const GROUND_K = 0.9;
export const AIR_K = 0.12;
export const SHOT_K = 0.3;
/** Speed a lofted ball still has when it drops; most of it is lost on the first bounce. */
export const LOFT_ARRIVE = 16;
export const LANDING_DAMP = 0.35;
/**
 * Launch speed for a ball that should land after travelling d meters. Ground passes are struck
 * for the surface (groundK) and arrive with `arrive` m/s on top of the usual pace.
 */
export const kickSpeed = (d: number, lofted: boolean, groundK = GROUND_K, arrive = 0): number =>
  lofted ? Math.min(32, AIR_K * d + LOFT_ARRIVE) : Math.min(28 + arrive, groundK * d + 6 + arrive);
export const CONTROL_RADIUS = 1.2;
