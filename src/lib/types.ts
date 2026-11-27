/** En sammenhengende serie passeringer av start/mål (en "bolk"). */
export interface Block {
  index: number;
  /** Epoch ms for første passering ut fra tidtakingsklokka. Bare ca ±1 s nøyaktig. */
  startMs: number;
  /** Passeringstider i sekunder relativt til første passering. Nøyaktige på tusendeler. */
  passings: number[];
  /** Rundetider i sekunder (passings[i+1] - passings[i]). */
  lapTimes: number[];
  /** Runder som trolig inneholder stopp (mye lengre enn median i bolken). */
  slowLaps: boolean[];
}

export interface TimingSession {
  name: string;
  blocks: Block[];
}

/** Ett opptakspunkt fra Karoo (1 s). */
export interface RideSample {
  /** Epoch-millisekunder. */
  ms: number;
  speed: number | null; // m/s (hjulsensor eller beregnet fra kadens)
  cadence: number | null; // rpm
  hr: number | null; // bpm
  power: number | null; // W
}

export interface Ride {
  name: string;
  samples: RideSample[];
  /** Tidspunkt (epoch ms) for manuelle lap-trykk. */
  lapPresses: number[];
  /** Hvor farten kommer fra. 'cadence' = fastnav: kadens × meter per pedalomdreining. */
  speedSource: 'wheel' | 'cadence' | 'none';
  /** Meter per pedalomdreining, når farten er beregnet fra kadens. */
  metersPerRev?: number;
  hrSimulated?: boolean;
  /** Terskelwatt (FTP) fra Karoo-økta, hvis satt. */
  ftp?: number;
}

export interface Series {
  key: string;
  label: string;
  color: string;
  /** Tid i sekunder relativt til bolkens første passering. */
  t: number[];
  v: (number | null)[];
  /** Tegn som trapp (verdien gjelder til neste punkt). */
  step?: boolean;
  dashed?: boolean;
}
