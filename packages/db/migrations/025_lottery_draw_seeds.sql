-- H2: provably-fair lottery. Each draw commits a server seed hash before any
-- tickets are sold; the winning numbers are derived deterministically from the
-- seed, and the raw seed is revealed once the draw completes so players can
-- verify. Nullable so existing pending draws can be backfilled by the loop.
ALTER TABLE lottery_draws ADD COLUMN IF NOT EXISTS server_seed      TEXT;
ALTER TABLE lottery_draws ADD COLUMN IF NOT EXISTS server_seed_hash TEXT;
