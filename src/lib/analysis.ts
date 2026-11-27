import type { BlockView } from './model';
import { valueAt } from './model';
import type { Segment } from './detect';
import { mean, energyKJ, max, cv } from './stats';

export type Verdict = 'good' | 'warn' | 'info';
export interface Check { label: string; value: string; verdict: Verdict; note: string }

/**
 * Tommelfingerregler for F200 (ikke validerte terskler, juster etter erfaring):
 * - Høyde skal tas billig: lav watt før hoppet.
 * - Hoppet fra toppen av banen: fra hopp til mål ca 18–20 s for eliten (9–11 s tidtatt).
 * - Toppwatt i hoppet/dykket, ikke lenge før 200-start.
 * - Toppfart rundt starten av 200.
 * - Watt faller gjennom 200 m (ca 40 % fra topp til mål er vanlig), fart bør falle lite.
 * Kilder: Craig & Norton 2001 (Characteristics of Track Cycling); PMC7966696 (Using field based data to model sprint track cycling).
 */
export const F200_RULES = {
  peakEarliest: -8, // s før 200-start
  peakLatest: 1,
  topSpeedWindow: [-1.5, 2] as [number, number],
  approachMaxFtp: 1.0, // snittwatt før hoppet, × FTP
  dropGood: 5, // % fartsfall gjennom 200
  dropBad: 10,
  jumpFrac: 0.5, // hoppet = siste sammenhengende periode over 50 % av toppwatt
};

export interface F200Report {
  segment: Segment;
  lapTime: number;
  kmh: number;
  maxW: number | null;
  avgW: number | null;
  kjFlying: number | null;
  kjApproach: number | null;
  peakW: number | null;
  /** Tid for toppwatt relativt til 200-start (s, negativ = før). */
  peakAt: number | null;
  topKmh: number | null;
  topAt: number | null;
  entryKmh: number | null;
  exitKmh: number | null;
  dropPct: number | null;
  /** Hoppet: start relativt til 200-start, og snittwatt før hoppet. */
  jumpAt: number | null;
  preJumpW: number | null;
  /** Rullestart før første passering (s, negativ), med energi og toppwatt. null hvis tilløpet ikke starter i bolkens første runde. */
  rollStart: number | null;
  rollKJ: number | null;
  rollPeakW: number | null;
  /** Ekstra meter per runde i tilløpet (høyde i banen). */
  approachExtra: number[] | null;
  checks: Check[];
}

