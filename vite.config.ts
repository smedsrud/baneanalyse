import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // Relative stier, så appen virker under https://<bruker>.github.io/<repo>/ og fra hvor som helst ellers
  base: './',
  build: { chunkSizeWarningLimit: 1200 },
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'Baneanalyse Asker',
        short_name: 'Baneanalyse',
        description: 'Rundetider fra VinkSite koblet med Karoo-data, spilt av på banen.',
        lang: 'no',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#162134',
        theme_color: '#162134',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Alt appen trenger caches, så den virker uten nett på banen
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
})
