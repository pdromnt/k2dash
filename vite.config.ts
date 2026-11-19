import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

const env = loadEnv('', process.cwd(), '')
const HOST = env.VITE_PRINTER_HOST || '127.0.0.1'
const API_PORT = env.VITE_API_PORT || '7125'
const WEBCAM_PORT = env.VITE_WEBCAM_PORT || '8000'
const UPLOAD_PORT = env.VITE_UPLOAD_PORT || '80'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  server: {
    proxy: {
      '/api/moonraker': {
        target: `http://${HOST}:${API_PORT}`,
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace('/api/moonraker', ''),
      },
      '/api/printer-upload': {
        target: `http://${HOST}:${UPLOAD_PORT}`,
        changeOrigin: true,
        rewrite: (path) => path.replace('/api/printer-upload', ''),
      },
      '/api/printer-camera': {
        target: `http://${HOST}:${WEBCAM_PORT}`,
        changeOrigin: true,
        rewrite: (path) => path.replace('/api/printer-camera', ''),
      },
      '/api/printer-ws': {
        target: `ws://${HOST}:9999`,
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace('/api/printer-ws', ''),
      },
    },
  },
})
