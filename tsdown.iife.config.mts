import { defineConfig } from 'tsdown'
import { renameSync } from 'node:fs'
import { join } from 'node:path'







const outDir = 'dist'

function iifeConfig(name: string, target: string, minify: boolean) {
  return defineConfig({
    entry: { [name]: 'src/index.ts' },
    format: ['iife'],
    globalName: 'Superpipe',
    platform: 'browser',
    target: 'es2018',
    outDir,
    clean: false,
    minify,
    onSuccess: () => {
      renameSync(join(outDir, `${name}.iife.js`), join(outDir, target))
    },
  })
}

export default defineConfig([
  iifeConfig('superpipe', 'superpipe.js', false),
  iifeConfig('superpipe-min', 'superpipe.min.js', true),
])
