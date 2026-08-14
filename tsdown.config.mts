import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: { sourcemap: true },
  platform: 'neutral',
  target: 'es2018',
  outDir: 'dist',
  unbundle: false,
  // Keep the CJS shape every published version has shipped: both
  // `require('superpipe')` (directly callable) and
  // `require('superpipe').default` resolve to the factory, matching the
  // declaration's `export default` for TS interop.
  cjsDefault: false,
  footer: (ctx) => ({
    js: ctx.format === 'cjs' ? 'module.exports = exports.default;' : '',
  }),
})
