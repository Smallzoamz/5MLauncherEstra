import fs from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createApi } from './src/server/api.js';

const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  define: {
    __ESTRA_APP_VERSION__: JSON.stringify(pkg.version || '2.1.3')
  },
  plugins: [react(), {
    name: 'local-launcher-api',
    configureServer(server) { server.middlewares.use(createApi()); },
    configurePreviewServer(server) { server.middlewares.use(createApi()); }
  }],
  server: { port: 5199, strictPort: true, host: '127.0.0.1' },
  preview: { port: 5199, strictPort: true, host: '127.0.0.1' }
});

