import type { Block, Ride } from './types';

/**
 * Forskyvning = Karoo-tid minus tidtakingstid (ms).
 * Karoo-tidspunkt for en passering = block.startMs + passering*1000 + offset.
 */

function median(xs: number[]): number {
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Steg 1 med lap-trykk: median av avstanden fra hver bolks første passering til nærmeste trykk. */
export function offsetFromLapPresses(blocks: Block[], ride: Ride, maxMs = 20000): number | null {
  const diffs: number[] = [];
  for (const b of blocks) {
    let best: number | null = null;
    for (const p of ride.lapPresses) if (best === null || Math.abs(p - b.startMs) < Math.abs(best)) best = p - b.startMs;
    if (best !== null && Math.abs(best) < maxMs) diffs.push(best);
  }
  return diffs.length ? median(diffs) : null;
}

/**
 * Kumulativt integral av et signal per sekund: hjulfart (m/s) gir meter,
 * kadens (rpm) gir pedalomdreininger.
 */
function cumulative(ride: Ride, useCadence: boolean) {
  const ts: number[] = [], C: number[] = [];
  let acc = 0;
  for (let i = 0; i < ride.samples.length; i++) {
    const s = ride.samples[i];
    const v = useCadence ? (s.cadence ?? 0) / 60 : s.speed ?? 0;
    if (i > 0) {
      const p = ride.samples[i - 1];
      const pv = useCadence ? (p.cadence ?? 0) / 60 : p.speed ?? 0;
      acc += ((v + pv) / 2) * ((s.ms - p.ms) / 1000);
    }
    ts.push(s.ms);
    C.push(acc);
  }
  return { ts, C };
}

function interpAt(ts: number[], C: number[], x: number): number {
  if (x <= ts[0]) return C[0];
  const n = ts.length - 1;
  if (x >= ts[n]) return C[n];
  let lo = 0, hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] <= x) lo = mid; else hi = mid;
  }
  return C[lo] + ((x - ts[lo]) / (ts[hi] - ts[lo])) * (C[hi] - C[lo]);
}

/** Integral per runde (meter eller omdreininger) per bolk. null hvis runden er utenfor opptaket. */
function lapIntegrals(blocks: Block[], cum: { ts: number[]; C: number[] }, offsetMs: number): (number | null)[][] {
  return blocks.map((b) =>
    b.lapTimes.map((_, i) => {
      const a = b.startMs + b.passings[i] * 1000 + offsetMs;
      const e = b.startMs + b.passings[i + 1] * 1000 + offsetMs;
      if (a < cum.ts[0] || e > cum.ts[cum.ts.length - 1]) return null;
      return interpAt(cum.ts, cum.C, e) - interpAt(cum.ts, cum.C, a);
    }),
  );
}

/**
 * Kostnad: snitt av |forskjell| mellom påfølgende runder. Tåler at linjen endres
 * (en lengre runde høyt i banen gir bare ett hopp), i motsetning til spredning rundt snittet.
 */
function cost(per: (number | null)[][]): { cost: number; n: number } {
  let sum = 0, n = 0;
  for (const r of per) for (let i = 1; i < r.length; i++) {
    const a = r[i - 1], b = r[i];
    if (a === null || b === null) continue;
    sum += Math.abs(b - a);
    n++;
  }
  return { cost: n ? sum / n : Infinity, n };
}

export interface AlignResult {
  offsetMs: number;
  /** Område (ms) der kostnaden er innenfor 5 % av minimum: et grovt mål på usikkerhet. */
  rangeMs: [number, number];
  /** Meter eller omdreininger per runde (median av de raskeste halvdelen, antatt på svart strek). */
  perLap: number;
  laps: number;
  useCadence: boolean;
}

/**
 * Steg 2: finn forskyvningen der distanse (hjul) eller omdreininger (fastnav) per runde
 * endrer seg minst fra runde til runde. Informasjonen ligger i fartsendringene;
 * med jevn fart er forskyvningen nesten ikke målbar.
 */
export function fineAlign(blocks: Block[], ride: Ride, centerMs: number, rangeMs = 30000, stepMs = 100): AlignResult | null {
  const useCadence = ride.speedSource !== 'wheel';
  if (ride.speedSource === 'none' || !ride.samples.length) return null;
  const cum = cumulative(ride, useCadence);
  const curve: { o: number; c: number }[] = [];
  for (let o = centerMs - rangeMs; o <= centerMs + rangeMs; o += stepMs) curve.push({ o, c: cost(lapIntegrals(blocks, cum, o)).cost });
  let best = curve[0];
  for (const p of curve) if (p.c < best.c) best = p;
  if (!Number.isFinite(best.c)) return null;
  // Finjuster rundt minimum
  for (let o = best.o - stepMs; o <= best.o + stepMs; o += 10) {
    const c = cost(lapIntegrals(blocks, cum, o)).cost;
    if (c < best.c) best = { o, c };
  }
  const near = curve.filter((p) => p.c <= best.c * 1.05).map((p) => p.o);

  const per = lapIntegrals(blocks, cum, best.o);
  const pairs: [number, number][] = [];
  blocks.forEach((b, k) => b.lapTimes.forEach((lt, i) => { const v = per[k][i]; if (v !== null && !b.slowLaps[i]) pairs.push([lt, v]); }));
  const medLap = median(pairs.map((p) => p[0]));
  const fast = pairs.filter((p) => p[0] <= medLap).map((p) => p[1]);

  return { offsetMs: best.o, rangeMs: [Math.min(...near), Math.max(...near)], perLap: median(fast), laps: pairs.length, useCadence };
}

/** Fastnav: fart = kadens × meter per omdreining. */
export function withCadenceSpeed(ride: Ride, metersPerRev: number): Ride {
  return {
    ...ride,
    metersPerRev,
    samples: ride.samples.map((s) => ({ ...s, speed: s.cadence === null ? null : (s.cadence / 60) * metersPerRev })),
  };
}
