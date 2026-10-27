import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Un solo index.html autocontenido: `compass serve` lo sirve y `compass export` le inyecta el grafo.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  server: { port: 5177, proxy: { '/api': 'http://127.0.0.1:4777' } },
  build: { outDir: 'dist', chunkSizeWarningLimit: 4000 },
});
