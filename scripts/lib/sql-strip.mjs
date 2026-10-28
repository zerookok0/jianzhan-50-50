/**
 * SQL COMMENT STRIPPING
 * ------------------------------------------------------------------
 * Removes SQL comments without touching anything that merely looks like
 * one. It is a character scanner, not a pile of regular expressions —
 * and that distinction is the entire point of this file.
 *
 * THE BUG THIS REPLACES
 * The migration checker used to strip comments in two regex passes:
 *
 *   sql.split('\n').map(l => l.replace(/--.*$/, '')).join('\n')
 *      .replace(/\/\*[\s\S]*?\*\//g, '')
 *
 * Line comments first, then block comments. That order is what broke it,
 * because these migration files use banner comments:
 *
 *   /* ---- Order items -------------------------------------
 *    * An immutable snapshot taken at purchase time.
 *    * --------------------------------------------------- *\/
 *
 * Pass one sees the `--` inside the dashes and deletes the rest of that
 * line — including the ` *\/` that closed the comment. The block never
 * terminates, so pass two runs to the NEXT `*\/` somewhere further down
 * and swallows every statement in between. In 0004 that meant four
 * `CREATE TABLE` statements became one, and the checker then reported
 * that the tables "do not exist" — while the SQL was correct all along.
 * Worse, it left stray `)` in the text with no matching `(`, so the
 * parenthesis balance check failed too. One wrong assumption, two
 * alarming and completely false failures.
 *
 * WHY A SCANNER
 * SQL has three separate quoting mechanisms and two comment forms, and
 * they interact: `'--'` is a string, `"--"` is an identifier, `--` is a
 * comment. No regex can tell them apart without also tracking which one
 * it is inside, so the scanner tracks exactly that. It costs a few
 * lines and cannot be fooled by prose.
 *
 * OUTPUT CONTRACT
 * Removed comment text is replaced by whitespace rather than deleted, and
 * newlines inside comments are preserved. Callers therefore keep correct
 * line numbers (error messages point at the right place) and cannot have
 * two tokens accidentally glued together by a deletion.
 */

/**
 * Quote and comment states the scanner can be in.
 *
 *   code      normal SQL
 *   line      after `--`, until end of line
 *   block     inside `/* ... *\/`
 *   single    inside '...'  — a string literal
 *   double    inside "..."  — a quoted identifier
 *   backtick  inside `...`  — MySQL-style identifier
 *   bracket   inside [...]  — T-SQL style identifier
 */
const CODE = 'code'
const LINE = 'line'
const BLOCK = 'block'
const SINGLE = 'single'
const DOUBLE = 'double'
const BACKTICK = 'backtick'
const BRACKET = 'bracket'

/**
 * Strip comments from a SQL string.
 *
 * @param {string} sql
 * @param {{ blankLiterals?: boolean }} [options]
 *   `blankLiterals` also replaces the *contents* of string literals and
 *   quoted identifiers with spaces (keeping the delimiter characters and
 *   any newlines). Comment stripping alone is not enough for structural
 *   checks: `DEFAULT '(unclosed'` contains a parenthesis that is data, not
 *   grammar, and counting it reports SQL as unbalanced when it is not.
 * @returns {string} the SQL with comments blanked out
 */
