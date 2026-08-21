import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'

// https://vite.dev/config/
// ถอด @base44/vite-plugin ออก (ผูกกับ platform Base44)
// alias '@' ทดแทนสิ่งที่ plugin เคยตั้งให้
export default defineConfig({
  logLevel: 'error',
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  plugins: [react()],
  server: { port: 5173 },
  build: { outDir: 'dist', sourcemap: false },
})
