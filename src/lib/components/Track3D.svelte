<script lang="ts">
  import { onMount } from 'svelte';
  import * as THREE from 'three';
  import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
  import type { TrackConfig } from '../track';
  import { TrackGeometry, defaultParams, patch } from '../track3d';
  import { lateralToOffset } from '../line';

  let { config, meters, active = true, watt = null, lateral = 0 }: {
    config: TrackConfig; meters: number; active?: boolean; watt?: number | null; lateral?: number;
  } = $props();

  let host: HTMLDivElement;
  let wattEl: HTMLDivElement | undefined = $state();
  let follow = $state(false);

  // Oppdateres fra props, leses i render-løkka
  let curMeters = 0;
  let curActive = true;
  let curLateral = 0;
  $effect(() => { curMeters = meters; curActive = active; curLateral = lateral; });

  let resetView = () => {};

  onMount(() => {
    const css = getComputedStyle(document.documentElement);
    const col = (name: string, fb: string) => new THREE.Color(css.getPropertyValue(name).trim() || fb);

    const tg = new TrackGeometry(config, defaultParams(config));
    const L = config.length;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = col('--surface-2', '#f5f5f4');
    scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(-30, 60, 40);
    scene.add(sun);

    const mat = (c: THREE.Color, extra: THREE.MeshStandardMaterialParameters = {}) =>
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, side: THREE.DoubleSide, ...extra });

    const N = 720;
    // Infield
    const infield = new THREE.Mesh(
      patch((d, u) => tg.point(d, -tg.p.inner - u * (tg.R - tg.p.inner - 0.5), -0.02), 0, L, N, 1),
      mat(col('--surface-1', '#ffffff')),
    );
    scene.add(infield);
    // Côte d'azur og banedekke
    scene.add(new THREE.Mesh(patch((d, u) => tg.point(d, -tg.p.inner * (1 - u)), 0, L, N, 1), mat(col('--track-azur', '#7fb3e6'))));
    scene.add(new THREE.Mesh(patch((d, u) => tg.point(d, u * tg.width(d)), 0, L, N, 4), mat(col('--track-surface', '#d9c7a5'))));
    // Sikkerhetssone innenfor côte d'azur
    scene.add(new THREE.Mesh(
      patch((d, u) => tg.point(d, -tg.p.inner - 0.6 - u * 4, -0.01), 0, L, N, 1),
      mat(col('--track-safety', '#9aa3ad')),
    ));
    // Vant langs ytterkanten
    scene.add(new THREE.Mesh(
      patch((d, u) => { const p = tg.point(d, tg.width(d)); p.y += u * 1.1; return p; }, 0, L, N, 1),
      mat(col('--grid-strong', '#d0d0d0'), { transparent: true, opacity: 0.55 }),
    ));

    // Streker langs banen
    const line = (sAt: (d: number) => number, w: number, c: THREE.Color) =>
      scene.add(new THREE.Mesh(patch((d, u) => tg.point(d, sAt(d) + (u - 0.5) * w, 0.02), 0, L, N, 1), mat(c)));
    line(() => 0, 0.08, col('--track-line', '#111111'));
    line((d) => tg.blue(d), 0.08, col('--track-blue', '#1d5fd1'));

    // Tverrstreker (meter etter start/mål)
    const cross = (m: number, w: number, c: THREE.Color, s0 = -tg.p.inner, s1?: (d: number) => number) => {
      const d = tg.dFromMeters(m);
      scene.add(new THREE.Mesh(
        patch((dd, u) => tg.point(dd, s0 + u * ((s1 ?? tg.width.bind(tg))(dd) - s0), 0.03), d - w / 2, d + w / 2, 1, 8),
        mat(c),
      ));
    };
    cross(0, 0.35, col('--track-white', '#ffffff'));
    for (const m of config.pursuit) cross(m, 0.08, col('--track-red', '#d22b2b'));
    cross(100, 0.08, col('--track-line', '#111111'));
    // Svart midtfelt i start/mål-streken
    {
      const d = tg.dFromMeters(0);
      scene.add(new THREE.Mesh(
        patch((dd, u) => tg.point(dd, -tg.p.inner + u * (tg.width(dd) + tg.p.inner), 0.035), d - 0.05, d + 0.05, 1, 8),
        mat(col('--track-line', '#111111')),
      ));
    }

    // Rytter: sykkel + kropp, står vinkelrett på dekket. x = fremover, y = opp fra dekket.
    const RIDER_SCALE = 1.8; // større enn virkelig, så den synes i oversikten
    const rider = new THREE.Group();
    const riderColor = col('--series-1', '#257de0');
    const riderMat = mat(riderColor.clone());
    const frameMat = mat(new THREE.Color('#ffffff'), { roughness: 0.35 });
    const wheelMat = mat(new THREE.Color('#222222'), { roughness: 0.5 });
    const up = new THREE.Vector3(0, 1, 0);
    /** Rør/lem mellom to punkter. */
    const limb = (a: [number, number, number], b: [number, number, number], r: number, m: THREE.Material) => {
      const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
      const dir = vb.clone().sub(va);
      const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, dir.length()), 4, 10), m);
      mesh.position.copy(va.clone().add(vb).multiplyScalar(0.5));
      mesh.quaternion.setFromUnitVectors(up, dir.normalize());
      rider.add(mesh);
    };
    // Hjul (dype felger)
    for (const x of [-0.5, 0.5]) {
      const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.025, 8, 32), wheelMat);
      tyre.position.set(x, 0.34, 0);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.03, 32, 1, true), wheelMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(x, 0.34, 0);
      rider.add(tyre, rim);
    }
    // Hvit ramme: sete, styre, krank
    const seat: [number, number, number] = [-0.2, 0.88, 0], head: [number, number, number] = [0.38, 0.84, 0];
    const bb: [number, number, number] = [-0.02, 0.3, 0], rearHub: [number, number, number] = [-0.5, 0.34, 0], frontHub: [number, number, number] = [0.5, 0.34, 0];
    limb(seat, head, 0.025, frameMat);
    limb(seat, bb, 0.03, frameMat);
    limb(head, bb, 0.035, frameMat);
    limb(bb, rearHub, 0.02, frameMat);
    limb(seat, rearHub, 0.018, frameMat);
    limb(head, frontHub, 0.022, frameMat);
    limb(head, [0.5, 0.78, 0], 0.02, frameMat); // stem/styre
    // Rytter i sprintposisjon
    const hip: [number, number, number] = [-0.2, 0.98, 0], shoulder: [number, number, number] = [0.32, 1.22, 0];
    limb(hip, shoulder, 0.17, riderMat);
    limb(hip, [0.08, 0.62, 0.1], 0.08, riderMat); // lår
    limb([0.08, 0.62, 0.1], [-0.02, 0.3, 0.12], 0.06, riderMat); // legg
    limb(shoulder, [0.5, 0.8, 0.12], 0.05, riderMat); // arm
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), riderMat);
    helmet.position.set(0.5, 1.36, 0);
    rider.add(helmet);
    rider.scale.setScalar(RIDER_SCALE);
    scene.add(rider);
    const riderMats = [riderMat as THREE.MeshStandardMaterial];

    // Kamera
    const camera = new THREE.PerspectiveCamera(45, 2, 0.5, 1000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = 4;
    controls.maxDistance = 250;
    resetView = () => {
      follow = false;
      camera.position.set(0, 55, 70);
      controls.target.set(0, 0, 0);
      controls.update();
    };
    resetView();

    const resize = () => {
      const w = host.clientWidth, h = Math.round(w * 0.6);
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    const basis = new THREE.Matrix4();
    const prevTarget = new THREE.Vector3();
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const d = tg.dFromMeters(curMeters);
      const t = tg.tangent(d), n = tg.surfaceNormal(d);
      const side = new THREE.Vector3().crossVectors(t, n).normalize();
      basis.makeBasis(t, n, side);
      rider.quaternion.setFromRotationMatrix(basis);
      const off = lateralToOffset(curLateral, tg.blue(d), tg.width(d));
      const s = curLateral < 0 ? off : Math.max(0.25, off);
      rider.position.copy(tg.point(d, s));
      for (const m of riderMats) m.color.copy(curActive ? riderColor : new THREE.Color('#999999'));

      if (follow) {
        // Flytt kamera og mål like mye som rytteren flyttet seg, så vinkelen beholdes
        const target = rider.position.clone().add(new THREE.Vector3(0, 0.8, 0));
        if (prevTarget.lengthSq() > 0) camera.position.add(target.clone().sub(prevTarget));
        controls.target.copy(target);
        prevTarget.copy(target);
      } else prevTarget.set(0, 0, 0);

      controls.update();
      renderer.render(scene, camera);

      // Watt midt i banen: projiser midten av infield til skjermen
      if (wattEl) {
        const p = new THREE.Vector3(0, 0.5, 0).project(camera);
        const visible = p.z < 1 && Math.abs(p.x) < 0.85 && Math.abs(p.y) < 0.85;
        if (visible) {
          const x = ((p.x + 1) / 2) * host.clientWidth, y = ((1 - p.y) / 2) * renderer.domElement.clientHeight;
          wattEl.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
        } else wattEl.style.transform = `translate(12px, 10px)`;
      }
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
      });
      renderer.domElement.remove();
    };
  });

  function toggleFollow() {
    follow = !follow;
  }
