/**
 * Verifies every Pexels photo ID referenced in src/data/images.ts.
 * Usage: node scripts/check-images.mjs
 */
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/data/images.ts', import.meta.url), 'utf8')
const ids = [...src.matchAll(/id:\s*(\d+)/g)].map((m) => m[1])

const unique = [...new Set(ids)]
const failures = []

for (const id of unique) {
  const url = `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=400`
  try {
    const res = await fetch(url, { method: 'HEAD' })
    console.log(`${res.ok ? 'OK  ' : 'FAIL'} ${id} ${res.status}`)
    if (!res.ok) failures.push(id)
  } catch (err) {
    console.log(`FAIL ${id} ${err.message}`)
    failures.push(id)
  }
}

console.log(`\n${unique.length} images checked, ${failures.length} failing`)
if (failures.length) {
  console.log('Failing IDs:', failures.join(', '))
  process.exitCode = 1
}
