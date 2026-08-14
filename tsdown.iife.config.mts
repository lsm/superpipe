import { defineConfig } from 'tsdown'
import { renameSync } from 'node:fs'
import { join } from 'node:path'

// IIFE builds preserving the browser `Superpipe` global from the old UMD
// output (dist/superpipe.js / dist/superpipe.min.js). Separate config from
// the node formats because the global name only applies to single-format
// builds. Rolldown forces a `.iife` format suffix into the filename and
// both passes would otherwise collide on index.iife.js, so each pass gets
// a distinct entry name and renames to the historical filename.
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