</script>

<div class="wrap">
  <div class="canvas" bind:this={host}></div>
  <div class="watt" bind:this={wattEl}>
    <b>{watt === null ? '–' : Math.round(watt)}</b><span>watt</span>
  </div>
  <div class="tools">
    <button onclick={toggleFollow} class:on={follow} aria-pressed={follow}>Følg rytter</button>
    <button onclick={() => resetView()}>Oversikt</button>
  </div>
  <p class="help">Dra for å rotere, scroll for zoom, høyreklikk og dra for å flytte.</p>
</div>

<style>
  .wrap { position: relative; }
  .canvas { width: 100%; border-radius: 8px; overflow: hidden; touch-action: none; }
  .canvas :global(canvas) { display: block; }
  .watt { position: absolute; top: 0; left: 0; display: flex; align-items: baseline; gap: 6px; pointer-events: none;
    background: color-mix(in srgb, var(--surface-1) 75%, transparent); padding: 2px 10px; border-radius: 8px; }
  .watt b { font-size: 34px; font-variant-numeric: tabular-nums; color: var(--text-primary); }
  .watt span { color: var(--text-secondary); font-size: 13px; }
  .tools { position: absolute; top: 10px; right: 10px; display: flex; gap: 6px; }
  .tools button.on { border-color: var(--series-1); box-shadow: inset 0 0 0 1px var(--series-1); }
  .help { margin: 4px 0 0; font-size: 12px; color: var(--text-secondary); }
</style>
