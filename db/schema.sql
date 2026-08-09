-- GSBS Member Portal database schema

CREATE TABLE IF NOT EXISTS members (
  id            TEXT PRIMARY KEY,           -- e.g. GSBS-000100
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  phone         TEXT,
  type          TEXT NOT NULL,               -- Full / Student / Associate / International / Honorary
  institution   TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending / active / lapsed
  passcode_hash TEXT NOT NULL,
  joined        DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credentials (
  id          SERIAL PRIMARY KEY,
  member_id   TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,                 -- e.g. CCBS
  label       TEXT NOT NULL,                 -- e.g. Certified Clinical Biomedical Scientist (CCBS)
  cert_no     TEXT NOT NULL UNIQUE,           -- e.g. GSBS-CERT-0001
  issued      DATE NOT NULL,
  expires     DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS applications (
  id               TEXT PRIMARY KEY,          -- e.g. APP-000001
  member_id        TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  applicant_name   TEXT NOT NULL,
  email            TEXT NOT NULL,
  type             TEXT NOT NULL,             -- new / renewal
  membership_type  TEXT,
  submitted        DATE NOT NULL DEFAULT CURRENT_DATE,
  status           TEXT NOT NULL DEFAULT 'pending', -- pending / approved / rejected
  institution       TEXT,
  year             TEXT,
  docs             TEXT,
  files            JSONB DEFAULT '[]'::jsonb,
  decided_at       TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS member_updates (
  id          SERIAL PRIMARY KEY,
  member_id   TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  date        DATE NOT NULL DEFAULT CURRENT_DATE,
  text        TEXT NOT NULL
);

-- Single-row table holding the admin passcode hash. No row = no passcode set yet
-- (site will require first-time setup, same behavior as the prototype).
CREATE TABLE IF NOT EXISTS admin_settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

-- Atomic, race-free ID generation (safer than the loop-and-check approach the
-- static prototype had to use, since it has no real database underneath it).
CREATE SEQUENCE IF NOT EXISTS member_id_seq START 100;
CREATE SEQUENCE IF NOT EXISTS application_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS cert_no_seq START 1;

-- Password reset tokens. We store a HASH of the token, never the token itself,
-- same principle as passcodes: even a database leak shouldn't hand out usable
-- reset links. Tokens are single-use and short-lived (checked in application code).
CREATE TABLE IF NOT EXISTS password_resets (
  id           SERIAL PRIMARY KEY,
  member_id    TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  used         BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_resets_member ON password_resets (member_id);

CREATE INDEX IF NOT EXISTS idx_members_name ON members (lower(name));
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications (status);
CREATE INDEX IF NOT EXISTS idx_credentials_member ON credentials (member_id);
