import { pool } from '@betting/db'

export type GameKey = 'crash' | 'mines' | 'dice'

const EDGE_KEY: Record<GameKey, string> = {
  crash: 'crash_house_edge',
  mines: 'mines_house_edge',
  dice: 'dice_house_edge',
}

const DEFAULT_EDGE = 5

// Read the configured house edge (%) for each game, falling back to the default
// when a key is missing.
export async function getHouseEdges(): Promise<Record<GameKey, number>> {
  const { rows } = await pool.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM game_settings
     WHERE key IN ('crash_house_edge', 'mines_house_edge', 'dice_house_edge')`,
  )
  const byKey = new Map(rows.map(r => [r.key, Number(r.value)]))
  return {
    crash: byKey.get(EDGE_KEY.crash) ?? DEFAULT_EDGE,
    mines: byKey.get(EDGE_KEY.mines) ?? DEFAULT_EDGE,
    dice: byKey.get(EDGE_KEY.dice) ?? DEFAULT_EDGE,
  }
}

// Upsert the house edge (%) for a single game.
export async function setHouseEdge(game: GameKey, edge: number): Promise<void> {
  await pool.query(
    `INSERT INTO game_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [EDGE_KEY[game], JSON.stringify(edge)],
  )
}
