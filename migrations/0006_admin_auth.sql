/* ==========================================================================
 * 0006 — Admin authentication, audit log, rate limits
 *
 * There is no default admin and no public signup. The first account is
 * created once by calling /admin/bootstrap with a one-time token that is
 * then deleted from the Worker's secrets. Bootstrap refuses if an admin
 * already exists.
 *
 * Session tokens are stored as SHA-256 hashes, never raw: a stolen
 * database export contains nothing that can be replayed as a session.
 * ========================================================================== */

CREATE TABLE IF NOT EXISTS admin_users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'admin',
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_login_at INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  csrf_hash   TEXT NOT NULL,
  user_agent  TEXT NOT NULL DEFAULT '',
  ip          TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  revoked_at  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON admin_sessions(user_id, expires_at);

/* ---- Audit log ----------------------------------------------------------
 * Every admin write records who did it and what changed. Not a security
 * feature by itself, but the difference between "stock is wrong" and
 * "someone edited stock on Tuesday" when something goes missing.
 * ---------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS audit_logs (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT,
  actor_email TEXT NOT NULL DEFAULT '',
  action      TEXT NOT NULL,
  entity      TEXT NOT NULL DEFAULT '',
  entity_id   TEXT NOT NULL DEFAULT '',
  detail_json TEXT NOT NULL DEFAULT '{}',
  ip          TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id);

/* ---- Rate limits --------------------------------------------------------
 * Fixed-window counters kept in D1 so they survive Worker restarts. An
 * in-memory counter resets on every cold start and is trivially bypassed.
 * ---------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,
  count        INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_expiry ON rate_limits(expires_at);
