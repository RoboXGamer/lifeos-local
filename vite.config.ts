import { defineConfig } from 'vite'
import solid from '@solidjs/vite-plugin'

export default defineConfig({
  // Classic SPA: index.html + src/index.tsx are the entry, output goes to dist/.
  // (The old turnkey `start: true` mode emitted dist/client instead.)
  plugins: [solid({ diagnostics: true })],
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
