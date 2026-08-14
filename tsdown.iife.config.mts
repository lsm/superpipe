import { defineConfig } from 'tsdown'

// IIFE build preserving the browser `Superpipe` global from the old UMD
// output. Kept as a separate config because the global name only applies
// to single-format builds.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['iife'],
  globalName: 'Superpipe',
  platform: 'browser',
  target: 'es2018',
  outDir: 'dist',
  outExtensions: () => ({ js: '.js' }),
  clean: false,
  minify: process.env.NODE_ENV === 'production',
})
