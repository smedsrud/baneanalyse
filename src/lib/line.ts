import type { Block } from './types';

/**
 * Sideposisjon i banen ("linje"), som h ∈ [0, 1]:
 * 0 = svart strek, BLUE = blå strek, 1 = ved vantet. Hver visning (2D/3D) oversetter h til sin egen geometri.
 */
export const BLUE = 0.5;
export const FENCE = 0.95;
/** Negativ h = i sikkerhetssonen innenfor banen. */
export const SAFETY = -1;
/** Avstand fra svart strek inn til midt i sikkerhetssonen (m, sett ovenfra). */
export const SAFETY_DIST = 3.5;

/**
 * Rullestart før første passering: sikkerhetssonen fram til langsiden bak,
 * opp på banen der (ca 110 m før start/mål) og opp til målhøyden innen ca 75 m før.
 * m = meter i forhold til start/mål (negativ før passering).
 */
export const ENTRY_AT = -110;
export const ENTRY_DONE = -75;
export function preStartLateral(m: number, target: number): number {
  if (m <= ENTRY_AT) return SAFETY;
  if (m >= ENTRY_DONE) return target;
  return lerp(SAFETY, target, ss((m - ENTRY_AT) / (ENTRY_DONE - ENTRY_AT)));
}

/**
 * Linje fra data: hvor mye lengre hver runde var enn på svart strek.
 * refDist = målt distanse for en runde på svart strek (de raske rundene), samme enhet som lapDist.
 * toH gjør ekstra meter om til høyde, ut fra banemodellen (se extraToLateral i track3d.ts).
 */
export function lapLaterals(lapDist: number[], refDist: number, trackLength: number, toH: (extra: number) => number): number[] {
  return lapDist.map((d) => Math.min(FENCE, toH(trackLength * (d / refDist - 1))));
}

/** Jevn overgang: interpoler h mellom midtpunktene av rundene. */
export function dataLateralAt(block: Block, laterals: number[], t: number): number {
  const p = block.passings;
  const mids = laterals.map((_, i) => (p[i] + p[i + 1]) / 2);
  if (!mids.length) return 0;
  if (t <= mids[0]) return laterals[0];
  for (let i = 1; i < mids.length; i++) {
    if (t <= mids[i]) {
      const f = (t - mids[i - 1]) / (mids[i] - mids[i - 1]);
      return lerp(laterals[i - 1], laterals[i], ss(f));
    }
  }
  return laterals[laterals.length - 1];
}

const ss = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Oversetter h til avstand fra svart strek, gitt blå strek og vantet på dette stedet. */
export function lateralToOffset(h: number, blue: number, fence: number): number {
  if (h < 0) return h * SAFETY_DIST;
  return h <= BLUE ? (h / BLUE) * blue : blue + ((h - BLUE) / (1 - BLUE)) * (fence - blue);
}
