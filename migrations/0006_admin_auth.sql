-- ============================================================================
-- 0006 — ADMIN AUTH, RATE LIMITS & AUDIT
-- ----------------------------------------------------------------------------
-- Everything an operator needs, and nothing a customer can reach.
--
-- There is no signup table, no "remember me", and no password reset email.
-- The first admin is created by a one-time bootstrap guarded by a secret
-- that is removed immediately afterwards (see bootstrapAdmin).
--
-- SESSIONS STORE A HASH, NOT A TOKEN
-- The cookie carries the raw token; the database carries SHA-256 of it. A
-- stolen database therefore yields nothing that can be replayed, and the
-- lookup is still a single indexed read.
-- ============================================================================

CREATE TABLE IF NOT EXISTS admin_users (
  id              TEXT    PRIMARY KEY,
  -- Lower-cased on write; login compares case-insensitively.
  email           TEXT    NOT NULL UNIQUE,

  -- Format: pbkdf2$<iterations>$<salt-b64>$<hash-b64>
  password_hash   TEXT    NOT NULL,

  role            TEXT    NOT NULL DEFAULT 'staff',
  is_active       INTEGER NOT NULL DEFAULT 1,

  -- Brute-force state, reset on a successful login.
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    INTEGER,
  last_login_at   INTEGER,

  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,

  CHECK (role IN ('admin', 'staff')),
  CHECK (is_active IN (0, 1)),
  CHECK (failed_attempts >= 0)
);

/* ---- Sessions ------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS admin_sessions (
  id          TEXT    PRIMARY KEY,
  user_id     TEXT    NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,

  /*
   * SHA-256 hex of the session token held in the HttpOnly cookie. UNIQUE
   * because token lookup is the authentication check itself: a duplicate
   * would mean two sessions share one credential.
   */
  token_hash  TEXT    NOT NULL UNIQUE,

  /*
   * Double-submit CSRF token. Sent to the browser as a readable cookie and
   * required back in the X-CSRF-Token header on any state-changing request.
   * Stored server-side so a forged header can be compared against the
   * session that actually exists rather than whatever the client claims.
   */
  csrf_token  TEXT    NOT NULL,

  -- Kept for a "your active sessions" view and for incident review.
  user_agent  TEXT    NOT NULL DEFAULT '',
  ip_hash     TEXT    NOT NULL DEFAULT '',

  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,

  CHECK (expires_at > 0)
);

/* The cron sweeper drops expired sessions. */
CREATE INDEX IF NOT EXISTS idx_sessions_expiry
  ON admin_sessions (expires_at);

CREATE INDEX IF NOT EXISTS idx_sessions_user
  ON admin_sessions (user_id);

/* ---- Rate limits ---------------------------------------------------------
 * Fixed-window counters in D1. In-memory counters would reset on every
 * Worker cold start and be trivially bypassed, which defeats the purpose of
 * throttling login attempts.
 *
 * The key is a namespaced string built by the caller — `login:ip:1.2.3.4`,
 * `read:<ip>`, `wh:<ip>` — so one table serves every limit without a schema
 * change per endpoint.
 * ------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT    PRIMARY KEY,
  count        INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,

  CHECK (count >= 0)
);

/* Cron cleanup. */
CREATE INDEX IF NOT EXISTS idx_rate_limits_expiry
  ON rate_limits (expires_at);

/* ---- Audit log -----------------------------------------------------------
 * Append-only. Written on every admin mutation and on authentication events,
 * including failures. `actor_type` distinguishes a person from the system so
 * a cron-driven change is not attributed to whoever logged in last.
 *
 * `detail` is a JSON object. Nothing here is queried by its contents, so it
 * is stored as text rather than exploded into columns.
 * ------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS audit_logs (
  id          TEXT    PRIMARY KEY,
  actor_type  TEXT    NOT NULL DEFAULT 'admin',
  actor_id    TEXT,
  action      TEXT    NOT NULL,
  entity_type TEXT    NOT NULL DEFAULT '',
  entity_id   TEXT    NOT NULL DEFAULT '',
  detail      TEXT    NOT NULL DEFAULT '{}',
  ip_hash     TEXT    NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,

  CHECK (actor_type IN ('admin', 'system', 'customer'))
);

CREATE INDEX IF NOT EXISTS idx_audit_created
  ON audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_entity
  ON audit_logs (entity_type, entity_id, created_at DESC);
