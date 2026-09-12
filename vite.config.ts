import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/.scena/**', '**/.tools/**', '**/tmp/**', '**/outputs/**'],
    },
    fs: {
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.scena/**', '**/.tools/**', '**/tmp/**', '**/outputs/**', '**/AGENTS.md'],
    },
    proxy: {
      '/api': 'http://127.0.0.1:5174',
      '/media': 'http://127.0.0.1:5174',
      '/downloads': 'http://127.0.0.1:5174',
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:5174',
      '/media': 'http://127.0.0.1:5174',
      '/downloads': 'http://127.0.0.1:5174',
    },
  },
});
