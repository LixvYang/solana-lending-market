-- 兑换与水龙头不经过 marginfi，保留已确认交易的可展示信息。
CREATE TABLE desk_events (
  signature TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('swap', 'faucet')),
  from_symbol TEXT,
  from_amount TEXT,
  from_decimals INT,
  to_symbol TEXT,
  to_amount TEXT,
  to_decimals INT,
  details JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL
);
CREATE INDEX desk_events_wallet_time_idx ON desk_events(wallet, created_at DESC, signature);
