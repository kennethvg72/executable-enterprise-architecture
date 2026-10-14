-- Server-side sessions (IAM-02). Only a hash of the session ID is stored.
CREATE TABLE sessions (
  id_hash    text PRIMARY KEY,
  user_id    text NOT NULL,
  user_name  text NOT NULL,
  roles      text[] NOT NULL,
  csrf       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_expires_at ON sessions (expires_at);
