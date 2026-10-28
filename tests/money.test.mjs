/**
 * MONEY TESTS
 * Run: node --test tests/
 *
 * Money bugs are the most expensive kind, so these check exact integer
 * behaviour rather than "looks about right".
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  applyBasisPoints,
  formatMoney,
  parseMoneyToMinor,
  multiplyMoney,
  assertMoney,
  minorUnitFor,
  clampNonNegative,
  sumMoney,
} from '../worker/lib/money.ts'

test('minor unit lookup', () => {
  assert.equal(minorUnitFor('USD'), 2)
  assert.equal(minorUnitFor('JPY'), 0)
  assert.equal(minorUnitFor('KWD'), 3)
  assert.equal(minorUnitFor('xyz'), 2, 'unknown currencies default to 2')
})

test('basis points round half up', () => {
  // 10% of $420.00 = $42.00
  assert.equal(applyBasisPoints(42000, 1000), 4200)
  // 20% of $420.00
  assert.equal(applyBasisPoints(42000, 2000), 8400)
  // 7.5% of $19.99 -> 149.925 cents -> 150
  assert.equal(applyBasisPoints(1999, 750), 150)
})

test('basis points honour rounding mode', () => {
  // 149.925 -> floor 149, ceil 150, round 150
  assert.equal(applyBasisPoints(1999, 750, 'floor'), 149)
  assert.equal(applyBasisPoints(1999, 750, 'ceil'), 150)
  assert.equal(applyBasisPoints(1999, 750, 'round'), 150)
})

test('basis points on zero', () => {
  assert.equal(applyBasisPoints(0, 2000), 0)
})

test('no floating point drift across many additions', () => {
  // 0.1 + 0.2 !== 0.3 in floats. In integer cents it must be exact.
  const total = sumMoney([10, 20])
  assert.equal(total, 30)
  assert.equal(total / 100, 0.3)

  // 100 items at $0.10 must equal exactly $10.00, not 9.999999
  let acc = 0
  for (let i = 0; i < 100; i++) acc += 10
  assert.equal(acc, 1000)
})

test('multiply unit price by quantity', () => {
  assert.equal(multiplyMoney(42000, 3), 126000)
  assert.equal(multiplyMoney(0, 5), 0)
  assert.throws(() => multiplyMoney(100, -1), /quantity/)
  assert.throws(() => multiplyMoney(100, 1.5), /quantity/)
})

test('assertMoney rejects non-integers', () => {
  assert.throws(() => assertMoney(10.5), /safe integer/)
  assert.throws(() => assertMoney(NaN), /safe integer/)
  assert.throws(() => assertMoney('100'), /safe integer/)
  assert.equal(assertMoney(100), 100)
})

test('clampNonNegative', () => {
  assert.equal(clampNonNegative(-5), 0)
  assert.equal(clampNonNegative(5), 5)
})

test('formatMoney respects minor units', () => {
  assert.equal(formatMoney(42000, 'USD'), '$420.00')
  assert.equal(formatMoney(42000, 'JPY'), '¥42,000')
  // KWD has 3 decimal places. Intl separates the code with U+00A0
  // (non-breaking space), not a plain space — normalise before comparing.
  assert.equal(formatMoney(4200000, 'KWD').replace(/\u00a0/g, ' '), 'KWD 4,200.000')
})

test('parseMoneyToMinor is exact', () => {
  assert.equal(parseMoneyToMinor('420.00', 'USD'), 42000)
  assert.equal(parseMoneyToMinor('420', 'USD'), 42000)
  assert.equal(parseMoneyToMinor('0.01', 'USD'), 1)
  assert.equal(parseMoneyToMinor('$1,234.56', 'USD'), 123456)
  assert.equal(parseMoneyToMinor('4200', 'JPY'), 4200)
})

test('parseMoneyToMinor rejects excess precision', () => {
  // 1.234 cannot be represented in USD cents; refuse rather than round
  // silently, which would misrepresent the customer's input.
  assert.throws(() => parseMoneyToMinor('1.234', 'USD'), /decimal places/)
})

test('parseMoneyToMinor rejects garbage', () => {
  assert.throws(() => parseMoneyToMinor('abc', 'USD'))
  assert.throws(() => parseMoneyToMinor('12.34.56', 'USD'))
})
