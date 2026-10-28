/**
 * Rewrites relative imports in worker/ to include explicit .ts extensions.
 *
 * Why: Node's ESM resolver requires a full extension. `tsc` accepts
 * extensionless imports, and so does esbuild (which wrangler uses), so the
 * Worker builds fine — but `node --test` cannot load the modules without
 * them. Adding the extension satisfies all three.
 *
 * Usage: node scripts/add-ts-extensions.mjs
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (full.endsWith('.ts')) out.push(full)
  }
  return out
}

let changed = 0

for (const file of walk('worker')) {
  const source = readFileSync(file, 'utf8')

  // Match: from './x' | from '../x' | from '../x/y' — but only relative
  // specifiers without an extension.
  const rewritten = source.replace(
    /(from\s+['"])(\.\.?\/[^'"]+?)(['"])/g,
    (match, pre, spec, post) => {
      if (/\.(ts|js|json|css)$/.test(spec)) return match
      // Skip bare directory imports (rare) — append /index.ts instead.
      if (!/\.[a-z]+$/.test(spec)) return `${pre}${spec}.ts${post}`
      return match
    },
  )

  if (rewritten !== source) {
    writeFileSync(file, rewritten, 'utf8')
    changed++
    console.log('updated', file)
  }
}

console.log(`\n${changed} file(s) updated.`)
