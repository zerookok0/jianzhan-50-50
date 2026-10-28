/**
 * SQL COMMENT STRIPPING TESTS
 *
 * The claim under test: stripping comments never removes SQL.
 *
 * This exists because the previous implementation failed exactly here. It
 * stripped `--` line comments first, which deleted the closing delimiter of
 * banner comments shaped like the ones in migrations/0003, so the
 * block-comment pass then ran until the next closing delimiter and ate the
 * CREATE TABLE statements in between. The migration checker reported missing
 * tables for SQL that was correct.
 *
 * Each test below is a case the two-regex version got wrong.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { stripSqlComments, countParens, splitStatements } from '../scripts/lib/sql-strip.mjs'

/* ---------------- The regression ---------------- */

test('a banner comment with dashes does not swallow the statement after it', () => {
  const sql = [
    '/* ---- Cart items ------------------------------------------',
    ' * A line kept inside the cart.',
    ' * --------------------------------------------------------- */',
    '',
    'CREATE TABLE cart_items (id TEXT);',
  ].join('\n')

  const out = stripSqlComments(sql)

  assert.match(out, /CREATE TABLE cart_items/, 'the statement must survive')
  assert.ok(!out.includes('A line kept inside'), 'the comment text must be gone')
})

test('a banner comment without a closing dashes line still terminates', () => {
  const sql = '/* ---- Products ---- */\nCREATE TABLE products (id TEXT);'
  const out = stripSqlComments(sql)

  assert.match(out, /CREATE TABLE products/)
  assert.ok(!out.includes('Products'), 'banner text removed')
})

test('consecutive banner and prose blocks do not run past the next statement', () => {
  // Mirrors 0004: prose block, statement, prose block, statement.
  const sql = [
    '/*',
    ' * First note.',
    ' */',
    'CREATE TABLE a (id TEXT);',
    '/* ---- Second ----',
    ' * Second note.',
    ' * --------------- */',
    'CREATE TABLE b (id TEXT);',
  ].join('\n')

  const tables = [...stripSqlComments(sql).matchAll(/CREATE\s+TABLE\s+(\w+)/gi)].map((m) => m[1])
  assert.deepEqual(tables, ['a', 'b'])
})

/* ---------------- What is NOT a comment ---------------- */

test('a double minus inside a string literal is not a comment', () => {
  const sql = "INSERT INTO icons (glyph) VALUES ('a -- b');"
  const out = stripSqlComments(sql)

  assert.equal(out, sql, 'string content must be untouched')
})

test('a block comment opener inside a string is not a comment', () => {
  const sql = "SELECT '/* not a comment */' AS note;"
  const out = stripSqlComments(sql)

  assert.equal(out, sql)
})

test('semicolons inside strings do not split statements', () => {
  const sql = "INSERT INTO t VALUES ('one; two'); SELECT 1;"
  assert.equal(splitStatements(sql).length, 2)
})

test('doubled quotes are escapes, not terminators', () => {
  const sql = "SELECT 'it''s fine -- really' AS v, 1 AS n;"
  const out = stripSqlComments(sql)

  assert.match(out, /really/, 'the escaped quote must not end the string early')
  assert.match(out, /1 AS n/, 'text after the string is still code')
})

test('quoted identifiers hide comment markers', () => {
  const sql = 'CREATE TABLE "odd--name" (id TEXT);'
  assert.equal(stripSqlComments(sql), sql)

  const backtick = 'CREATE TABLE `odd/*name` (id TEXT);'
  assert.equal(stripSqlComments(backtick), backtick)
})

/* ---------------- Balance helpers ---------------- */

test('parentheses inside strings are not counted', () => {
  const sql = "CREATE TABLE t (label TEXT DEFAULT '(unclosed');"
  const parens = countParens(sql)

  assert.equal(parens.open, 1)
  assert.equal(parens.close, 1)
  assert.equal(parens.balanced, true, 'the string literal must not unbalance the count')
})

test('parens inside comments are not counted', () => {
  const sql = '-- a stray ) in prose\nCREATE TABLE t (id TEXT);'
  const parens = countParens(sql)

  assert.equal(parens.balanced, true)
})

test('genuinely unbalanced SQL is still reported', () => {
  const parens = countParens('CREATE TABLE t (id TEXT;')
  assert.equal(parens.balanced, false, 'the check must still be able to fail')
})

/* ---------------- Structure preservation ---------------- */

test('line count is preserved so syntax errors point at the right line', () => {
  const sql = ['/*', ' * one', ' * two', ' */', 'CREATE TABLE t (id TEXT);'].join('\n')
  const before = sql.split('\n').length
  const after = stripSqlComments(sql).split('\n').length

  assert.equal(after, before, 'the statement must stay on line 5')
})

test('text on both sides of a removed comment is not glued together', () => {
  const out = stripSqlComments('SELECT 1/* x */AS one;')
  assert.ok(!/1AS/.test(out), 'a token boundary must survive comment removal')
})

test('a trailing line comment does not eat the newline', () => {
  const out = stripSqlComments('SELECT 1; -- why\nSELECT 2;')
  assert.equal(out.split('\n').length, 2, 'the second statement keeps its own line')
})

/* ---------------- The real files ---------------- */

test('every migration keeps every CREATE TABLE it declares', async () => {
  const { readdirSync, readFileSync } = await import('node:fs')
  const { join } = await import('node:path')

  const files = readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()
  assert.ok(files.length > 0, 'migrations must exist')

  for (const file of files) {
    const raw = readFileSync(join('migrations', file), 'utf8')
    const declared = (raw.match(/CREATE\s+TABLE/gi) ?? []).length
    const strippedCount = (stripSqlComments(raw).match(/CREATE\s+TABLE/gi) ?? []).length

    assert.equal(
      strippedCount,
      declared,
      `${file}: ${declared} CREATE TABLE in source but ${strippedCount} survived stripping`,
    )
  }
})

test('parens balance in every migration after stripping', async () => {
  const { readdirSync, readFileSync } = await import('node:fs')
  const { join } = await import('node:path')

  for (const file of readdirSync('migrations').filter((f) => f.endsWith('.sql'))) {
    const parens = countParens(readFileSync(join('migrations', file), 'utf8'))
    assert.equal(parens.balanced, true, `${file}: ${parens.open} open vs ${parens.close} close`)
  }
})
