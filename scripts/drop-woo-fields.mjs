/**
 * Removes WooCommerce-era fields from the demo catalogue and deletes the
 * now-unused purchase-URL resolver.
 *
 * The store is first-party now (Worker + D1), so `purchaseUrl`, `wooId`
 * and `wooVariationId` no longer exist on the Product/Variant types.
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'

let changed = 0

/* ---- 1. products.ts: drop purchaseUrl / wooId / wooVariationId ---- */

const productsPath = 'src/data/products.ts'
if (existsSync(productsPath)) {
  const before = readFileSync(productsPath, 'utf8')
  let after = before

  // Whole lines of these keys, whatever the indentation.
  after = after.replace(/^\s*purchaseUrl:\s*null,\s*\n/gm, '')
  after = after.replace(/^\s*wooId:\s*null,\s*\n/gm, '')
  after = after.replace(/^\s*wooVariationId:\s*null,\s*\n/gm, '')
  after = after.replace(/^\s*\/\* ↓ Paste your WooCommerce product ID here\. \*\/\s*\n/gm, '')

  // Inline variants: { id, label, purchaseUrl: null, wooVariationId: null }
  after = after.replace(/,\s*purchaseUrl:\s*null/g, '')
  after = after.replace(/,\s*wooVariationId:\s*null/g, '')

  if (after !== before) {
    writeFileSync(productsPath, after)
    console.log('updated', productsPath)
    changed++
  } else {
    console.log('unchanged', productsPath)
  }
}

/* ---- 2. purchase.ts: no longer meaningful ---- */

const purchasePath = 'src/lib/purchase.ts'
if (existsSync(purchasePath)) {
  unlinkSync(purchasePath)
  console.log('removed', purchasePath, '(buy links are server-driven now)')
  changed++
}

/* ---- 3. Anything still importing purchase.ts ---- */

const candidates = ['src/components/ui/QuickView.tsx', 'src/pages/ProductPage.tsx']
for (const file of candidates) {
  if (!existsSync(file)) continue
  const before = readFileSync(file, 'utf8')
  const after = before
    .replace(/^import\s*\{[^}]*\}\s*from\s*['"][^'"]*lib\/purchase['"]\s*\n/gm, '')
    .replace(/^import\s*\w+\s*from\s*['"][^'"]*lib\/purchase['"]\s*\n/gm, '')
  if (after !== before) {
    writeFileSync(file, after)
    console.log('updated', file)
    changed++
  }
}

console.log(`\ndone — ${changed} file(s) changed`)
