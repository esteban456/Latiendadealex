CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  picture TEXT NOT NULL DEFAULT '',
  password_salt TEXT,
  password_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_identities (
  provider TEXT NOT NULL,
  provider_sub TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (provider, provider_sub)
);

CREATE INDEX IF NOT EXISTS user_identities_user_idx ON user_identities(user_id);
