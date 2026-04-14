CREATE TABLE IF NOT EXISTS pay2mine_rounds (
    d           INTEGER PRIMARY KEY,
    status      TEXT NOT NULL DEFAULT 'mining',
    winner      TEXT,
    nonce       NUMERIC(78, 0),
    txhash      TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pay2mine_rounds_status_idx ON pay2mine_rounds (status);
