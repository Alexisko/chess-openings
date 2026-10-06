/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves the app from /<repo>/; the deploy workflow sets BASE_PATH.
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        id: base,
        name: 'Opening Trainer',
        short_name: 'Openings',
        description: 'Build and learn a chess opening repertoire with spaced repetition',
        start_url: base,
        scope: base,
        theme_color: '#140f0a',
        background_color: '#140f0a',
        // Installed, the app opens in its own window with no browser bars.
        display: 'standalone',
        orientation: 'portrait',
        categories: ['education', 'games'],
        // Long-press the app icon to jump straight into a session.
        shortcuts: [
          { name: 'Review', short_name: 'Review', url: `${base}train?mode=review`, icons: [{ src: 'icon-192.png', sizes: '192x192' }] },
          { name: 'Learn new moves', short_name: 'Learn', url: `${base}train?mode=learn`, icons: [{ src: 'icon-192.png', sizes: '192x192' }] },
        ],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,mp3}'],
        // The engine is large; cache it on first use instead of precaching.
        globIgnores: ['stockfish/**'],
        navigateFallback: `${base}index.html`,
        // Daily reminders: showing them and opening the app from them.
        importScripts: ['push-sw.js'],
        runtimeCaching: [
          {
            urlPattern: /\.woff2$/,
            handler: 'CacheFirst',
            options: { cacheName: 'fonts' },
          },
          {
            urlPattern: /\/stockfish\//,
            handler: 'CacheFirst',
            options: { cacheName: 'stockfish' },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    setupFiles: ['fake-indexeddb/auto'],
  },
})
