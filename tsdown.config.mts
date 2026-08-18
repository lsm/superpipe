import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: { sourcemap: true },
  platform: 'neutral',
  target: 'es2018',
  outDir: 'dist',
  unbundle: false,
  
  
  
  
  cjsDefault: false,
  footer: (ctx) => ({
    js: ctx.format === 'cjs' ? 'module.exports = exports.default;' : '',
  }),
})
