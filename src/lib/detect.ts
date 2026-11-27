import type { BlockView } from './model';
import { mean, bestRolling, median } from './stats';

/**
 * Gjenkjenner hva økta inneholdt, ut fra rundetider (alltid) og watt (hvis Karoo).
 * Segmentene følger runder, ikke VinkSite-bolker, men går aldri på tvers av bolker.
 */
export type SegmentType = 'warmup' | 'interval' | 'tempo' | 'rest' | 'f200' | 'sprint' | 'cooldown' | 'easy';

export interface Segment {
  id: string;
  type: SegmentType;
  block: number;
  /** Første og siste runde (0-basert, inklusiv). */
  lapFrom: number;
  lapTo: number;
  /** Tid relativt til bolkens første passering. */
  t0: number;
  t1: number;
  /** Nummer innen typen (Intervall 1, 2, ...). */
  n: number;
  /** F200: indeks for den flygende runden. */
  flyingLap?: number;
}

export interface Detection {
  segments: Segment[];
  /** Kort sammendrag, f.eks. "2 intervaller · 1 F200". */
  summary: string;
  ftp: number | null;
  /** Fartsterskel (km/t) mellom rolig og hardt. */
  thresholdKmh: number | null;
}

export const TYPE_LABEL: Record<SegmentType, string> = {
  warmup: 'Oppvarming', interval: 'Intervall', tempo: 'Hardt drag', rest: 'Pause',
  f200: 'F200', sprint: 'Sprint', cooldown: 'Nedkjøring', easy: 'Rolig',
};

interface LapInfo { block: number; i: number; kmh: number; stop: boolean }

/** To-gruppe k-means i én dimensjon. */
function twoMeans(xs: number[]): [number, number] {
  const s = [...xs].sort((a, b) => a - b);
  let lo = s[Math.floor(s.length * 0.2)], hi = s[Math.floor(s.length * 0.8)];
  for (let it = 0; it < 30; it++) {
    const mid = (lo + hi) / 2;
    const a = s.filter((x) => x < mid), b = s.filter((x) => x >= mid);
    if (!a.length || !b.length) break;
    const nlo = a.reduce((x, y) => x + y, 0) / a.length, nhi = b.reduce((x, y) => x + y, 0) / b.length;
    if (Math.abs(nlo - lo) < 1e-6 && Math.abs(nhi - hi) < 1e-6) break;
    lo = nlo; hi = nhi;
  }
  return [lo, hi];
}

