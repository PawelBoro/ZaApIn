CREATE TABLE admins (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(100) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Opaque admin tokens are stored as SHA-256 hex, so logout can revoke them.
CREATE TABLE sessions (
  id         SERIAL PRIMARY KEY,
  admin_id   INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE TABLE series (
  id        SERIAL PRIMARY KEY,
  name      VARCHAR(100) NOT NULL,
  min_value DOUBLE PRECISION NOT NULL,
  max_value DOUBLE PRECISION NOT NULL,
  color     CHAR(7) NOT NULL,
  icon      TEXT,
  unit      VARCHAR(20),
  CONSTRAINT series_min_lt_max CHECK (min_value < max_value),
  CONSTRAINT series_color_hex  CHECK (color ~ '^#[0-9A-Fa-f]{6}$')
);

-- Unregistering a sensor is a soft delete (deleted_at), so its results remain.
CREATE TABLE sensors (
  id                  SERIAL PRIMARY KEY,
  name                VARCHAR(100) NOT NULL,
  series_id           INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  api_key_hash        CHAR(64) NOT NULL UNIQUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_measurement_at TIMESTAMPTZ,
  deleted_at          TIMESTAMPTZ
);

CREATE TABLE measurements (
  id         BIGSERIAL PRIMARY KEY,
  series_id  INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  sensor_id  INTEGER REFERENCES sensors(id) ON DELETE SET NULL,
  value      DOUBLE PRECISION NOT NULL,
  ts         TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX measurements_series_ts_idx ON measurements (series_id, ts);
CREATE INDEX measurements_ts_idx ON measurements (ts);
