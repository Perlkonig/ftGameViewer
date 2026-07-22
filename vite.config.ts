import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import * as path from "path";
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const file = fileURLToPath(new URL('package.json', import.meta.url));
const json = readFileSync(file, 'utf8');
const pkg = JSON.parse(json);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [svelte()],
  define: {
    '__APP_VERSION__': JSON.stringify(pkg.version),
  },
  base: process.env.NODE_ENV === 'production' ? '/ftGameViewer/' : '/',
  resolve: {
    alias: [
      {
        find: "@", replacement: path.resolve("./src")
      }
    ]
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
    alias: {
      ftlibship: path.resolve("./src/lib/game/__mocks__/ftlibship.ts"),
    },
  },
})
