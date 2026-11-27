<script lang="ts">
  import { type TrackConfig, radius, pillPath, pointFromFinish, outwardNormal, offsetPath, bendFracAtMeters } from '../track';
  import { lateralToOffset } from '../line';

  let { config, meters, active = true, watt = null, lateral = 0 }: {
    config: TrackConfig; meters: number; active?: boolean; watt?: number | null;
    /** Sideposisjon: 0 = svart, 0.5 = blå, 1 = vantet. */
    lateral?: number;
  } = $props();

  const S = $derived(config.straight);
  const R = $derived(radius(config));
  const inner = 1.2; // blå sone innenfor svart strek (ca)
  const width = 5.5; // banebredde utenfor svart strek på langsidene (ca, sett ovenfra)
  const widthBend = 8; // bredest midt i svingen (ca, sett ovenfra)
  const pad = 3;
  const vb = $derived(`${-S / 2 - R - widthBend - pad} ${-R - widthBend - pad} ${S + 2 * (R + widthBend + pad)} ${2 * (R + widthBend + pad)}`);

  // Banebredde utenfor svart strek: jevn overgang fra langside til bredest midt i svingen
  const widthAt = (f: number | null) => (f === null ? width : width + (widthBend - width) * Math.sin(Math.PI * f) ** 2);
  const outerEdge = $derived(offsetPath(config, widthAt));
  // Blå strek: midt på banen på langsidene. I svingene (sett ovenfra, med dosering)
  // kommer den litt nærmere svart strek, ca 85 % av avstanden på langsidene.
  const blueBendFactor = 0.85;
  const blueAt = (f: number | null) => (width / 2) * (f === null ? 1 : 1 - (1 - blueBendFactor) * Math.sin(Math.PI * f) ** 2);
  const blueLine = $derived(offsetPath(config, blueAt));
  const innerEdge = $derived(pillPath(S, R - inner));

  // Tverrstreker ved gitt meter etter start/mål
  function cross(m: number, from = -inner, to = width) {
    const p = pointFromFinish(config, m);
    const n = outwardNormal(config, m);
    return { x1: p.x + n.x * from, y1: p.y + n.y * from, x2: p.x + n.x * to, y2: p.y + n.y * to };
  }
  const finish = $derived(cross(0));
  const hundred = $derived(cross(100));
  const pursuit = $derived(config.pursuit.map((m) => cross(m)));
  const dot = $derived.by(() => {
    const p = pointFromFinish(config, meters);
    if (!lateral) return p;
    const f = bendFracAtMeters(config, meters);
    const o = lateralToOffset(lateral, blueAt(f), widthAt(f));
    const n = outwardNormal(config, meters);
    return { x: p.x + n.x * o, y: p.y + n.y * o };
  });
  const labelPos = $derived(pointFromFinish(config, 0));
</script>

<svg viewBox={vb} class="track" role="img" aria-label="Banen med posisjon">
  <!-- Banedekke -->
  <path d="{outerEdge} {innerEdge}" class="surface" fill-rule="evenodd" />
  <!-- Sikkerhetssone innenfor -->
  <path d={pillPath(S, R - inner - 0.6 - 2)} class="safety" stroke-width="4" />
  <!-- Blå sone (côte d'azur) -->
  <path d={pillPath(S, R - inner / 2)} class="azur" stroke-width={inner} />
  <!-- Svart strek (200 m) og blå strek -->
  <path d={pillPath(S, R)} class="black" />
  <path d={blueLine} class="blue" />

  {#each pursuit as p}<line {...p} class="pursuit" />{/each}
  <line {...hundred} class="hundred" />
  <line {...finish} class="finish-w" />
  <line {...cross(0, width * 0.42, width * 0.58)} class="finish-b" />

  <text x={labelPos.x} y={labelPos.y + width + 2.4} class="label">Start/mål</text>
  <text x={pointFromFinish(config, 100).x} y={pointFromFinish(config, 100).y - width - 1} class="label">100 m</text>

  <!-- Watt midt i banen -->
  <text x="0" y="1.5" class="watt">{watt === null ? '–' : Math.round(watt)}</text>
  <text x="0" y="7" class="watt-unit">watt</text>

  <circle cx={dot.x} cy={dot.y} r="2.6" class="dot-ring" class:inactive={!active} />
  <circle cx={dot.x} cy={dot.y} r="1.8" class="dot" class:inactive={!active} />
</svg>

<style>
  .track { width: 100%; height: auto; display: block; }
  .surface { fill: var(--track-surface); stroke: none; }
  .safety { fill: none; stroke: var(--track-safety); }
  .azur { fill: none; stroke: var(--track-azur); }
  .black { fill: none; stroke: var(--track-line); stroke-width: 0.15; }
  .blue { fill: none; stroke: var(--track-blue); stroke-width: 0.15; }
  .pursuit { stroke: var(--track-red); stroke-width: 0.15; }
  .hundred { stroke: var(--track-line); stroke-width: 0.15; }
  .finish-w { stroke: var(--track-white); stroke-width: 0.35; }
  .finish-b { stroke: var(--track-line); stroke-width: 0.35; }
  .label { font-size: 2.2px; fill: var(--text-secondary); text-anchor: middle; }
  .watt { font-size: 13px; font-weight: 700; fill: var(--text-primary); text-anchor: middle; dominant-baseline: middle; font-variant-numeric: tabular-nums; }
  .watt-unit { font-size: 3px; fill: var(--text-secondary); text-anchor: middle; dominant-baseline: middle; }
  .dot { fill: var(--series-1); }
  .dot-ring { fill: var(--surface-1); }
  .dot.inactive { fill: var(--text-secondary); }
</style>