export function f200Report(view: BlockView, seg: Segment, trackLength: number, ftp: number | null, lapExtra: number[] | null): F200Report {
  const p = view.block.passings;
  const j = seg.flyingLap!;
  const s200 = p[j], e200 = p[j + 1];
  // Tilløpet starter ved rullestarten fra sikkerhetssonen hvis den finnes, ellers ved første runde i tilløpet
  const rollStart = seg.lapFrom === 0 && view.moveStart !== null && view.moveStart < -2 ? view.moveStart : null;
  const a0 = rollStart ?? p[seg.lapFrom];
  const pw = view.power[0];
  const sp = view.speed.find((s) => s.key === 'raw') ?? view.speed[0];
  const lapTime = view.block.lapTimes[j];

  const fly = max(pw, s200, e200);
  const peak = max(pw, a0, e200);
  const top = sp && sp.key !== 'lap' ? max(sp, a0, e200) : null;
  const entry = sp && sp.key !== 'lap' ? valueAt(sp, s200) : null;
  const exit = sp && sp.key !== 'lap' ? valueAt(sp, e200 - 0.5) : null;

  // Hoppet: gå bakover fra 200-start så lenge watt ≥ 50 % av toppwatt
  let jumpAt: number | null = null;
  if (pw && peak) {
    const lim = F200_RULES.jumpFrac * peak.v;
    let t = Math.min(peak.t, s200);
    while (t > a0 && (valueAt(pw, t - 0.5) ?? 0) >= lim) t -= 0.5;
    jumpAt = t - s200;
  }
  const preJumpW = jumpAt !== null && jumpAt + s200 - a0 > 2 ? mean(pw, a0, s200 + jumpAt) : null;

  const r: F200Report = {
    segment: seg, lapTime, kmh: (trackLength / lapTime) * 3.6,
    maxW: fly?.v ?? null, avgW: mean(pw, s200, e200),
    kjFlying: energyKJ(pw, s200, e200), kjApproach: energyKJ(pw, a0, s200),
    peakW: peak?.v ?? null, peakAt: peak ? peak.t - s200 : null,
    topKmh: top?.v ?? null, topAt: top ? top.t - s200 : null,
    entryKmh: entry, exitKmh: exit,
    dropPct: entry && exit ? ((entry - exit) / entry) * 100 : null,
    jumpAt, preJumpW,
    rollStart, rollKJ: rollStart !== null ? energyKJ(pw, rollStart, 0) : null,
    rollPeakW: rollStart !== null ? max(pw, rollStart, 0)?.v ?? null : null,
    approachExtra: lapExtra ? lapExtra.slice(seg.lapFrom, j) : null,
    checks: [],
  };

  const R = F200_RULES, c = r.checks;
  if (r.rollStart !== null && r.rollKJ !== null) {
    const avg = (r.rollKJ * 1000) / -r.rollStart;
    c.push({
      label: 'Rullestart til startstreken', value: `${(-r.rollStart).toFixed(0)} s, ${r.rollKJ.toFixed(1)} kJ, snitt ${Math.round(avg)} W, topp ${Math.round(r.rollPeakW ?? 0)} W`,
      verdict: ftp && avg > R.approachMaxFtp * ftp ? 'warn' : 'info',
      note: 'Fra sikkerhetssonen, opp på banen fra langsiden bak og til blå. Telles med i tilløpet. Tidtakingen ser ikke denne delen.',
    });
  }
  if (r.preJumpW !== null && ftp) {
    const x = r.preJumpW / ftp;
    c.push({
      label: 'Høyde tatt billig', value: `${Math.round(r.preJumpW)} W snitt før hoppet (${(x * 100).toFixed(0)} % av FTP)`,
      verdict: x <= R.approachMaxFtp ? 'good' : 'warn',
      note: x <= R.approachMaxFtp ? 'Lite energi brukt på å komme opp.' : 'Mye watt før hoppet. Prøv å rulle opp i banen med lavere watt.',
    });
  }
  if (r.jumpAt !== null) {
    const total = -r.jumpAt + lapTime;
    c.push({
      label: 'Hoppet', value: `${(-r.jumpAt).toFixed(1)} s før 200-start, ${total.toFixed(1)} s til mål`,
      verdict: 'info',
      note: 'Eliten: ca 18–20 s fra hopp til mål med 9–11 s tidtatt. Et langt hopp betyr mye tid på høy watt før det teller.',
    });
  }
  if (r.peakAt !== null) {
    const ok = r.peakAt >= R.peakEarliest && r.peakAt <= R.peakLatest;
    c.push({
      label: 'Toppwatt', value: `${Math.round(r.peakW!)} W, ${r.peakAt < 0 ? `${(-r.peakAt).toFixed(1)} s før` : `${r.peakAt.toFixed(1)} s etter`} 200-start`,
      verdict: ok ? 'good' : 'warn',
      note: ok ? 'Toppen kom i dykket, rett før det teller.' : r.peakAt < R.peakEarliest ? 'Toppen kom tidlig i tilløpet. Kraften bør komme i dykket ned fra vantet.' : 'Toppen kom sent, inne i 200.',
    });
  }
  if (r.topAt !== null) {
    const ok = r.topAt >= R.topSpeedWindow[0] && r.topAt <= R.topSpeedWindow[1];
    c.push({
      label: 'Toppfart', value: `${r.topKmh!.toFixed(1)} km/t, ${r.topAt < 0 ? `${(-r.topAt).toFixed(1)} s før` : `${r.topAt.toFixed(1)} s etter`} start`,
      verdict: ok ? 'good' : 'warn',
      note: ok ? 'Toppfarten traff starten av 200.' : 'Toppfarten bør komme rundt startstreken.',
    });
  }
  if (r.dropPct !== null) {
    c.push({
      label: 'Fartsfall gjennom 200', value: `${r.entryKmh!.toFixed(1)} → ${r.exitKmh!.toFixed(1)} km/t (−${r.dropPct.toFixed(1)} %)`,
      verdict: r.dropPct <= R.dropGood ? 'good' : r.dropPct <= R.dropBad ? 'info' : 'warn',
      note: 'Noe fall er normalt. Stort fall kan bety at kreftene ble brukt i tilløpet.',
    });
  }
  if (r.kjApproach !== null && r.kjFlying !== null) {
    c.push({
      label: 'Energifordeling', value: `${r.kjApproach.toFixed(1)} kJ tilløp, ${r.kjFlying.toFixed(1)} kJ på 200`,
      verdict: 'info', note: 'Sammenlign mellom forsøk: mindre i tilløpet med samme inngangsfart er bedre.',
    });
  }
  return r;
}

