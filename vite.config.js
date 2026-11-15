import fs from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { createApi } from './src/server/api.js';

const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

function estraAppObfuscator() {
  return {
    name: 'estra-app-obfuscator',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk' || !fileName.endsWith('.js')) continue;
        // Skip third-party vendor chunk to keep startup fast and avoid bloating React/Supabase internals
        if (fileName.includes('vendor')) continue;
        const result = JavaScriptObfuscator.obfuscate(chunk.code, {
          compact: true,
          controlFlowFlattening: true,
          controlFlowFlatteningThreshold: 0.25,
          deadCodeInjection: false,
          debugProtection: false,
          selfDefending: false,
          disableConsoleOutput: true,
          identifierNamesGenerator: 'hexadecimal',
          numbersToExpressions: false,
          renameGlobals: false,
          renameProperties: false,
          simplify: true,
          splitStrings: true,
          splitStringsChunkLength: 10,
          stringArray: true,
          stringArrayCallsTransform: true,
          stringArrayCallsTransformThreshold: 0.75,
          stringArrayEncoding: ['rc4'],
          stringArrayIndexShift: true,
          stringArrayRotate: true,
          stringArrayShuffle: true,
          stringArrayWrappersCount: 2,
          stringArrayWrappersChainedCalls: true,
          stringArrayWrappersParametersMaxCount: 4,
          stringArrayWrappersType: 'function',
          stringArrayThreshold: 0.8,
          target: 'browser'
        });
        chunk.code = result.getObfuscatedCode();
      }
    }
  };
}

export default defineConfig(({ command }) => ({
  define: {
    __ESTRA_APP_VERSION__: JSON.stringify(pkg.version || '2.2.2')
  },
  esbuild:
    command === 'build'
      ? {
          drop: ['debugger'],
          pure: ['console.log', 'console.debug', 'console.info'],
          legalComments: 'none'
        }
      : undefined,
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) return 'vendor';
        }
      }
    }
  },
  plugins: [
    react(),
    {
      name: 'local-launcher-api',
      configureServer(server) { server.middlewares.use(createApi()); },
      configurePreviewServer(server) { server.middlewares.use(createApi()); }
    },
    estraAppObfuscator()
  ],
  server: { port: 5199, strictPort: true, host: '127.0.0.1' },
  preview: { port: 5199, strictPort: true, host: '127.0.0.1' }
}));
