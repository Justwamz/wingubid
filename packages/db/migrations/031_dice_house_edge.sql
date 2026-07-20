-- Raise the dice house edge from 1% to 5% to match crash and mines, lifting the
-- house margin uniformly across all dice targets. The multiplier is computed
-- server-side as (100 - house_edge) / win_count, so this applies to every bet.
UPDATE game_settings
SET value = '5'::jsonb, updated_at = NOW()
WHERE key = 'dice_house_edge';
