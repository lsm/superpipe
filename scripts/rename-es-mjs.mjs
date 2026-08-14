// The ESM build emits ./es/**/*.js, but the package is "type": "commonjs".
// Node only loads those files as ESM when they carry the .mjs extension,
// so rename them after the tsc pass.
//
// The es/package.json marker declares the directory as ESM for TypeScript
// (without it, attw flags the .d.ts files as "masquerading as CJS").
//
// Declarations are renamed to .d.mts to match the .mjs implementations, and
// their relative imports rewritten to explicit .mjs specifiers: real ESM
// (Node) and node16 TypeScript resolution both reject extensionless imports.
import { readdirSync, renameSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../es', import.meta.url))

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
    const target = file.replace(/\.d\.ts$/, '.d.mts')
    const src = readFileSync(file, 'utf8')
    renameSync(file, target)
    writeFileSync(target, rewriteImports(src))
  }
})

writeFileSync(join(root, 'package.json'), '{ "type": "module" }\n')
console.log('rewrote es/: *.js -> *.mjs, *.d.ts -> *.d.mts, imports extended')
