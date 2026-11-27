<script lang="ts">
  import { parseVinkCsv, parseVinkFit, isVinkFit } from './lib/parse/vinksite';
  import { parseRideFit } from './lib/parse/fit';
  import type { Ride, TimingSession } from './lib/types';
  import { ASKER } from './lib/track';
  import { buildBlockView, fmtClock, fmtLap, fmtTime, valueAt } from './lib/model';
  import { fineAlign, offsetFromLapPresses, withCadenceSpeed, type AlignResult } from './lib/align';
  import { withSimulatedHr } from './lib/fake';
  import { lapLaterals, dataLateralAt, preStartLateral, lateralToOffset, FENCE } from './lib/line';
  import { TrackGeometry, defaultParams, extraToLateral } from './lib/track3d';
  import { detect, segmentLabel, TYPE_LABEL, type Segment } from './lib/detect';
  import { f200Report, intervalReport } from './lib/analysis';
  import TrackView from './lib/components/TrackView.svelte';
  import Track3D from './lib/components/Track3D.svelte';
  import Chart from './lib/components/Chart.svelte';
  import F200Panel from './lib/components/F200Panel.svelte';
  import IntervalPanel from './lib/components/IntervalPanel.svelte';

  const track = ASKER;

  let timing = $state.raw<TimingSession | null>(null);
  let rawRide = $state.raw<Ride | null>(null);
  let align = $state.raw<AlignResult | null>(null);
  let alignNote = $state('');
  let error = $state('');

  let blockIdx = $state(0);
  /** Karoo-tid minus tidtakingstid (ms). */
  let offsetMs = $state(0);
  let cursor = $state(0);
  let playing = $state(false);
  let rate = $state(1);
  let mode3d = $state(false);
  let tab = $state<'analysis' | 'laps' | 'settings'>('analysis');
  let bannerOpen = $state(true);
  // Fastnav-utveksling og hjulomkrets (brukes for rå fart når farten kommer fra kadens)
  let chainring = $state(60);
  let cog = $state(15);
  let circMm = $state(2105);
  /** Ekstra meter per runde → høyde i banen, fra 3D-modellen av banen (dosering og bredde). */
  const toHeight = extraToLateral(new TrackGeometry(track, defaultParams(track)), lateralToOffset, FENCE);
  const gearMpr = $derived((chainring / cog) * (circMm / 1000));
  const ride = $derived(rawRide && align?.useCadence ? withCadenceSpeed(rawRide, gearMpr) : rawRide);
  /** Synlig vindu i grafene (s), 0 = hele bolken. */
  let windowSec = $state(60);
  let winStart = $state(0);

  // Visning per bolk, og gjenkjenning over hele økta
  const views = $derived(timing ? timing.blocks.map((b) => buildBlockView(b, track.length, ride, offsetMs)) : []);
  const block = $derived(timing?.blocks[blockIdx] ?? null);
  const view = $derived(views[blockIdx] ?? null);
  const detection = $derived(views.length ? detect(views, track.length, ride?.ftp) : null);
  const efforts = $derived(detection?.segments.filter((s) => ['interval', 'tempo', 'f200', 'sprint'].includes(s.type)) ?? []);

  /** Målt distanse for en runde på svart strek (de raske rundene), i samme enhet som view.lapDist. */
  const refDist = $derived(align ? (align.useCadence ? align.perLap * gearMpr : align.perLap) : null);
  /** Ekstra meter per runde i forhold til svart strek, per bolk. */
  const lapExtraAll = $derived(views.map((v) => (v.lapDist && refDist ? v.lapDist.map((d) => track.length * (d / refDist - 1)) : null)));
  const lapExtra = $derived(lapExtraAll[blockIdx] ?? null);

  const f200s = $derived(
    detection ? detection.segments.filter((s) => s.type === 'f200').map((s) => f200Report(views[s.block], s, track.length, detection.ftp, lapExtraAll[s.block])) : [],
  );
  const intervalSegs = $derived(detection?.segments.filter((s) => s.type === 'interval' || s.type === 'tempo') ?? []);
  const intervals = $derived(
    detection && intervalSegs.length ? intervalReport(views, intervalSegs, detection.segments, track.length, !!ride?.hrSimulated) : null,
  );

  const pos = $derived(view?.positionAt(cursor) ?? null);
  const speedNow = $derived(view ? valueAt(view.speed[0], cursor) : null);
  const powerNow = $derived(view?.power[0] ? valueAt(view.power[0], cursor) : null);
  const laterals = $derived(view?.lapDist && refDist ? lapLaterals(view.lapDist, refDist, track.length, toHeight) : null);
  /** Høyde i banen fra distanse per runde (0 uten Karoo-data). */
  const lineAt = (t: number) => (laterals && block ? dataLateralAt(block, laterals, t) : 0);
  const lateral = $derived.by(() => {
    // Rullestart før første passering: sikkerhetssonen, så opp på banen og til linjen ved start/mål
    if (view?.moveStart != null && pos && pos.lap === null && cursor < 0) return preStartLateral(pos.meters, lineAt(0));
    return lineAt(cursor);
  });

  const bands = $derived(
    efforts.filter((s) => s.block === blockIdx).map((s) => ({ t0: s.t0, t1: s.t1, kind: s.type === 'f200' ? 'f200' : s.type === 'sprint' ? 'sprint' : 'interval' })),
  );

  /** Kort rapport på banen: under og like etter en F200 eller et intervall. */
  const card = $derived.by(() => {
    if (!block) return null;
    for (const r of f200s) {
      const s = r.segment;
      if (s.block !== blockIdx) continue;
      const a = block.passings[s.flyingLap!], e = block.passings[s.flyingLap! + 1];
      if (cursor >= a && cursor < e) return { kind: 'live' as const, title: `${segmentLabel(s)} pågår`, time: cursor - a };
      if (cursor >= e && cursor <= e + 25) return { kind: 'f200' as const, title: segmentLabel(s), r };
    }
    for (const row of intervals?.rows ?? []) {
      const s = row.segment;
      if (s.block === blockIdx && cursor >= s.t1 && cursor <= s.t1 + 15) return { kind: 'interval' as const, title: segmentLabel(s), row };
    }
    return null;
  });

  const win = $derived.by(() => {
    if (!view) return { t0: 0, t1: 1 };
    const span = view.t1 - view.t0;
    if (!windowSec || windowSec >= span) return { t0: view.t0, t1: view.t1 };
    const s = Math.min(Math.max(winStart, view.t0), view.t1 - windowSec);
    return { t0: s, t1: s + windowSec };
  });
  // Flytt vinduet når markøren går ut av det (avspilling, piltaster, glidebryter)
  $effect(() => {
    if (!view || !windowSec) return;
    const c = cursor;
    const { t0, t1 } = win;
    if (c < t0 || c > t1) winStart = c - windowSec * 0.2;
    else if (playing && c > t0 + windowSec * 0.8) winStart = c - windowSec * 0.2;
  });

  /** Kjør justering når både tidtaking og Karoo er lastet. */
  function runAlign() {
    align = null;
    alignNote = '';
    if (!timing || !rawRide) return;
    const presses = offsetFromLapPresses(timing.blocks, rawRide);
    const center = presses ?? 0;
    const a = fineAlign(timing.blocks, rawRide, center, presses !== null ? 5000 : 30000);
    if (!a) {
      offsetMs = center;
      alignNote = presses !== null ? 'Forskyvning fra lap-trykk' : 'Ingen fart eller kadens å justere mot';
      return;
    }
    align = a;
    offsetMs = a.offsetMs;
    alignNote = presses !== null ? 'lap-trykk + finjustering' : 'klokke + finjustering (ingen lap-trykk)';
  }

  async function loadTimingFile(buf: ArrayBuffer | string, name: string) {
    timing = typeof buf === 'string' ? parseVinkCsv(buf, name) : parseVinkFit(buf, name);
    selectBlock(0);
    bannerOpen = true;
  }
  async function onTiming(e: Event) {
    error = '';
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      await loadTimingFile(f.name.toLowerCase().endsWith('.csv') ? await f.text() : await f.arrayBuffer(), f.name);
      runAlign();
    } catch (err) { error = String(err); }
  }
  async function onRide(e: Event) {
    error = '';
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      const buf = await f.arrayBuffer();
      if (isVinkFit(buf)) throw new Error('Dette ser ut som en VinkSite-fil. Velg den under Tidtaking.');
      rawRide = parseRideFit(buf, f.name);
      bannerOpen = true;
      runAlign();
    } catch (err) { error = String(err); }
  }

  async function loadTestData() {
    error = '';
    try {
      const [v, k] = await Promise.all([
        fetch('demo/2026-11-20_Asker.csv').then((r) => { if (!r.ok) throw new Error('Fant ikke VinkSite-testfil'); return r.text(); }),
        fetch('demo/2026-11-20_Karoo.fit').then((r) => { if (!r.ok) throw new Error('Fant ikke Karoo-testfil'); return r.arrayBuffer(); }),
      ]);
      await loadTimingFile(v, '2026-11-20_Asker.csv');
      chainring = 60; cog = 15; circMm = 2105;
      let r = parseRideFit(k, 'Karoo 2026-11-20 19:15.fit');
      if (!r.samples.some((s) => s.hr !== null)) r = withSimulatedHr(r);
      rawRide = r;
      runAlign();
    } catch (err) { error = String(err); }
  }

  function selectBlock(i: number) {
    blockIdx = i;
    playing = false;
    cursor = 0;
    winStart = -5;
  }
  function jumpToLap(i: number) {
    if (!block) return;
    cursor = block.passings[i];
    winStart = cursor - 2;
  }
  /** Gå til et segment: velg bolk, sett vindu og markør, vis riktig analyse. */
  function goTo(s: Segment) {
    if (blockIdx !== s.block) selectBlock(s.block);
    const span = s.t1 - s.t0;
    windowSec = span <= 50 ? 60 : span <= 100 ? 120 : 300;
    cursor = s.t0 - 2;
    winStart = s.t0 - 5;
    tab = 'analysis';
  }
  function nudgeOffset(ms: number) { offsetMs += ms; }

  // Avspilling
  let last = 0;
  function tick(now: number) {
    if (!playing || !view) return;
    const dt = last ? (now - last) / 1000 : 0;
    last = now;
    cursor = Math.min(view.t1, cursor + dt * rate);
    if (cursor >= view.t1) { playing = false; return; }
    requestAnimationFrame(tick);
  }
  function togglePlay() {
    if (!view) return;
    playing = !playing;
    if (playing) {
      if (cursor >= view.t1) cursor = view.t0;
      last = 0;
      requestAnimationFrame(tick);
    }
  }
  function onKey(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || !view) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    const step = e.shiftKey ? 5 : 0.5;
    if (e.code === 'ArrowRight') { cursor = Math.min(view.t1, cursor + step); playing = false; }
    if (e.code === 'ArrowLeft') { cursor = Math.max(view.t0, cursor - step); playing = false; }
  }
  const scrub = () => (playing = false);
  const sign = (ms: number) => `${ms >= 0 ? '+' : '−'}${Math.abs(ms / 1000).toFixed(1)}`;
  const w = (x: number | null | undefined) => (x == null ? '–' : Math.round(x).toString());
  const blockTypes = (i: number) => [...new Set(efforts.filter((s) => s.block === i).map((s) => s.type))];
