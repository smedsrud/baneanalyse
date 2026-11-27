import type { Ride } from './types';

/**
 * Simulert puls fra watt, bare for testing når Karoo-fila mangler puls.
 * Førsteordens respons mot et mål (hvilepuls + k × watt), raskere opp enn ned.
 */
export function withSimulatedHr(ride: Ride, rest = 75, perWatt = 0.27, max = 192): Ride {
  let hr = rest + 20;
  const samples = ride.samples.map((s, i) => {
    const dt = i ? (s.ms - ride.samples[i - 1].ms) / 1000 : 1;
    const target = Math.min(max, rest + perWatt * (s.power ?? 0));
    const tau = target > hr ? 22 : 45;
    hr += (target - hr) * (1 - Math.exp(-dt / tau));
    return { ...s, hr: Math.round(hr) };
  });
  return { ...ride, samples, hrSimulated: true };
}
