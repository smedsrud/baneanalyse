import type { Block, Ride, Series } from './types';

export const COLORS = {
  speed: 'var(--series-1)',
  speedRaw: 'var(--series-2)',
  speedLap: 'var(--text-secondary)',
  cadence: 'var(--series-3)',
  hr: 'var(--series-8)',
  power: 'var(--series-7)',
};

const KMH = 3.6;
/** Lengste rullestart vi ser etter før første passering (s). */
const MAX_PRE = 150;

export interface Position {
  /** Rundenummer i bolken (1 = første runde), null før første / etter siste passering. */
  lap: number | null;
  /** Meter etter start/mål, normalisert til 200 m per runde. */
  meters: number;
  /** Tid i runden, s. */
  lapTime: number | null;
}

export interface BlockView {
  block: Block;
  t0: number;
  t1: number;
  hasRide: boolean;
  /** Integrert distanse (m) per runde fra hjulfart eller kadens, null uten Karoo-data. */
  lapDist: number[] | null;
  /** Når rytteren begynte å rulle før første passering (s, ≤ 0), fra kadens/fart. null uten Karoo-data. */
  moveStart: number | null;
  speed: Series[];
  cadence: Series[];
  hr: Series[];
  power: Series[];
  positionAt(t: number): Position;
}

function lapIndexAt(p: number[], t: number): number {
  // siste i med p[i] <= t
  let lo = 0, hi = p.length - 1;
  if (t < p[0]) return -1;
  if (t >= p[hi]) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p[mid] <= t) lo = mid; else hi = mid;
  }
  return lo;
}

/** Lineær interpolasjon i sorterte (t, v). */
export function interp(t: number[], v: number[], x: number): number {
  if (x <= t[0]) return v[0];
  const n = t.length - 1;
  if (x >= t[n]) return v[n];
  let lo = 0, hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= x) lo = mid; else hi = mid;
  }
  const f = (x - t[lo]) / (t[hi] - t[lo]);
  return v[lo] + f * (v[hi] - v[lo]);
}

