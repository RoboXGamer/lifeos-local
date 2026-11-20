import { defineConfig } from 'vite'
import solid from '@solidjs/vite-plugin'
import { request } from 'node:http'

const serviceUrl = process.env.LIFEOS_DEV_SERVICE_URL
const serviceProxy = {
  name: 'lifeos-dev-service',
  enforce: 'pre' as const,
  configureServer(server: import('vite').ViteDevServer) {
    if (!serviceUrl) return
    // Install before Solid's development server-function middleware.
    server.middlewares.use((req, res, next) => {
      const pathname = new URL(req.url || '/', serviceUrl).pathname
      if (pathname !== '/auth' && pathname !== '/api' && !pathname.startsWith('/_server')) return next()
      const upstream = request(new URL(req.url || '/', serviceUrl), { method: req.method, headers: req.headers }, response => {
        res.writeHead(response.statusCode || 502, response.headers)
        response.pipe(res)
      })
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('LifeOS service unavailable') })
      res.on('close', () => upstream.destroy())
      req.pipe(upstream)
    })
  },
}

export default defineConfig({
  plugins: [serviceProxy, solid({ diagnostics: true, start: { app: './src/Root.tsx', nodeServer: true, middleware: './src/server/middleware.ts' }, serverFunctions: true })],
  // The Electrobun development shell uses this origin for live reload.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: '127.0.0.1',
  },
  build: {
    target: 'esnext',
    assetsInlineLimit: 0,
  },
})
