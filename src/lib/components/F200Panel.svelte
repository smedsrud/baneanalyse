<script lang="ts">
  import type { F200Report } from '../analysis';
  import { fmtLap } from '../model';
  import Checks from './Checks.svelte';

  let { report, title, onjump }: { report: F200Report; title: string; onjump?: () => void } = $props();
  const r = $derived(report);
  const w = (x: number | null) => (x === null ? '–' : Math.round(x).toString());
</script>

<section class="panel">
  <header>
    <h3>{title}</h3>
    {#if onjump}<button onclick={onjump}>Spill av</button>{/if}
  </header>
  <div class="kpis">
    <div><span>Tid 200 m</span><b>{fmtLap(r.lapTime)}</b><small>s</small></div>
    <div><span>Snittfart</span><b>{r.kmh.toFixed(1)}</b><small>km/t</small></div>
    <div><span>Maks watt på 200</span><b>{w(r.maxW)}</b><small>W</small></div>
    <div><span>Snittwatt på 200</span><b>{w(r.avgW)}</b><small>W</small></div>
    <div><span>Toppwatt totalt</span><b>{w(r.peakW)}</b><small>W</small></div>
    <div><span>Toppfart</span><b>{r.topKmh === null ? '–' : r.topKmh.toFixed(1)}</b><small>km/t</small></div>
  </div>
  {#if r.approachExtra?.length}
    <p class="muted">Tilløp: {r.approachExtra.map((x, i) => `runde ${r.segment.lapFrom + i + 1} +${x.toFixed(0)} m`).join(', ')} (høyde i banen fra distanse per runde).</p>
  {/if}
  <h4>Mot god utførelse</h4>
  <p class="muted">God utførelse: ta høyden billig, hopp fra toppen av banen, toppwatt i dykket og toppfart ved startstreken. Tersklene er tommelfingerregler, ikke fasit.</p>
  <Checks checks={r.checks} />
</section>

<style>
  .panel { border: 1px solid var(--grid); border-radius: 10px; padding: 14px 16px; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  h3 { margin: 0; font-size: 16px; }
  h4 { margin: 14px 0 4px; font-size: 13px; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; margin-top: 10px; }
  .kpis div { display: flex; flex-direction: column; }
  .kpis span { font-size: 12px; color: var(--text-secondary); }
  .kpis b { font-size: 22px; font-variant-numeric: tabular-nums; }
  .kpis small { color: var(--text-secondary); font-size: 12px; }
  .muted { color: var(--text-secondary); font-size: 12px; margin: 6px 0; }
</style>
