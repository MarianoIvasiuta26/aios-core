import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = `http://127.0.0.1:${process.env.AGENT_OFFICE_PORT ?? 4317}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API, rewrite: (p) => p.replace(/^\/api/, '') },
      '/ws': { target: API, ws: true },
    },
  },
});
