/**
 * Banegeometri: pilleform med to langsider (lengde S) og to halvsirkler (radius R),
 * slik at 2S + 2πR = lengden på svart strek (200 m).
 *
 * Koordinater i meter, origo i midten, y nedover (SVG). Kjøreretning er mot klokka
 * sett ovenfra: langs nederste langside mot høyre, opp gjennom høyre sving, osv.
 * d = 0 er starten av nederste langside (inngangen fra venstre sving).
 */
export interface TrackConfig {
  length: number; // svart strek, m
  straight: number; // langside, m
  /** Avstand langs svart strek fra d = 0 til start/mål-streken. */
  finishAt: number;
  /** Pursuit-linjer, meter etter start/mål. */
  pursuit: number[];
  /** Dosering midt i svingen, grader. */
  bankingBend: number;
}

/**
 * Lager konfig der pursuit-linjene ligger midt på hver langside, rett overfor hverandre.
 * pursuitHome = meter etter start/mål for pursuit-linjen på oppløpssiden.
 */
export function trackFromPursuit(length: number, straight: number, pursuitHome: number, bankingBend: number): TrackConfig {
  const finishAt = straight / 2 + (length - pursuitHome);
  return { length, straight, finishAt, pursuit: [pursuitHome, pursuitHome - length / 2], bankingBend };
}

/**
 * Asker: pursuit på 190 og 90 m. Langside 40 m midt rundt pursuit-linjen gir
 * sving 4 slutt ved 170 m og sving 1 start ved 10 m (målt: ca 165 og ca 10).
 */
export const ASKER: TrackConfig = trackFromPursuit(200, 40, 190, 46.7);

export function radius(c: TrackConfig): number {
  return (c.length - 2 * c.straight) / (2 * Math.PI);
}

/** Punkt på en pille med gitt radius, d meter langs (målt på samme pille). */
export function pillPoint(S: number, R: number, d: number): { x: number; y: number } {
  const bend = Math.PI * R;
  const L = 2 * S + 2 * bend;
  d = ((d % L) + L) % L;
  if (d < S) return { x: -S / 2 + d, y: R };
  d -= S;
  if (d < bend) {
    const th = Math.PI / 2 - d / R;
    return { x: S / 2 + R * Math.cos(th), y: R * Math.sin(th) };
  }
  d -= bend;
  if (d < S) return { x: S / 2 - d, y: -R };
  d -= S;
  const th = -Math.PI / 2 - d / R;
  return { x: -S / 2 + R * Math.cos(th), y: R * Math.sin(th) };
}

/** SVG-path for en pille. */
export function pillPath(S: number, R: number): string {
  const h = S / 2;
  return `M ${-h} ${R} L ${h} ${R} A ${R} ${R} 0 0 0 ${h} ${-R} L ${-h} ${-R} A ${R} ${R} 0 0 0 ${-h} ${R} Z`;
}

/**
 * Kurve forskjøvet utover fra svart strek med en avstand som varierer langs banen.
 * offset(d, inBend) får d langs svart strek (0 = start nederste langside) og
 * andel gjennom svingen (0..1) eller null på langsidene.
 */
export function offsetPath(c: TrackConfig, offset: (bendFrac: number | null) => number, n = 480): string {
  const S = c.straight, R = radius(c), bend = Math.PI * R;
  const pts: string[] = [];
  for (let i = 0; i <= n; i++) {
    const d = (i / n) * c.length;
    let frac: number | null = null;
    if (d >= S && d < S + bend) frac = (d - S) / bend;
    else if (d >= 2 * S + bend) frac = (d - 2 * S - bend) / bend;
    const a = pillPoint(S, R, d - 0.05), b = pillPoint(S, R, d + 0.05), p = pillPoint(S, R, d);
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const o = offset(frac);
    pts.push(`${(p.x - (dy / len) * o).toFixed(2)} ${(p.y + (dx / len) * o).toFixed(2)}`);
  }
  return `M ${pts.join(' L ')} Z`;
}

/** Andel gjennom svingen (0..1) for meter etter start/mål, eller null på langsidene. */
export function bendFracAtMeters(c: TrackConfig, meters: number): number | null {
  const S = c.straight, bend = Math.PI * radius(c), L = c.length;
  const d = (((c.finishAt + meters) % L) + L) % L;
  if (d >= S && d < S + bend) return (d - S) / bend;
  if (d >= 2 * S + bend) return (d - 2 * S - bend) / bend;
  return null;
}

/** Punkt på svart strek gitt meter etter start/mål. */
export function pointFromFinish(c: TrackConfig, meters: number) {
  return pillPoint(c.straight, radius(c), c.finishAt + meters);
}

/** Retningsvektor (normal ut fra banen) i et punkt, for å tegne tverrstreker. */
export function outwardNormal(c: TrackConfig, meters: number) {
  const a = pointFromFinish(c, meters - 0.05);
  const b = pointFromFinish(c, meters + 0.05);
  const dx = b.x - a.x, dy = b.y - a.y;
  const n = Math.hypot(dx, dy) || 1;
  // Kjøring mot klokka i y-ned-koordinater: utover er til høyre for fartsretningen.
  return { x: -dy / n, y: dx / n };
}
