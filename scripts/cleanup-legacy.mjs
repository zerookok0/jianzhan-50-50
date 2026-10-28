/**
 * One-off cleanup after removing the WooCommerce client.
 * Run: node scripts/cleanup-legacy.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'

function edit(path, fn) {
  const before = readFileSync(path, 'utf8')
  const after = fn(before)
  if (after !== before) {
    writeFileSync(path, after, 'utf8')
    console.log('updated', path)
  } else {
    console.log('no change', path)
  }
}

/* ---- main.tsx: drop the mock bootstrap and mock.css ---- */
edit('src/main.tsx', (s) =>
  s
    .replace(/import '\.\/styles\/mock\.css'\r?\n/, '')
    .replace(
      /\r?\n\/\*\r?\n \* Development mock backend\.[\s\S]*?\r?\n\}\r?\n/,
      '\n',
    )
    .replace(/\r?\n\/\*\r?\n \* Development mock backend[\s\S]*?installMockStore\(\)\)\r?\n\}\r?\n/, '\n'),
)

/* ---- App.tsx: drop the MockGateway route ---- */
edit('src/App.tsx', (s) =>
  s
    .replace(/import \{ MockGateway \} from '\.\/pages\/MockGateway'\r?\n/, '')
    .replace(/\s*if \(path === '\/mock-gateway'\) return <MockGateway \/>/, ''),
)

console.log('\ndone')
