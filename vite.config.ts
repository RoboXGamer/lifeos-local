import { defineConfig } from 'vite'
import solid from '@solidjs/vite-plugin'

export default defineConfig({
  // Turnkey client mode: no index.html, no mount file. The plugin generates the
  // shell around src/App.tsx and `vite build` emits static files into dist/client.
  // diagnostics: true needs `@solidjs/diagnostics` installed; off keeps logs clean.
  plugins: [solid({ start: true, diagnostics: true })],
  // Tauri expects a fixed port and shows Rust errors itself.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: '127.0.0.1',
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    target: 'esnext',
    assetsInlineLimit: 0,
  },
})
