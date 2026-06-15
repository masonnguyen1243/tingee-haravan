export const SQL_CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS merchants (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_domain   TEXT    NOT NULL UNIQUE,
  api_token_enc TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tingee_configs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_id   INTEGER NOT NULL REFERENCES merchants(id),
  client_id_enc TEXT    NOT NULL,
  secret_enc    TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tingee_accounts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_id    INTEGER NOT NULL REFERENCES merchants(id),
  account_number TEXT    NOT NULL,
  bank_bin       TEXT    NOT NULL,
  bank_name      TEXT,
  is_default     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_id    INTEGER NOT NULL REFERENCES merchants(id),
  order_id       TEXT    NOT NULL,
  reconcile_code TEXT    NOT NULL UNIQUE,
  amount         REAL    NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'pending',
  qr_code_image  TEXT,
  paid_at        TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  tingee_transaction_code TEXT,
  raw_payload             TEXT    NOT NULL,
  matched_payment_id      INTEGER REFERENCES payments(id),
  signature_valid         INTEGER NOT NULL DEFAULT 0,
  created_at              TEXT    NOT NULL DEFAULT (datetime('now'))
);
`;