export function buildBlockView(
  block: Block,
  trackLength: number,
  ride: Ride | null,
  /** Karoo-tid minus tidtakingstid (ms). */
  offsetMs: number,
  padding = 15,
): BlockView {
  const p = block.passings;
  const last = p[p.length - 1];

  // Rundesnitt fra tidtakingen (trapp)
  const lapAvg: Series = {
    key: 'lap', label: 'Rundesnitt (tidtaking)', color: COLORS.speedLap, step: true, dashed: true,
    t: [...p], v: [...block.lapTimes.map((lt) => (trackLength / lt) * KMH), null],
  };

  const rideStartMs = block.startMs + offsetMs;
  const all = (ride?.samples ?? []).map((s) => ({ ...s, t: (s.ms - rideStartMs) / 1000 }));

  // Rullestart: gå bakover fra første passering så lenge pedalene/hjulet går (tåler hull på 3 s)
  let moveStart: number | null = null;
  if (ride && all.length) {
    const pre = all.filter((s) => s.t <= 0 && s.t >= -MAX_PRE).reverse();
    let lastMoving = 0;
    for (const s of pre) {
      const moving = (s.cadence ?? 0) > 0 || (s.speed ?? 0) > 0.5;
      if (moving) lastMoving = s.t;
      else if (lastMoving - s.t > 3) break;
    }
    // Ruller vi helt fra grensen, var det ingen stopp: da er det ingen rullestart å vise
    moveStart = pre.length && lastMoving > -MAX_PRE + 3 ? lastMoving : null;
  }
  const before = Math.max(padding, moveStart !== null ? -moveStart + 5 : 0);
  const ss = all.filter((s) => s.t >= -before - 2 && s.t <= last + padding + 2);

  if (!ride || ss.length < 2) {
    return {
      block, t0: 0, t1: last, hasRide: false, lapDist: null, moveStart: null,
      speed: [lapAvg], cadence: [], hr: [], power: [],
      positionAt(t) {
        const i = lapIndexAt(p, t);
        if (i < 0 || i >= p.length - 1) return { lap: null, meters: 0, lapTime: null };
        const f = (t - p[i]) / (p[i + 1] - p[i]);
        return { lap: i + 1, meters: f * trackLength, lapTime: t - p[i] };
      },
    };
  }

  const t0 = -before, t1 = last + padding;
  const ts = ss.map((s) => s.t);

  // Kumulativ distanse (trapes) fra hjulfart eller kadens × meter per omdreining
  const D: number[] = [0];
  for (let i = 1; i < ss.length; i++) {
    const a = ss[i - 1].speed ?? 0, b = ss[i].speed ?? 0;
    D.push(D[i - 1] + ((a + b) / 2) * (ts[i] - ts[i - 1]));
  }
  const dAt = (t: number) => interp(ts, D, t);
  const Dp = p.map(dAt);
  const lapDist = Dp.slice(1).map((d, i) => d - Dp[i]);

  const raw = ss.map((s) => (s.speed === null ? null : s.speed * KMH));
  const norm = ss.map((s) => {
    if (s.speed === null) return null;
    const i = lapIndexAt(p, s.t);
    if (i < 0 || i >= lapDist.length || lapDist[i] <= 0) return null;
    return s.speed * KMH * (trackLength / lapDist[i]);
  });

  const mk = (key: string, label: string, color: string, v: (number | null)[]): Series => ({ key, label, color, t: ts, v });
  const src = ride.speedSource === 'cadence' ? 'fra kadens' : 'hjul';
  const hasHr = ss.some((s) => s.hr !== null);

  return {
    block, t0, t1, hasRide: true, moveStart, lapDist: ride.speedSource === 'none' ? null : lapDist,
    speed: ride.speedSource === 'none'
      ? [lapAvg]
      : [
          mk('norm', `Fart ${src}, normalisert (200 m/runde)`, COLORS.speed, norm),
          mk('raw', `Fart ${src}, rå`, COLORS.speedRaw, raw),
          lapAvg,
        ],
    cadence: [mk('cad', 'Kadens', COLORS.cadence, ss.map((s) => s.cadence))],
    hr: hasHr ? [mk('hr', ride.hrSimulated ? 'Puls (simulert)' : 'Puls', COLORS.hr, ss.map((s) => s.hr))] : [],
    power: [mk('pow', 'Watt', COLORS.power, ss.map((s) => s.power))],
    positionAt(t) {
      const i = lapIndexAt(p, t);
      const d = dAt(t);
      if (i >= 0 && i < p.length - 1 && lapDist[i] > 0) {
        const f = (d - Dp[i]) / lapDist[i];
        return { lap: i + 1, meters: f * trackLength, lapTime: t - p[i] };
      }
      // Utenfor serien: bruk rå distanse fra nærmeste passering
      const ref = i < 0 ? Dp[0] : Dp[Dp.length - 1];
      return { lap: null, meters: d - ref, lapTime: null };
    },
  };
}

/** Verdi i en serie ved tid t (lineært eller trapp). */
export function valueAt(s: Series, t: number): number | null {
  const n = s.t.length;
  if (!n || t < s.t[0] || t > s.t[n - 1]) return null;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s.t[mid] <= t) lo = mid; else hi = mid;
  }
  const a = s.v[lo], b = s.v[hi];
  if (s.step) return t >= s.t[hi] ? b : a;
  if (a === null || b === null) return a ?? b;
  const dt = s.t[hi] - s.t[lo];
  return dt > 0 ? a + ((t - s.t[lo]) / dt) * (b - a) : a;
}

export function fmtTime(s: number): string {
  const sign = s < 0 ? '−' : '';
  s = Math.abs(s);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return m ? `${sign}${m}:${r.toFixed(1).padStart(4, '0')}` : `${sign}${r.toFixed(1)}`;
}

export function fmtLap(s: number): string {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return m ? `${m}:${r.toFixed(3).padStart(6, '0')}` : r.toFixed(3);
}

/** Lokal klokketid (Europe/Oslo) for epoch ms. */
export function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('nb-NO', { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
