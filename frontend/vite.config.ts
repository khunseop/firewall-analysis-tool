import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        ws: true,
      },
    },
    watch: {
      usePolling: true,
      interval: 300,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // 대형 벤더 라이브러리를 별도 청크로 분리 (페이지 lazy 청크와 캐싱 분리)
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            if (id.includes('@ag-grid-community')) return 'vendor-ag-grid'
            if (id.includes('apexcharts')) return 'vendor-charts'
          }
        },
      },
    },
  },
})
