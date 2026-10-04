import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Racing, model storage, and AI training all run in the browser. Pages only
// serves these static assets; there is no Worker or server-side application.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  css: { postcss: { plugins: [tailwindcss()] } },
  worker: { format: 'es' },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
  build: { outDir: 'dist' },
});
