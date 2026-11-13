-- ============================================================================
-- Accounting Database — Application Users (migration 005)
-- Node.js backend authentication (bcrypt password hashes)
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