export interface IntervalRow {
  segment: Segment;
  duration: number;
  laps: number;
  avgW: number | null;
  kmh: number;
  lapCv: number; // % variasjon i rundetid
  /** Endring fra første til siste tredjedel (%), fart og watt. */
  fadeKmh: number;
  fadeW: number | null;
  avgHr: number | null;
  /** Pausen før dette intervallet. */
  restBefore: number | null;
}

export interface IntervalReport {
  rows: IntervalRow[];
  /** Siste intervall i forhold til første (%). */
  dropW: number | null;
  dropKmh: number;
  checks: Check[];
}

export function intervalReport(views: BlockView[], segs: Segment[], all: Segment[], trackLength: number, hrSimulated: boolean): IntervalReport {
  const rows: IntervalRow[] = segs.map((s) => {
    const v = views[s.block];
    const lt = v.block.lapTimes.slice(s.lapFrom, s.lapTo + 1);
    const dur = s.t1 - s.t0;
    const third = Math.max(1, Math.floor(lt.length / 3));
    const spd = (xs: number[]) => (trackLength * xs.length) / xs.reduce((a, b) => a + b, 0) * 3.6;
    const p = v.block.passings;
    const firstW = mean(v.power[0], p[s.lapFrom], p[s.lapFrom + third]);
    const lastW = mean(v.power[0], p[s.lapTo + 1 - third], p[s.lapTo + 1]);
    const idx = all.indexOf(s);
    const prev = idx > 0 ? all[idx - 1] : null;
    return {
      segment: s, duration: dur, laps: lt.length,
      avgW: mean(v.power[0], s.t0, s.t1),
      kmh: spd(lt),
      lapCv: cv(lt) * 100,
      fadeKmh: ((spd(lt.slice(-third)) - spd(lt.slice(0, third))) / spd(lt.slice(0, third))) * 100,
      fadeW: firstW && lastW ? ((lastW - firstW) / firstW) * 100 : null,
      avgHr: hrSimulated ? null : mean(v.hr[0], s.t0, s.t1),
      restBefore: prev && prev.type === 'rest' && prev.block === s.block ? prev.t1 - prev.t0 : null,
    };
  });
  const f = rows[0], l = rows[rows.length - 1];
  const dropW = f?.avgW && l?.avgW ? ((l.avgW - f.avgW) / f.avgW) * 100 : null;
  const dropKmh = f && l ? ((l.kmh - f.kmh) / f.kmh) * 100 : 0;

  const checks: Check[] = [];
  const maxCv = Math.max(...rows.map((r) => r.lapCv));
  checks.push({
    label: 'Jevnhet i hvert drag', value: `variasjon i rundetid ${Math.min(...rows.map((r) => r.lapCv)).toFixed(1)}–${maxCv.toFixed(1)} %`,
    verdict: maxCv <= 2.5 ? 'good' : 'warn',
    note: maxCv <= 2.5 ? 'Jevnt kjørt.' : 'Ujevne runder. Jevn fordeling gir som regel mer ut av senere drag.',
  });
  const worstFade = Math.min(...rows.map((r) => r.fadeKmh));
  checks.push({
    label: 'Fall innen draget', value: `verste ${worstFade.toFixed(1)} % fart fra første til siste tredjedel`,
    verdict: worstFade >= -3 ? 'good' : 'warn',
    note: worstFade >= -3 ? 'Holdt farten gjennom dragene.' : 'Farten falt mot slutten. Kan tyde på for hard start.',
  });
  if (rows.length >= 2) {
    const d = dropW ?? dropKmh;
    checks.push({
      label: 'Fall fra første til siste', value: `${dropW !== null ? `watt ${dropW.toFixed(1)} %, ` : ''}fart ${dropKmh.toFixed(1)} %`,
      verdict: d >= -5 ? 'good' : 'warn',
      note: d >= -5 ? 'Like sterk i siste som i første.' : 'Merkbart svakere mot slutten. Vurder lavere start eller lengre pauser.',
    });
  }
  return { rows, dropW, dropKmh, checks };
}
