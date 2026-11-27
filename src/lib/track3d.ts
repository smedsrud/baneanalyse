import * as THREE from 'three';
import { type TrackConfig, radius, pillPoint } from './track';

/**
 * 3D-modell av banen. Bygger på samme pille som 2D (svart strek på 200 m),
 * med dosering som øker jevnt fra langside til midt i svingen.
 *
 * Koordinater: x og z i planet (z = SVG-y), y opp. s = avstand langs banedekket
 * utover fra svart strek (negativ = côte d'azur innenfor).
 */
export interface Track3DParams {
  bankStraight: number; // grader
  bankBend: number; // grader, midt i svingen
  widthStraight: number; // banedekke utenfor svart strek, m langs dekket
  widthBend: number;
  inner: number; // côte d'azur, m
  /** Blå strek, m langs dekket fra svart strek. */
  blueStraight: number;
  blueBend: number;
}

export function defaultParams(c: TrackConfig): Track3DParams {
  return {
    bankStraight: 13,
    bankBend: c.bankingBend,
    widthStraight: 6,
    widthBend: 9,
    inner: 1.2,
    blueStraight: 3,
    // Sett ovenfra ca 85 % av avstanden på langsidene: s·cos(46.7°) ≈ 0.85·3
    blueBend: (0.85 * 3) / Math.cos((c.bankingBend * Math.PI) / 180),
  };
}

const DEG = Math.PI / 180;

export class TrackGeometry {
  readonly S: number;
  readonly R: number;
  constructor(readonly c: TrackConfig, readonly p: Track3DParams) {
    this.S = c.straight;
    this.R = radius(c);
  }

  /** Andel gjennom svingen (0..1), eller null på langsiden. d langs svart strek fra start nederste langside. */
  bendFrac(d: number): number | null {
    const L = this.c.length, S = this.S, bend = Math.PI * this.R;
    d = ((d % L) + L) % L;
    if (d >= S && d < S + bend) return (d - S) / bend;
    if (d >= 2 * S + bend) return (d - 2 * S - bend) / bend;
    return null;
  }
  /** 0 på langside, 1 midt i svingen, jevn overgang. */
  bendWeight(d: number): number {
    const f = this.bendFrac(d);
    return f === null ? 0 : Math.sin(Math.PI * f) ** 2;
  }
  bank(d: number): number {
    const w = this.bendWeight(d);
    return (this.p.bankStraight + (this.p.bankBend - this.p.bankStraight) * w) * DEG;
  }
  width(d: number): number {
    const w = this.bendWeight(d);
    return this.p.widthStraight + (this.p.widthBend - this.p.widthStraight) * w;
  }
  blue(d: number): number {
    const w = this.bendWeight(d);
    return this.p.blueStraight + (this.p.blueBend - this.p.blueStraight) * w;
  }

  /** Planposisjon, fartsretning og normal utover. */
  frame(d: number) {
    const a = pillPoint(this.S, this.R, d - 0.05), b = pillPoint(this.S, this.R, d + 0.05), p = pillPoint(this.S, this.R, d);
    const tx = b.x - a.x, tz = b.y - a.y, n = Math.hypot(tx, tz) || 1;
    return { x: p.x, z: p.y, tx: tx / n, tz: tz / n, nx: -tz / n, nz: tx / n };
  }

  /** Punkt på banedekket. */
  point(d: number, s: number, lift = 0): THREE.Vector3 {
    const f = this.frame(d);
    if (s < 0) return new THREE.Vector3(f.x + f.nx * s, lift, f.z + f.nz * s); // côte d'azur er flat
    const b = this.bank(d);
    const h = s * Math.cos(b), y = s * Math.sin(b);
    // løft langs dekkets normal
    return new THREE.Vector3(f.x + f.nx * (h - lift * Math.sin(b)), y + lift * Math.cos(b), f.z + f.nz * (h - lift * Math.sin(b)));
  }

  /** Dekkets normal (opp fra banen). */
  surfaceNormal(d: number): THREE.Vector3 {
    const f = this.frame(d), b = this.bank(d);
    return new THREE.Vector3(-f.nx * Math.sin(b), Math.cos(b), -f.nz * Math.sin(b)).normalize();
  }
  tangent(d: number): THREE.Vector3 {
    const f = this.frame(d);
    return new THREE.Vector3(f.tx, 0, f.tz);
  }

  /** d (fra start nederste langside) for meter etter start/mål. */
  dFromMeters(m: number) {
    return this.c.finishAt + m;
  }
}

/**
 * Lager en flate over d ∈ [d0, d1] og u ∈ [0, 1] fra en punktfunksjon.
 */
export function patch(pf: (d: number, u: number) => THREE.Vector3, d0: number, d1: number, nd: number, nu = 1): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= nd; i++) {
    const d = d0 + ((d1 - d0) * i) / nd;
    for (let j = 0; j <= nu; j++) {
      const v = pf(d, j / nu);
      pos.push(v.x, v.y, v.z);
    }
  }
  const row = nu + 1;
  for (let i = 0; i < nd; i++)
    for (let j = 0; j < nu; j++) {
      const a = i * row + j, b = a + row;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Rundelengde (m) i 3D-modellen for en fast sideposisjon h (0 = svart, 0.5 = blå, 1 = vantet).
 * Følger dekket med dosering, så høyere i banen gir lengre runde, mest i svingene.
 */
export function lapLengthAt(tg: TrackGeometry, h: number, toOffset: (h: number, blue: number, fence: number) => number, n = 1600): number {
  const L = tg.c.length;
  let sum = 0;
  let prev = tg.point(0, toOffset(h, tg.blue(0), tg.width(0)));
  for (let i = 1; i <= n; i++) {
    const d = (i / n) * L;
    const p = tg.point(d, toOffset(h, tg.blue(d), tg.width(d)));
    sum += p.distanceTo(prev);
    prev = p;
  }
  return sum;
}

/**
 * Lager en funksjon som gjør ekstra meter per runde (i forhold til svart strek) om til høyde h,
 * ut fra banemodellen. Begrenset til [0, maxH].
 */
export function extraToLateral(tg: TrackGeometry, toOffset: (h: number, blue: number, fence: number) => number, maxH: number): (extra: number) => number {
  const base = lapLengthAt(tg, 0, toOffset);
  const hs: number[] = [], ex: number[] = [];
  for (let h = 0; h <= maxH + 1e-9; h += 0.025) { hs.push(h); ex.push(lapLengthAt(tg, h, toOffset, 800) - base); }
  return (extra: number) => {
    if (extra <= 0) return 0;
    if (extra >= ex[ex.length - 1]) return maxH;
    let i = 1;
    while (ex[i] < extra) i++;
    const f = (extra - ex[i - 1]) / (ex[i] - ex[i - 1]);
    return hs[i - 1] + f * (hs[i] - hs[i - 1]);
  };
}
