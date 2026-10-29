/**
 * Verifies the production bundle in dist/ is safe to drop into a
 * WordPress subdirectory (e.g. https://example.com/site/).
 *
 * Usage: node scripts/verify-dist.mjs
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const DIST = join(ROOT, 'dist')
const problems = []

if (!existsSync(DIST)) {
  console.error('dist/ does not exist — run `npm run build` first.')
  process.exit(1)
}

/* 1. index.html must have no root-absolute asset references */
const html = readFileSync(join(DIST, 'index.html'), 'utf8')
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1])
const absolute = refs.filter((r) => r.startsWith('/') && !r.startsWith('//'))

console.log(`index.html references: ${refs.length}`)
refs.forEach((r) => console.log(`  ${r.startsWith('/') ? 'ABSOLUTE' : 'relative'}  ${r}`))

if (absolute.length) {
  problems.push(`Root-absolute references in index.html: ${absolute.join(', ')}`)
}

/* 2. Every local reference must resolve to a real file */
for (const ref of refs) {
  if (/^(https?:|mailto:|tel:|data:|#|\/\/)/i.test(ref)) continue
  const target = join(DIST, ref.replace(/^\.\//, ''))
  if (!existsSync(target)) problems.push(`Missing file for reference: ${ref}`)
}

/* 3. Report emitted files */
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

const files = walk(DIST)
console.log('\nEmitted files:')
files.forEach((f) => {
  const kb = (statSync(f).size / 1024).toFixed(1)
  console.log(`  ${relative(DIST, f)}  ${kb} kB`)
})

/* 4. Guard against accidental source/absolute leftovers in the bundle */
const jsFile = files.find((f) => f.endsWith('.js'))
if (jsFile) {
  const js = readFileSync(jsFile, 'utf8')
  if (js.includes('VITE_BASE')) problems.push('Unresolved env placeholder found in bundle')
}

console.log('')
if (problems.length) {
  console.error('FAILED:')
  problems.forEach((p) => console.error(`  - ${p}`))
  process.exitCode = 1
} else {
  console.log('OK — bundle uses relative paths and all local files resolve.')
  console.log('Upload dist/ into your WordPress folder, e.g. /site/')
}
