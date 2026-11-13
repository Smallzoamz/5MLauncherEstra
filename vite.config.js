import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createApi } from './src/server/api.js';
export default defineConfig({
  plugins: [react(), {
    name: 'local-launcher-api',
    configureServer(server) { server.middlewares.use(createApi()); },
    configurePreviewServer(server) { server.middlewares.use(createApi()); }
  }],
  server: { port: 5199, strictPort: true, host: '127.0.0.1' },
  preview: { port: 5199, strictPort: true, host: '127.0.0.1' }
});

