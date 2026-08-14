// The ESM build emits ./es/**/*.js, but the package is "type": "commonjs".
// Node only loads those files as ESM when they carry the .mjs extension,
// so rename them after the tsc pass.
//
// The es/package.json marker declares the directory as ESM for TypeScript
// (without it, attw flags the .d.ts files as "masquerading as CJS").
//
// Declaration and implementation files also get their relative imports
// rewritten to carry explicit .mjs extensions: real ESM (Node) and
// node16 TypeScript resolution both reject extensionless specifiers.
import { readdirSync, renameSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../es', import.meta.url).pathname

function walk(dir, fn) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      walk(full, fn)
    } else {
      fn(full)
    }
  }
}

function rewriteImports(src) {
  return src.replace(
    /(from\s+')(\.\.?\/[^']+)(?=')/g,
    (m, kw, spec) => (spec.endsWith('.mjs') ? m : `${kw}${spec}.mjs`)
  )
}

walk(root, (file) => {
  if (file.endsWith('.js')) {
    const target = file.replace(/\.js$/, '.mjs')
    const src = readFileSync(file, 'utf8')
    renameSync(file, target)
    const rewritten = rewriteImports(src)
    if (rewritten !== src) writeFileSync(target, rewritten)
  } else if (file.endsWith('.d.ts')) {
    const src = readFileSync(file, 'utf8')
    const rewritten = rewriteImports(src)
    if (rewritten !== src) writeFileSync(file, rewritten)
  }
})

writeFileSync(join(root, 'package.json'), '{ "type": "module" }\n')
console.log('renamed es/**/*.js -> es/**/*.mjs; rewrote d.ts imports; wrote es/package.json marker')