</script>

<svelte:window onkeydown={onKey} />

<div class="app">
  <header>
    <h1>Baneanalyse Asker</h1>
    <div class="files">
      <label class="file">Tidtaking (VinkSite CSV/FIT)<input type="file" accept=".csv,.fit" onchange={onTiming} /></label>
      <label class="file">Karoo (FIT)<input type="file" accept=".fit" onchange={onRide} /></label>
      <button onclick={loadTestData}>Prøv med eksempeldata (20.11)</button>
    </div>
    <div class="status">
      {#if timing}<span>{timing.name}: {timing.blocks.length} bolker, {timing.blocks.reduce((a, b) => a + b.lapTimes.length, 0)} runder</span>{/if}
      {#if rawRide}
        <span>{rawRide.name}:
          {rawRide.speedSource === 'wheel' ? 'hjulfart' : rawRide.speedSource === 'cadence' ? 'fart fra kadens' : 'ingen fart'},
          {rawRide.lapPresses.length} lap-trykk{ride?.hrSimulated ? ', puls simulert' : ''}</span>
      {/if}
      {#if error}<span class="err">{error}</span>{/if}
    </div>
  </header>

  {#if timing && view && block && detection}
    {#if bannerOpen && efforts.length}
      <div class="found" role="status">
        <span><b>Funnet:</b> {detection.summary}</span>
        <div class="chips">
          {#each efforts as s (s.id)}
            <button class="chip {s.type}" onclick={() => goTo(s)}>
              {segmentLabel(s)}
              <small>{s.type === 'f200' ? `${fmtLap(timing.blocks[s.block].lapTimes[s.flyingLap!])} s` : fmtTime(s.t1 - s.t0)}</small>
            </button>
          {/each}
        </div>
        <button class="close" onclick={() => (bannerOpen = false)} aria-label="Skjul">×</button>
      </div>
    {/if}

    <div class="blocks" role="tablist" aria-label="Bolker">
      {#each timing.blocks as b, i}
        <button role="tab" aria-selected={i === blockIdx} class:sel={i === blockIdx} onclick={() => selectBlock(i)}>
          <span>{fmtClock(b.startMs)}</span>
          <small>{b.lapTimes.length} r{#each blockTypes(i) as t}<i class="dot {t}" title={TYPE_LABEL[t]}></i>{/each}</small>
        </button>
      {/each}
    </div>

    <main class="stage">
      <div class="left">
        <div class="trackbox">
          <div class="toolbar" role="group" aria-label="Visning">
            <button class:sel={!mode3d} aria-pressed={!mode3d} onclick={() => (mode3d = false)}>2D</button>
            <button class:sel={mode3d} aria-pressed={mode3d} onclick={() => (mode3d = true)}>3D</button>
            <span class="sep"></span>
            <span class="muted">{laterals ? 'Høyde i banen fra distanse per runde' : 'Last inn Karoo-FIT for høyde i banen'}</span>
          </div>
          <div class="trackwrap">
            {#if mode3d}
              <Track3D config={track} meters={pos?.meters ?? 0} active={pos?.lap != null} watt={powerNow} {lateral} />
            {:else}
              <TrackView config={track} meters={pos?.meters ?? 0} active={pos?.lap != null} watt={powerNow} {lateral} />
            {/if}
            {#if card}
              <div class="card" aria-live="polite">
                {#if card.kind === 'live'}
                  <b>{card.title}</b><span class="big">{card.time.toFixed(1)} s</span>
                {:else if card.kind === 'f200'}
                  <b>{card.title}</b>
                  <div class="cardrow">
                    <div><span>Tid</span><strong>{fmtLap(card.r.lapTime)}</strong></div>
                    <div><span>Maks</span><strong>{w(card.r.maxW)} W</strong></div>
                    <div><span>Snitt</span><strong>{w(card.r.avgW)} W</strong></div>
                    <div><span>Fart</span><strong>{card.r.kmh.toFixed(1)}</strong></div>
                  </div>
                  <small>{card.r.checks.filter((c) => c.verdict === 'warn').map((c) => c.label).join(' · ') || 'Ingen anmerkninger'}</small>
                {:else}
                  <b>{card.title}</b>
                  <div class="cardrow">
                    <div><span>Tid</span><strong>{fmtTime(card.row.duration)}</strong></div>
                    <div><span>Snitt</span><strong>{w(card.row.avgW)} W</strong></div>
                    <div><span>Fart</span><strong>{card.row.kmh.toFixed(1)}</strong></div>
                    <div><span>Fall</span><strong>{card.row.fadeKmh.toFixed(1)} %</strong></div>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
          <dl class="now">
            <div><dt>Runde</dt><dd>{pos?.lap ?? '–'}<small> / {block.lapTimes.length}</small></dd></div>
            <div><dt>Posisjon</dt><dd>{pos?.lap != null ? pos.meters.toFixed(0) : '–'}<small> m</small></dd></div>
            <div><dt>Tid i runden</dt><dd>{pos?.lapTime != null ? pos.lapTime.toFixed(1) : '–'}<small> s</small></dd></div>
            <div><dt>Fart</dt><dd>{speedNow != null ? speedNow.toFixed(1) : '–'}<small> km/t</small></dd></div>
          </dl>
        </div>
        <div class="transport">
          <button class="play" onclick={togglePlay} aria-label={playing ? 'Pause' : 'Spill av'}>{playing ? '❚❚' : '▶'}</button>
          <select bind:value={rate} aria-label="Avspillingsfart">
            {#each [0.25, 0.5, 1, 2, 4, 8] as r}<option value={r}>{r}×</option>{/each}
          </select>
          <input type="range" min={view.t0} max={view.t1} step="0.05" bind:value={cursor} oninput={scrub} aria-label="Tidspunkt" />
          <span class="t">{fmtTime(cursor)} / {fmtTime(view.t1)}</span>
          <select bind:value={windowSec} aria-label="Vindu i grafene">
            <option value={30}>30 s</option><option value={60}>1 min</option><option value={120}>2 min</option><option value={300}>5 min</option><option value={0}>Hele</option>
          </select>
        </div>
      </div>

      <div class="charts">
        <Chart title="Fart" unit="km/t" digits={1} series={view.speed} t0={win.t0} t1={win.t1} passings={block.passings} {bands} bind:cursor onscrub={scrub} height={150} />
        <Chart title="Watt" unit="W" series={view.power} t0={win.t0} t1={win.t1} passings={block.passings} {bands} bind:cursor onscrub={scrub} height={140} />
        <Chart title="Kadens" unit="rpm" series={view.cadence} t0={win.t0} t1={win.t1} passings={block.passings} {bands} bind:cursor onscrub={scrub} height={90} />
        <Chart title={ride?.hrSimulated ? 'Puls (simulert)' : 'Puls'} unit="bpm" series={view.hr} t0={win.t0} t1={win.t1} passings={block.passings} {bands} bind:cursor onscrub={scrub} height={95} showAxis />
      </div>
    </main>

    <div class="tabs" role="tablist" aria-label="Detaljer">
      <button role="tab" aria-selected={tab === 'analysis'} class:sel={tab === 'analysis'} onclick={() => (tab = 'analysis')}>Analyse</button>
      <button role="tab" aria-selected={tab === 'laps'} class:sel={tab === 'laps'} onclick={() => (tab = 'laps')}>Runder</button>
      <button role="tab" aria-selected={tab === 'settings'} class:sel={tab === 'settings'} onclick={() => (tab = 'settings')}>Justering og utstyr</button>
    </div>

    {#if tab === 'analysis'}
      <section class="analysis">
        {#if !efforts.length}<p class="muted">Ingen harde drag funnet. Økta ser ut som rolig kjøring.</p>{/if}
        {#each f200s as r (r.segment.id)}
          <F200Panel report={r} title="{segmentLabel(r.segment)} · {fmtClock(timing.blocks[r.segment.block].startMs + r.segment.t0 * 1000)}" onjump={() => goTo(r.segment)} />
        {/each}
        {#if intervals}<IntervalPanel report={intervals} onjump={goTo} />{/if}
        {#if !rawRide && efforts.length}<p class="muted">Last inn Karoo-FIT for watt, kadens og vurdering av utførelsen.</p>{/if}
      </section>
    {:else if tab === 'laps'}
      <div class="laps">
        <table>
          <thead><tr><th>#</th><th>Rundetid</th><th>km/t</th>{#if lapExtra}<th title="Ekstra distanse i forhold til svart strek">+m</th>{/if}<th>Segment</th></tr></thead>
          <tbody>
            {#each block.lapTimes as lt, i}
              {@const seg = detection.segments.find((s) => s.block === blockIdx && s.type !== 'sprint' && i >= s.lapFrom && i <= s.lapTo)}
              <tr class:cur={pos?.lap === i + 1} class:slow={block.slowLaps[i]} onclick={() => jumpToLap(i)}>
                <td>{i + 1}</td><td>{fmtLap(lt)}</td><td>{((track.length / lt) * 3.6).toFixed(1)}</td>
                {#if lapExtra}<td class="extra">{lapExtra[i] >= 0 ? '+' : '−'}{Math.abs(lapExtra[i]).toFixed(1)}</td>{/if}
                <td class="seg">{seg ? segmentLabel(seg) : ''}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <section class="settings">
        {#if rawRide}
          <div class="row">
            <span><b>Tidsforskyvning Karoo</b> {sign(offsetMs)} s</span>
            <button onclick={() => nudgeOffset(-100)} aria-label="Forskyv −0,1 s">−0,1</button>
            <button onclick={() => nudgeOffset(100)} aria-label="Forskyv +0,1 s">+0,1</button>
            <button onclick={runAlign}>Auto</button>
            {#if align}<span class="muted">{alignNote}. Sannsynlig {sign(align.rangeMs[0])} til {sign(align.rangeMs[1])} s.</span>
            {:else if alignNote}<span class="muted">{alignNote}</span>{/if}
          </div>
          {#if align?.useCadence}
            <div class="row">
              <span><b>Fastnav</b></span>
              <input type="number" min="30" max="70" bind:value={chainring} aria-label="Klinge" />/<input type="number" min="10" max="20" bind:value={cog} aria-label="Tannhjul" />
              <span>omkrets</span><input type="number" min="2000" max="2200" bind:value={circMm} aria-label="Hjulomkrets mm" /><span>mm = {gearMpr.toFixed(3)} m/omdr.</span>
              <span class="muted">Rundene gir {(track.length / align.perLap).toFixed(3)} m/omdr. (raske runder), dvs. omkrets ca {((track.length / align.perLap) / (chainring / cog) * 1000).toFixed(0)} mm med denne utvekslingen.</span>
            </div>
          {/if}
          <div class="row"><span><b>FTP</b> {detection.ftp ?? '–'} W</span><span class="muted">{ride?.ftp ? 'fra Karoo' : 'anslått fra beste 5 min'}. Brukes til å kjenne igjen sprinter og vurdere tilløpet i F200.</span></div>
        {:else}
          <p class="muted">Last inn Karoo-FIT for å justere tid og utstyr.</p>
        {/if}
      </section>
    {/if}
    <p class="hint">Mellomrom spiller av og pauser. Piltastene flytter 0,5 s, med Shift 5 s. Dra i grafene for å flytte.</p>
  {:else}
    <p class="empty">Last inn tidtaking fra VinkSite (CSV eller FIT), og eventuelt Karoo-FIT. Eller trykk «Prøv med eksempeldata». Dine egne filer leses bare på denne enheten og sendes ikke noe sted.</p>
  {/if}
</div>

<style>
  .app { max-width: 1500px; margin: 0 auto; padding: 12px 16px 24px; }
  header { display: flex; flex-wrap: wrap; gap: 6px 20px; align-items: center; }
  h1 { font-size: 17px; margin: 0; }
  .files { display: flex; flex-wrap: wrap; gap: 8px; }
  .file { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; padding: 3px 8px; border: 1px solid var(--grid-strong); border-radius: 6px; cursor: pointer; }
  .file input { max-width: 180px; font-size: 12px; }
  .status { display: flex; gap: 4px 14px; font-size: 12px; color: var(--text-secondary); flex-wrap: wrap; }
  .err { color: var(--status-critical); }
  .muted { color: var(--text-secondary); font-size: 13px; }

  .found { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; margin-top: 10px; padding: 8px 12px; border-radius: 10px; background: var(--highlight); font-size: 13px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; flex: 1; }
  .chip { display: inline-flex; gap: 6px; align-items: baseline; border-left: 4px solid var(--series-1); }
  .chip.f200 { border-left-color: var(--series-2); }
  .chip.sprint { border-left-color: var(--series-7); }
  .chip small { color: var(--text-secondary); font-variant-numeric: tabular-nums; }
  .close { border: none; background: none; font-size: 18px; line-height: 1; padding: 0 4px; }

  .blocks { display: flex; gap: 4px; overflow-x: auto; margin: 10px 0; padding-bottom: 4px; }
  .blocks button { display: flex; flex-direction: column; align-items: center; padding: 3px 10px; font-variant-numeric: tabular-nums; }
  .blocks button small { color: var(--text-secondary); font-size: 11px; display: inline-flex; gap: 3px; align-items: center; }
  .blocks button.sel, .toolbar button.sel, .tabs button.sel { border-color: var(--series-1); box-shadow: inset 0 0 0 1px var(--series-1); }
  .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--series-1); }
  .dot.f200 { background: var(--series-2); }
  .dot.sprint { background: var(--series-7); }

  /* Bane og grafer side om side */
  .stage { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 16px; align-items: start; }
  .trackbox { background: var(--surface-2); border-radius: 10px; padding: 10px; }
  .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-bottom: 6px; }
  .toolbar .sep { width: 10px; }
  .toolbar button { padding: 2px 9px; }
  .toolbar button:disabled { opacity: 0.45; cursor: default; }
  .trackwrap { position: relative; }
  .card { position: absolute; right: 8px; bottom: 8px; max-width: min(340px, 70%); background: color-mix(in srgb, var(--surface-1) 92%, transparent);
    border: 1px solid var(--grid-strong); border-left: 4px solid var(--series-2); border-radius: 8px; padding: 8px 12px; font-size: 12px; box-shadow: 0 2px 10px rgba(0,0,0,.12); }
  .card b { display: block; font-size: 13px; }
  .card .big { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .cardrow { display: flex; gap: 14px; margin: 4px 0; }
  .cardrow div { display: flex; flex-direction: column; }
  .cardrow span { color: var(--text-secondary); font-size: 11px; }
  .cardrow strong { font-size: 17px; font-variant-numeric: tabular-nums; }
  .card small { color: var(--status-warn); }
  .now { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 6px 0 0; }
  .now div { min-width: 0; }
  .now dt { font-size: 12px; color: var(--text-secondary); }
  .now dd { margin: 0; font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .now small { font-size: 13px; font-weight: 400; color: var(--text-secondary); }
  .transport { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; }
  .transport input[type='range'] { flex: 1 1 160px; min-width: 0; }
  .play { width: 40px; }
  .t { font-variant-numeric: tabular-nums; font-size: 13px; min-width: 100px; }
  .charts { display: flex; flex-direction: column; gap: 6px; min-width: 0; }

  .tabs { display: flex; gap: 4px; margin: 18px 0 10px; border-bottom: 1px solid var(--grid); padding-bottom: 8px; }
  .analysis { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 460px), 1fr)); gap: 14px; }
  .settings { display: flex; flex-direction: column; gap: 10px; font-size: 13px; }
  .settings .row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; font-variant-numeric: tabular-nums; }
  .settings input { width: 60px; padding: 2px 4px; }

  .laps { max-height: 420px; overflow-y: auto; border: 1px solid var(--grid); border-radius: 10px; max-width: 520px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
  th { position: sticky; top: 0; background: var(--surface-1); text-align: right; font-weight: 600; padding: 6px 10px; border-bottom: 1px solid var(--grid); }
  td { text-align: right; padding: 3px 10px; }
  th:first-child, td:first-child { text-align: left; color: var(--text-secondary); }
  td.seg { text-align: left; color: var(--text-secondary); }
  tbody tr { cursor: pointer; }
  tbody tr:hover { background: var(--surface-2); }
  td.extra { color: var(--text-secondary); }
  tr.cur { background: var(--highlight); }
  tr.slow td { color: var(--text-secondary); font-style: italic; }

  .hint, .empty { font-size: 12px; color: var(--text-secondary); }
  .empty { margin-top: 40px; font-size: 14px; }

  @media (max-width: 1000px) {
    .stage { grid-template-columns: 1fr; }
  }
  @media (max-width: 600px) {
    .now { grid-template-columns: repeat(2, 1fr); }
  }
</style>
