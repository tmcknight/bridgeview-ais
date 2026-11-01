import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

// nginx also serves the plain pages under /api/pages/ (Cloudflare Access leaves
// /api/ open); do the same in dev, from public/, before /api is proxied
function apiPages(): Plugin {
  return {
    name: 'api-pages',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const match = req.url?.match(/^\/api\/pages\/((?:about|support|privacy|terms)\.html|pages\.css|favicon\.png|icon-192\.png)$/)
        if (match) req.url = `/${match[1]}`
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [apiPages(), react(), tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, '../index.html'),
        admin: resolve(import.meta.dirname, '../admin.html'),
      },
    },
  },
  server: {
    // The admin page's API and uploaded photos, served by the WebSocket server
    proxy: { '/api': 'http://localhost:3001' },
  },
})
