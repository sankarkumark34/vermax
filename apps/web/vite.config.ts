import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5190,
    strictPort: true,
    proxy: { '/api': { target: process.env.VITE_API_URL ?? 'http://127.0.0.1:4100', changeOrigin: true } },
  },
})
