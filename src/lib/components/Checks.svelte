<script lang="ts">
  import type { Check } from '../analysis';
  let { checks }: { checks: Check[] } = $props();
  const icon = { good: '✓', warn: '!', info: 'i' };
</script>

<ul class="checks">
  {#each checks as c}
    <li class={c.verdict}>
      <span class="ic" aria-label={c.verdict === 'good' ? 'Bra' : c.verdict === 'warn' ? 'Se på' : 'Info'}>{icon[c.verdict]}</span>
      <div>
        <div><b>{c.label}</b> <span class="v">{c.value}</span></div>
        <div class="note">{c.note}</div>
      </div>
    </li>
  {/each}
</ul>

<style>
  .checks { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  li { display: flex; gap: 10px; align-items: flex-start; font-size: 13px; }
  .ic { flex: none; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 700; color: #fff; background: var(--text-secondary); }
  .good .ic { background: var(--status-good); }
  .warn .ic { background: var(--status-warn); }
  .v { color: var(--text-secondary); font-variant-numeric: tabular-nums; }
  .note { color: var(--text-secondary); font-size: 12px; }
</style>