export function stripSqlComments(sql, options = {}) {
  const blankLiterals = options.blankLiterals === true

  const out = []
  const n = sql.length
  let i = 0
  let state = CODE
  let blockDepth = 0

  /**
   * Emit a character from inside a literal. With `blankLiterals` the
   * character becomes a space — except a newline, which is kept so line
   * numbers stay correct.
   */
  const put = (s) => {
    if (!blankLiterals) {
      out.push(s)
      return
    }
    out.push(s.replace(/[^\n]/g, ' '))
  }

  while (i < n) {
    const ch = sql[i]
    const next = sql[i + 1]

    switch (state) {
      case CODE: {
        // `--` starts a line comment.
        if (ch === '-' && next === '-') {
          state = LINE
          i += 2
          continue
        }
        // `/*` starts a block comment. SQLite does not nest them, but
        // several dialects do, so depth is tracked rather than assumed.
        //
        // A single space is emitted in its place. Deleting the comment
        // outright would glue its neighbours together: `1/* x */AS` would
        // become `1AS`, which is a different token, not the same SQL.
        if (ch === '/' && next === '*') {
          state = BLOCK
          blockDepth = 1
          out.push(' ')
          i += 2
          continue
        }
        if (ch === "'") {
          state = SINGLE
          put(ch)
          i += 1
          continue
        }
        if (ch === '"') {
          state = DOUBLE
          put(ch)
          i += 1
          continue
        }
        if (ch === '`') {
          state = BACKTICK
          put(ch)
          i += 1
          continue
        }
        if (ch === '[') {
          state = BRACKET
          put(ch)
          i += 1
          continue
        }
        out.push(ch)
        i += 1
        continue
      }

      case LINE: {
        // A newline ends the comment; emit it so line numbers survive.
        if (ch === '\n') {
          state = CODE
          out.push(ch)
        }
        i += 1
        continue
      }

      case BLOCK: {
        if (ch === '*' && next === '/') {
          blockDepth -= 1
          i += 2
          if (blockDepth === 0) state = CODE
          continue
        }
        if (ch === '/' && next === '*') {
          blockDepth += 1
          i += 2
          continue
        }
        // Keep the line structure: one newline in, one newline out.
        if (ch === '\n') out.push('\n')
        i += 1
        continue
      }

      case SINGLE: {
        if (ch === "'") {
          // A doubled quote is an escaped quote, not a terminator.
          if (next === "'") {
            out.push("''")
            i += 2
            continue
          }
          state = CODE
        }
        put(ch)
        i += 1
        continue
      }

      case DOUBLE: {
        if (ch === '"') {
          if (next === '"') {
            out.push('""')
            i += 2
            continue
          }
          state = CODE
        }
        put(ch)
        i += 1
        continue
      }

      case BACKTICK: {
        if (ch === '`') {
          if (next === '`') {
            out.push('``')
            i += 2
            continue
          }
          state = CODE
        }
        put(ch)
        i += 1
        continue
      }

      case BRACKET: {
        if (ch === ']') state = CODE
        put(ch)
        i += 1
        continue
      }

      default:
        // Unreachable, but a silent truncation here would be invisible.
        throw new Error(`sql-strip: unknown scanner state "${state}"`)
    }
  }

  return out.join('')
}

/**
 * Split SQL into statements on top-level semicolons.
 *
 * Uses the same scanner, so a `;` inside a string or a comment does not
 * split anything — which is exactly what happens in prose like
 * "-- see the docs; they explain why".
 *
 * @param {string} sql
 * @returns {string[]} non-empty statements, trimmed
 */
export function splitStatements(sql) {
  const code = stripSqlComments(sql)
  const statements = []
  let current = ''
  let state = CODE

  for (let i = 0; i < code.length; i += 1) {
    const ch = code[i]
    const next = code[i + 1]

    if (state === CODE) {
      if (ch === ';') {
        statements.push(current)
        current = ''
        continue
      }
      if (ch === "'") state = SINGLE
      else if (ch === '"') state = DOUBLE
      else if (ch === '`') state = BACKTICK
      else if (ch === '[') state = BRACKET
    } else if (state === SINGLE) {
      if (ch === "'") {
        if (next === "'") {
          current += "''"
          i += 1
          continue
        }
        state = CODE
      }
    } else if (state === DOUBLE) {
      if (ch === '"') {
        if (next === '"') {
          current += '""'
          i += 1
          continue
        }
        state = CODE
      }
    } else if (state === BACKTICK) {
      if (ch === '`') state = CODE
    } else if (state === BRACKET) {
      if (ch === ']') state = CODE
    }

    current += ch
  }

  if (current.trim()) statements.push(current)

  return statements.map((s) => s.trim()).filter((s) => s.length > 0)
}

/**
 * Count `(` and `)` outside strings and comments.
 *
 * Counting on the raw text is wrong for the same reason the old stripper
 * was wrong: a parenthesis inside a string literal is not a parenthesis
 * in the grammar. `DEFAULT '(unclosed'` would otherwise look like an
 * unbalanced statement.
 *
 * `blankLiterals` is what makes that claim true. Without it the scan skips
 * comment text but still walks over string contents, so a literal
 * parenthesis would be counted as grammar.
 *
 * @param {string} sql
 * @returns {{ open: number, close: number, balanced: boolean }}
 */
export function countParens(sql) {
  const code = stripSqlComments(sql, { blankLiterals: true })
  let open = 0
  let close = 0

  for (const ch of code) {
    if (ch === '(') open += 1
    else if (ch === ')') close += 1
  }

  return { open, close, balanced: open === close }
}
