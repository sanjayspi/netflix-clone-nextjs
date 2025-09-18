CREATE TABLE clips (
  clip_id TEXT PRIMARY KEY,
  title TEXT,
  type TEXT CHECK(type IN ('FREE','PAID')),
  price_cents INTEGER,
  currency TEXT,
  poster_url TEXT,
  stream_id TEXT
);

CREATE TABLE transactions (
  txid TEXT PRIMARY KEY,
  clip_id TEXT,
  order_id TEXT,
  amount_cents INTEGER,
  currency TEXT,
  status TEXT CHECK(status IN ('CREATED','PAID','PENDING_WEBHOOK','FAILED','REFUNDED')),
  processor_ref TEXT,
  callback_url TEXT,
  redirect_url TEXT,
  metadata TEXT,
  created_at TEXT,
  paid_at TEXT,
  webhook_attempts INTEGER DEFAULT 0,
  webhook_last_status TEXT
);
