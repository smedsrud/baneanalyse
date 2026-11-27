<script lang="ts">
  import type { IntervalReport } from '../analysis';
  import { segmentLabel, type Segment } from '../detect';
  import { fmtTime } from '../model';
  import Checks from './Checks.svelte';

  let { report, onjump }: { report: IntervalReport; onjump?: (s: Segment) => void } = $props();
  const r = $derived(report);
  const first = $derived(r.rows[0]);
  const pct = (x: number | null) => (x === null ? '–' : `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)} %`);
  const maxW = $derived(Math.max(1, ...r.rows.map((x) => x.avgW ?? 0)));
  const hasW = $derived(r.rows.some((x) => x.avgW !== null));
  const hasHr = $derived(r.rows.some((x) => x.avgHr !== null));
</script>

<section class="panel">
  <header><h3>Intervaller ({r.rows.length})</h3></header>
  <div class="tablewrap">
    <table>
      <thead>
        <tr>
          <th>Drag</th><th>Varighet</th><th>Runder</th>
          {#if hasW}<th>Snittwatt</th><th class="barcol" aria-label="Watt i forhold til beste"></th>{/if}
          <th>km/t</th><th title="Variasjon i rundetid">Jevnhet</th><th title="Fart, siste mot første tredjedel">Fall i draget</th>
          {#if hasW}<th title="Snittwatt i forhold til første drag">Mot første</th>{/if}
          {#if hasHr}<th>Puls</th>{/if}
          <th>Pause før</th><th></th>
        </tr>
      </thead>
      <tbody>
        {#each r.rows as x}
          <tr>
            <td>{segmentLabel(x.segment)}</td>
            <td>{fmtTime(x.duration)}</td>
            <td>{x.laps}</td>
            {#if hasW}
              <td>{x.avgW === null ? '–' : Math.round(x.avgW)}</td>
              <td class="barcol"><span class="bar" style:width="{((x.avgW ?? 0) / maxW) * 100}%"></span></td>
            {/if}
            <td>{x.kmh.toFixed(1)}</td>
            <td>{x.lapCv.toFixed(1)} %</td>
            <td>{pct(x.fadeKmh)}</td>
            {#if hasW}<td>{first.avgW && x.avgW ? pct(((x.avgW - first.avgW) / first.avgW) * 100) : '–'}</td>{/if}
            {#if hasHr}<td>{x.avgHr === null ? '–' : Math.round(x.avgHr)}</td>{/if}
            <td>{x.restBefore === null ? '–' : fmtTime(x.restBefore)}</td>
            <td>{#if onjump}<button onclick={() => onjump(x.segment)}>Vis</button>{/if}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <h4>Vurdering</h4>
  <p class="muted">Jevn fordeling innen hvert drag og lite fall fra første til siste drag er som regel tegn på god disponering. Tersklene er tommelfingerregler.</p>
  <Checks checks={r.checks} />
</section>

<style>
  .panel { border: 1px solid var(--grid); border-radius: 10px; padding: 14px 16px; }
  h3 { margin: 0; font-size: 16px; }
  h4 { margin: 14px 0 4px; font-size: 13px; }
  .tablewrap { overflow-x: auto; margin-top: 8px; }
  table { border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; width: 100%; }
  th { text-align: right; font-weight: 600; padding: 4px 8px; border-bottom: 1px solid var(--grid); white-space: nowrap; }
  td { text-align: right; padding: 4px 8px; white-space: nowrap; }
  th:first-child, td:first-child { text-align: left; }
  .barcol { width: 90px; text-align: left; }
  .bar { display: block; height: 8px; border-radius: 0 4px 4px 0; background: var(--series-7); }
  .muted { color: var(--text-secondary); font-size: 12px; margin: 6px 0; }
  button { padding: 2px 8px; }
</style>