export function detect(views: BlockView[], trackLength: number, ftpIn?: number): Detection {
  const laps: LapInfo[] = [];
  for (const v of views) v.block.lapTimes.forEach((lt, i) => laps.push({ block: v.block.index, i, kmh: (trackLength / lt) * 3.6, stop: v.block.slowLaps[i] }));
  const moving = laps.filter((l) => !l.stop).map((l) => l.kmh);
  const segments: Segment[] = [];
  if (moving.length < 3) return { segments, summary: 'For få runder til å gjenkjenne noe', ftp: ftpIn ?? null, thresholdKmh: null };

  const [easy, hard] = twoMeans(moving);
  const hasHard = hard / easy >= 1.15;
  const thr = hasHard ? easy + 0.6 * (hard - easy) : Infinity;

  // FTP: fra Karoo, ellers anslag fra beste 5 min
  let ftp = ftpIn ?? null;
  if (!ftp) {
    const b5 = views.map((v) => bestRolling(v.power[0], 300, v.t0, v.t1)?.v ?? 0);
    const best = Math.max(0, ...b5);
    ftp = best > 0 ? Math.round(best * 0.9) : null;
  }

  for (const v of views) {
    const b = v.block, n = b.lapTimes.length;
    const kmh = b.lapTimes.map((lt) => (trackLength / lt) * 3.6);
    const used = new Array(n).fill(false);
    const segOf = (type: SegmentType, from: number, to: number, extra: Partial<Segment> = {}): Segment => ({
      id: `${type}-${b.index}-${from}`, type, block: b.index, lapFrom: from, lapTo: to,
      t0: b.passings[from], t1: b.passings[to + 1], n: 0, ...extra,
    });

    // 1. F200 / flygende runde: klart raskere enn rundene rundt
    for (let j = 0; j < n; j++) {
      if (b.slowLaps[j]) continue;
      const around: number[] = [];
      for (let k = Math.max(0, j - 4); k <= Math.min(n - 1, j + 4); k++) if (k !== j && !b.slowLaps[k]) around.push(kmh[k]);
      if (around.length < 2) continue;
      // Må være klart raskere enn rundene rundt, raskest i nabolaget, og raskere enn harde runder generelt
      const flying = kmh[j] >= 1.25 * median(around) && kmh[j] === Math.max(...kmh.slice(Math.max(0, j - 4), j + 5)) && hasHard && kmh[j] >= 1.1 * hard;
      if (flying) {
        const from = Math.max(0, j - 3);
        // Starter tilløpet i første runde, tas rullestarten fra sikkerhetssonen med
        const extra = from === 0 && v.moveStart !== null ? { t0: v.moveStart } : {};
        segments.push(segOf('f200', from, j, { flyingLap: j, ...extra }));
        for (let k = from; k <= j; k++) used[k] = true;
      }
    }

    // 2. Harde runder, med hull på én runde fylt inn
    const isHard = kmh.map((x, i) => !used[i] && !b.slowLaps[i] && x >= thr);
    for (let i = 1; i < n - 1; i++) if (!isHard[i] && !used[i] && isHard[i - 1] && isHard[i + 1]) isHard[i] = true;
    let i = 0;
    while (i < n) {
      if (!isHard[i]) { i++; continue; }
      let j = i;
      while (j + 1 < n && isHard[j + 1]) j++;
      // Trim kantene: oppbygging/avslutning under 93 % av dragets median
      const med = median(kmh.slice(i, j + 1));
      let a = i, z = j;
      while (a < z && kmh[a] < 0.93 * med) a++;
      while (z > a && kmh[z] < 0.93 * med) z--;
      if (z - a + 1 >= 2) segments.push(segOf('interval', a, z));
      i = j + 1;
    }

    // 3. Sprinter: kort, svært høy watt utenfor F200
    const pw = v.power[0];
    if (pw && ftp) {
      const limit = 2.2 * ftp;
      let t = 0;
      while (t + 5 <= b.passings[n]) {
        const m = mean(pw, t, t + 5);
        if (m !== null && m > limit) {
          const lap = Math.max(0, b.passings.findIndex((p) => p > t + 2.5) - 1);
          const inF200 = segments.some((s) => s.block === b.index && s.type === 'f200' && lap >= s.lapFrom && lap <= s.lapTo);
          if (!inF200) segments.push({ ...segOf('sprint', lap, lap), t0: t, t1: t + 5 });
          t += 20;
        } else t += 1;
      }
    }
  }

  // 4. Navngi harde drag: ≥2 = intervaller, ett = hardt drag
  const efforts = segments.filter((s) => s.type === 'interval').sort((a, b) => a.block - b.block || a.lapFrom - b.lapFrom);
  if (efforts.length === 1) efforts[0].type = 'tempo';
  efforts.forEach((s, k) => { s.n = k + 1; s.id = `${s.type}-${s.block}-${s.lapFrom}`; });
  let f = 0, sp = 0;
  for (const s of segments) { if (s.type === 'f200') s.n = ++f; if (s.type === 'sprint') s.n = ++sp; }

  // 5. Fyll resten med oppvarming, pause, nedkjøring eller rolig
  const main = segments.filter((s) => s.type !== 'sprint').sort((a, b) => a.block - b.block || a.lapFrom - b.lapFrom);
  const first = main[0], last = main[main.length - 1];
  const fill: Segment[] = [];
  for (const v of views) {
    const b = v.block, n = b.lapTimes.length;
    const covered = new Array(n).fill(false);
    for (const s of main) if (s.block === b.index) for (let k = s.lapFrom; k <= s.lapTo; k++) covered[k] = true;
    let k = 0;
    while (k < n) {
      if (covered[k]) { k++; continue; }
      let z = k;
      while (z + 1 < n && !covered[z + 1]) z++;
      const before = !first || b.index < first.block || (b.index === first.block && z < first.lapFrom);
      const after = !!last && (b.index > last.block || (b.index === last.block && k > last.lapTo));
      const type: SegmentType = !first ? 'easy' : before ? 'warmup' : after ? 'cooldown' : 'rest';
      fill.push({ id: `${type}-${b.index}-${k}`, type, block: b.index, lapFrom: k, lapTo: z, t0: b.passings[k], t1: b.passings[z + 1], n: 0 });
      k = z + 1;
    }
  }
  const all = [...segments, ...fill].sort((a, b) => a.block - b.block || a.t0 - b.t0);

  const parts: string[] = [];
  const count = (t: SegmentType) => all.filter((s) => s.type === t).length;
  if (count('interval')) parts.push(`${count('interval')} intervaller`);
  if (count('tempo')) parts.push('1 hardt drag');
  if (count('f200')) parts.push(`${count('f200')} F200`);
  if (count('sprint')) parts.push(`${count('sprint')} sprint${count('sprint') > 1 ? 'er' : ''}`);
  const summary = parts.length ? parts.join(' · ') : 'Rolig økt';

  return { segments: all, summary, ftp, thresholdKmh: hasHard ? thr : null };
}

export function segmentLabel(s: Segment): string {
  return s.n ? `${TYPE_LABEL[s.type]} ${s.n}` : TYPE_LABEL[s.type];
}
