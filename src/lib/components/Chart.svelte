<script lang="ts">
  import type { Series } from '../types';
  import { valueAt, fmtTime } from '../model';

  let {
    title, unit, series, t0, t1, passings, digits = 0,
    cursor = $bindable(0), onscrub, height = 120, showAxis = false, bands = [],
  }: {
    title: string; unit: string; series: Series[]; t0: number; t1: number; passings: number[];
    digits?: number; cursor?: number; onscrub?: () => void; height?: number; showAxis?: boolean;
    /** Bakgrunnsfelt for segmenter (intervall, F200, sprint). */
    bands?: { t0: number; t1: number; kind: string }[];
  } = $props();

  let w = $state(600);
  const m = { l: 44, r: 12, t: 8, b: 6 };
  const axisH = $derived(showAxis ? 18 : 0);
  const pw = $derived(Math.max(10, w - m.l - m.r));
  const ph = $derived(height - m.t - m.b - axisH);

  const x = (t: number) => m.l + ((t - t0) / (t1 - t0 || 1)) * pw;

  // Y-domene fra data i vinduet
  const dom = $derived.by(() => {
    let lo = Infinity, hi = -Infinity;
    for (const s of series) for (let i = 0; i < s.t.length; i++) {
      const v = s.v[i];
      if (v === null || s.t[i] < t0 || s.t[i] > t1) continue;
      if (v < lo) lo = v; if (v > hi) hi = v;
    }
    if (!Number.isFinite(lo)) return null;
    if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
    const step = niceStep((hi - lo) / 3);
    return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step };
  });
  function niceStep(raw: number) {
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
  }
  const y = (v: number) => (dom ? m.t + ph - ((v - dom.lo) / (dom.hi - dom.lo)) * ph : 0);
  const yTicks = $derived(dom ? Array.from({ length: Math.round((dom.hi - dom.lo) / dom.step) + 1 }, (_, i) => dom.lo + i * dom.step) : []);
  const xTicks = $derived.by(() => {
    const step = niceStep((t1 - t0) / Math.max(2, pw / 90));
    const out: number[] = [];
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) out.push(t);
    return out;
  });

  function path(s: Series): string {
    let d = '', pen = false;
    for (let i = 0; i < s.t.length; i++) {
      const v = s.v[i];
      if (s.t[i] < t0 - 30 || s.t[i] > t1 + 30) continue;
      if (v === null) { pen = false; continue; }
      const X = x(s.t[i]).toFixed(1), Y = y(v).toFixed(1);
      if (!pen) { d += `M${X} ${Y}`; pen = true; }
      else d += s.step ? `H${X}V${Y}` : `L${X} ${Y}`;
      if (s.step && i + 1 < s.t.length) d += `H${x(s.t[i + 1]).toFixed(1)}`;
    }
    return d;
  }

  let dragging = false;
  function setFromEvent(e: PointerEvent) {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const t = t0 + ((e.clientX - r.left - m.l) / pw) * (t1 - t0);
    cursor = Math.min(t1, Math.max(t0, t));
    onscrub?.();
  }
  function down(e: PointerEvent) {
    dragging = true;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setFromEvent(e);
  }
  function move(e: PointerEvent) { if (dragging) setFromEvent(e); }
  function up() { dragging = false; }

  const readout = $derived(series.map((s) => ({ s, v: valueAt(s, cursor) })));
</script>

<div class="chart" bind:clientWidth={w}>
  <div class="head">
    <span class="title">{title}</span>
    {#each readout as r (r.s.key)}
      <span class="val">
        {#if series.length > 1}<i class="sw" class:dashed={r.s.dashed} style:--c={r.s.color}></i>{r.s.label}{/if}
        <b>{r.v === null ? '–' : r.v.toFixed(digits)}</b>
      </span>
    {/each}
    <span class="unit">{unit}</span>
  </div>
  {#if dom}
    <svg width={w} {height} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} role="slider" aria-label="{title}: dra for å flytte tidspunkt" aria-valuenow={cursor} tabindex="-1">
      {#each bands as b}
        {#if b.t1 > t0 && b.t0 < t1}
          <rect x={x(Math.max(t0, b.t0))} y={m.t} width={Math.max(1, x(Math.min(t1, b.t1)) - x(Math.max(t0, b.t0)))} height={ph} class="band {b.kind}" />
        {/if}
      {/each}
      {#each yTicks as v}
        <line x1={m.l} x2={m.l + pw} y1={y(v)} y2={y(v)} class="grid" />
        <text x={m.l - 6} y={y(v)} class="ytick">{v.toFixed(dom.step < 1 ? 1 : 0)}</text>
      {/each}
      {#each passings as p}
        {#if p >= t0 && p <= t1}<line x1={x(p)} x2={x(p)} y1={m.t} y2={m.t + ph} class="pass" />{/if}
      {/each}
      {#each series as s (s.key)}
        <path d={path(s)} class="line" class:dashed={s.dashed} style:stroke={s.color} />
      {/each}
      <line x1={x(cursor)} x2={x(cursor)} y1={m.t - 4} y2={m.t + ph} class="cursor" />
      {#if showAxis}
        {#each xTicks as t}
          <text x={x(t)} y={m.t + ph + 14} class="xtick">{fmtTime(t)}</text>
        {/each}
      {/if}
    </svg>
  {:else}
    <div class="empty" style:height="{height}px">Ingen data. Last inn Karoo-FIT.</div>
  {/if}
</div>

<style>
  .chart { width: 100%; user-select: none; }
  .head { display: flex; flex-wrap: wrap; gap: 4px 16px; align-items: baseline; font-size: 13px; padding-left: 44px; }
  .title { font-weight: 600; color: var(--text-primary); }
  .val { color: var(--text-secondary); display: inline-flex; align-items: baseline; gap: 6px; }
  .val b { color: var(--text-primary); font-variant-numeric: tabular-nums; font-size: 15px; }
  .unit { color: var(--text-secondary); }
  .sw { display: inline-block; width: 14px; height: 0; border-top: 2px solid var(--c); align-self: center; }
  .sw.dashed { border-top-style: dashed; }
  svg { display: block; cursor: ew-resize; touch-action: none; }
  .band { fill: var(--band-interval); }
  .band.f200 { fill: var(--band-f200); }
  .band.sprint { fill: var(--band-sprint); }
  .grid { stroke: var(--grid); stroke-width: 1; }
  .pass { stroke: var(--grid-strong); stroke-width: 1; }
  .ytick, .xtick { font-size: 11px; fill: var(--text-secondary); font-variant-numeric: tabular-nums; }
  .ytick { text-anchor: end; dominant-baseline: middle; }
  .xtick { text-anchor: middle; }
  .line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
  .line.dashed { stroke-width: 1.5; stroke-dasharray: 4 3; }
  .cursor { stroke: var(--text-primary); stroke-width: 1; }
  .empty { display: flex; align-items: center; padding-left: 44px; color: var(--text-secondary); font-size: 13px; border-top: 1px solid var(--grid); }
</style>
