import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// SPA (appType 'spa' is the default): the dev/preview server falls back to
// index.html for unknown paths, so deep links and refresh work on every route.
export default defineConfig({
  plugins: [react()],
  server: { port: Number(process.env.WEB_PORT) || 5173 },
  preview: { port: Number(process.env.WEB_PORT) || 5173 },
});
