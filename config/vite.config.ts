import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
