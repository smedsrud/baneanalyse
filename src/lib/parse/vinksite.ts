import { Decoder, Stream } from '@garmin/fitsdk';
import type { Block, TimingSession } from '../types';

/** "36.540" eller "1:13.585" -> sekunder */
function parseLapTime(s: string): number | null {
  s = s.trim();
  if (!s) return null;
  let sec = 0;
  for (const p of s.split(':')) sec = sec * 60 + parseFloat(p);
  return Number.isFinite(sec) ? sec : null;
}

/** "11:02:28" -> sekunder etter midnatt */
function parseClock(s: string): number {
  const [h, m, sec] = s.trim().split(':').map(Number);
  return h * 3600 + m * 60 + (sec || 0);
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/** Tidssone-forskyvning (minutter) for Europe/Oslo på en gitt dato. */
export function osloOffsetMinutes(date: string): number {
  const d = new Date(`${date}T12:00:00Z`);
  const local = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Oslo' }));
  const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((local.getTime() - utc.getTime()) / 60000);
}

function makeBlock(index: number, startMs: number, lapTimes: number[]): Block {
  const passings = [0];
  for (const lt of lapTimes) passings.push(passings[passings.length - 1] + lt);
  const med = median(lapTimes);
  return { index, startMs, passings, lapTimes, slowLaps: lapTimes.map((t) => t > med * 1.6) };
}

/**
 * VinkSite CSV (Lap,Laptime,Difference,Transit,Distance,Speed).
 * En rad uten Laptime er første passering i en ny bolk. Transit er lokal tid.
 * Dato må stå i filnavnet (YYYY-MM-DD).
 */
export function parseVinkCsv(text: string, fileName: string): TimingSession {
  const date = fileName.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
  if (!date) throw new Error('Fant ikke dato (YYYY-MM-DD) i filnavnet til CSV-fila');
  const midnightUtc = Date.parse(`${date}T00:00:00Z`) - osloOffsetMinutes(date) * 60000;

  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const iLap = header.indexOf('laptime');
  const iTransit = header.indexOf('transit');
  if (iLap < 0 || iTransit < 0) throw new Error('Fant ikke kolonnene Laptime og Transit');

  const raw: { startMs: number; laps: number[] }[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    const lap = parseLapTime(cols[iLap] ?? '');
    if (lap === null || !raw.length) {
      raw.push({ startMs: midnightUtc + parseClock(cols[iTransit]) * 1000, laps: [] });
      if (lap === null) continue;
    }
    raw[raw.length - 1].laps.push(lap);
  }
  return { name: fileName, blocks: raw.filter((b) => b.laps.length).map((b, i) => makeBlock(i, b.startMs, b.laps)) };
}

/**
 * VinkSite FIT: lap-meldinger med total_elapsed_time i tusendeler og start_time i hele sekunder (UTC).
 * Ny bolk når en lap ikke starter der forrige sluttet.
 */
export function parseVinkFit(buf: ArrayBuffer, fileName: string): TimingSession {
  const decoder = new Decoder(Stream.fromArrayBuffer(buf));
  const { messages } = decoder.read();
  const laps: any[] = messages.lapMesgs ?? [];
  if (!laps.length) throw new Error('Ingen runder i FIT-fila');

  const raw: { startMs: number; laps: number[] }[] = [];
  let prevEnd: number | null = null;
  for (const l of laps) {
    const start = new Date(l.startTime).getTime();
    if (prevEnd === null || start - prevEnd > 1500) raw.push({ startMs: start, laps: [] });
    raw[raw.length - 1].laps.push(l.totalElapsedTime);
    prevEnd = new Date(l.timestamp).getTime();
  }
  return { name: fileName, blocks: raw.map((b, i) => makeBlock(i, b.startMs, b.laps)) };
}

/** Er dette en VinkSite-FIT (syntetiske GPS-punkter, distance-laps) og ikke en Karoo-fil? */
export function isVinkFit(buf: ArrayBuffer): boolean {
  const { messages } = new Decoder(Stream.fromArrayBuffer(buf)).read();
  const laps: any[] = messages.lapMesgs ?? [];
  return laps.length > 0 && laps.every((l) => l.lapTrigger === 'distance');
}
