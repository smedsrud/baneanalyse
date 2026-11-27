import type { Series } from './types';
import { valueAt } from './model';

/** Punktene i en serie innenfor [a, b]. */
function inRange(s: Series, a: number, b: number): { t: number; v: number }[] {
  const out: { t: number; v: number }[] = [];
  for (let i = 0; i < s.t.length; i++) {
    const v = s.v[i];
    if (v !== null && s.t[i] >= a && s.t[i] <= b) out.push({ t: s.t[i], v });
  }
  return out;
}

/** Tidsvektet snitt over [a, b] (trapes, med interpolerte endepunkter). */
export function mean(s: Series | undefined, a: number, b: number): number | null {
  if (!s || b <= a) return null;
  const pts = inRange(s, a, b);
  const va = valueAt(s, a), vb = valueAt(s, b);
  if (va !== null) pts.unshift({ t: a, v: va });
  if (vb !== null) pts.push({ t: b, v: vb });
  if (pts.length < 2) return pts[0]?.v ?? null;
  let area = 0;
  for (let i = 1; i < pts.length; i++) area += ((pts[i].v + pts[i - 1].v) / 2) * (pts[i].t - pts[i - 1].t);
  const span = pts[pts.length - 1].t - pts[0].t;
  return span > 0 ? area / span : null;
}

/** Energi i kJ over [a, b] for en wattserie. */
export function energyKJ(s: Series | undefined, a: number, b: number): number | null {
  const m = mean(s, a, b);
  return m === null ? null : (m * (b - a)) / 1000;
}

export function max(s: Series | undefined, a: number, b: number): { t: number; v: number } | null {
  if (!s) return null;
  let best: { t: number; v: number } | null = null;
  for (const p of inRange(s, a, b)) if (!best || p.v > best.v) best = p;
  return best;
}

/** Rullerende snitt over w sekunder; returnerer høyeste vindu innenfor [a, b]. */
export function bestRolling(s: Series | undefined, w: number, a: number, b: number): { t: number; v: number } | null {
  if (!s) return null;
  let best: { t: number; v: number } | null = null;
  for (let t = a; t + w <= b; t += 1) {
    const m = mean(s, t, t + w);
    if (m !== null && (!best || m > best.v)) best = { t: t + w / 2, v: m };
  }
  return best;
}

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function cv(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v) / m;
}
