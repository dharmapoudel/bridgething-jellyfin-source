import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { bridgething, daemonProxy } from './scripts/bridgething';

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss(), bridgething()],
  build: {
    target: 'es2022',
    sourcemap: false, // 0.1.0 shipped a 1.47MB .js.map in the sideload zip; keep bundles lean
  },
  server: {
    host: true,
    proxy: await daemonProxy(),
  },
}));
