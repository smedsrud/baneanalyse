import { Decoder, Stream } from '@garmin/fitsdk';
import type { Ride, RideSample } from '../types';

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** Leser Karoo-FIT: 1 s record-punkter og manuelle lap-trykk. */
export function parseRideFit(buf: ArrayBuffer, name: string): Ride {
  const decoder = new Decoder(Stream.fromArrayBuffer(buf));
  if (!decoder.isFIT()) throw new Error('Ikke en FIT-fil');
  const { messages, errors } = decoder.read();
  if (errors.length) console.warn('FIT-feil', errors);

  const records: any[] = messages.recordMesgs ?? [];
  const samples: RideSample[] = records.map((r) => ({
    ms: new Date(r.timestamp).getTime(),
    speed: num(r.enhancedSpeed ?? r.speed),
    cadence: num(r.cadence),
    hr: num(r.heartRate),
    power: num(r.power),
  }));

  // Siste lap-melding er avslutningen av økta, ikke et trykk.
  const lapMsgs: any[] = messages.lapMesgs ?? [];
  const lapPresses = lapMsgs
    .slice(0, -1)
    .filter((l) => l.lapTrigger === 'manual')
    .map((l) => new Date(l.timestamp).getTime());

  const hasWheel = samples.some((s) => (s.speed ?? 0) > 0);
  const hasCadence = samples.some((s) => (s.cadence ?? 0) > 0);
  if (!hasWheel) for (const s of samples) s.speed = null;
  if (!samples.some((s) => (s.hr ?? 0) > 0)) for (const s of samples) s.hr = null;

  const ftp = num(messages.sessionMesgs?.[0]?.thresholdPower) ?? undefined;
  return { name, samples, lapPresses, speedSource: hasWheel ? 'wheel' : hasCadence ? 'cadence' : 'none', ftp };
}
