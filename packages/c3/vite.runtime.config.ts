import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@c3': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist-runtime',
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      name: 'C3Runtime',
      formats: ['es'],
      fileName: () => 'c3-runtime.js',
    },
  },
});