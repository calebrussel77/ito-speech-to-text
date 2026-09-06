import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      sourcemap: true,
      rollupOptions: {
        external: ['sqlite3', 'bindings'],
        input: {
          main: resolve(__dirname, 'lib/main/main.ts'),
        },
      },
    },
    resolve: {
      alias: {
        '@/app': resolve(__dirname, 'app'),
        '@/lib': resolve(__dirname, 'lib'),
        '@/resources': resolve(__dirname, 'resources'),
      },
    },
    // `@breezystack/lamejs` is ESM-only; its `main` is an IIFE that sets a
    // global instead of exporting, so a runtime `require` from the MP3
    // worker yields nothing. Bundling it makes the worker self-contained.
    plugins: [externalizeDepsPlugin({ exclude: ['@breezystack/lamejs'] })],
  },

  preload: {
    build: {
      sourcemap: true,
      rollupOptions: {
        input: {
          preload: resolve(__dirname, 'lib/preload/preload.ts'),
        },
      },
    },
    resolve: {
      alias: {
        '@/app': resolve(__dirname, 'app'),
        '@/lib': resolve(__dirname, 'lib'),
        '@/resources': resolve(__dirname, 'resources'),
      },
    },
    plugins: [externalizeDepsPlugin()],
  },

  renderer: {
    root: './app',
    build: {
      sourcemap: true,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'app/index.html'),
        },
      },
    },
    resolve: {
      alias: {
        '@/app': resolve(__dirname, 'app'),
        '@/lib': resolve(__dirname, 'lib'),
        '@/resources': resolve(__dirname, 'resources'),
      },
    },
    plugins: [tailwindcss(), react()],
  },
})
