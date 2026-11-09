import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/* base './' keeps asset paths relative, so the same build works in the desktop app,
   on GitHub Pages and when opened from a folder.
   `vite build --mode single` makes dist-single/index.html with everything inlined:
   one file you can double-click to play in a browser. */
export default defineConfig(({ mode }) => ({
  base: './',
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: {
    target: ['es2022', 'safari15', 'chrome105'],
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    chunkSizeWarningLimit: 1200,
    sourcemap: false
  }
}));
