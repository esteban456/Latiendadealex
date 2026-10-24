ALTER TABLE users ADD COLUMN username TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique_idx
  ON users(username COLLATE NOCASE)
  WHERE username IS NOT NULL;
