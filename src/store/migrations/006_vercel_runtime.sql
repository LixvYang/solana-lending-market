CREATE TABLE vercel_sync_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  last_sync_at TIMESTAMPTZ,
  last_snapshot_at TIMESTAMPTZ,
  lease_until TIMESTAMPTZ
);
INSERT INTO vercel_sync_state(singleton) VALUES (TRUE) ON CONFLICT DO NOTHING;

CREATE TABLE faucet_reservations (
  id BIGSERIAL PRIMARY KEY,
  wallet TEXT NOT NULL,
  ip TEXT NOT NULL,
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX faucet_reservations_time_idx ON faucet_reservations(reserved_at DESC);
CREATE INDEX faucet_reservations_wallet_time_idx ON faucet_reservations(wallet, reserved_at DESC);
CREATE INDEX faucet_reservations_ip_time_idx ON faucet_reservations(ip, reserved_at DESC);
