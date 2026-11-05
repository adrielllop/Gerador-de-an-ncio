CREATE TABLE IF NOT EXISTS pixgen_wallets (
  wallet_id TEXT PRIMARY KEY,
  credits INTEGER NOT NULL DEFAULT 3 CHECK (credits >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pixgen_purchases (
  purchase_id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL REFERENCES pixgen_wallets(wallet_id),
  preference_id TEXT NOT NULL UNIQUE,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  external_reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  provider_payment_id TEXT UNIQUE,
  credited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pixgen_purchases_payment_idx ON pixgen_purchases(provider_payment_id);
CREATE INDEX IF NOT EXISTS pixgen_purchases_wallet_idx ON pixgen_purchases(wallet_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pixgen_generations (
  generation_id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL REFERENCES pixgen_wallets(wallet_id),
  prompt TEXT NOT NULL,
  size TEXT NOT NULL,
  quality TEXT NOT NULL,
  image_data TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pixgen_generations_wallet_idx ON pixgen_generations(wallet_id, created_at DESC);
