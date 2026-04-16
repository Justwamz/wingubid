import { createHmac } from 'crypto'

export function generateCrashPoint(
  serverSeed: string,
  clientSeed: string,
  roundNumber: number,
  houseEdge: number,
): number {
  const hash = createHmac('sha256', serverSeed)
    .update(`${clientSeed}-${roundNumber}`)
    .digest('hex')

  if (hash[0] === '0') return 1.00

  const n = parseInt(hash.slice(0, 13), 16)
  const e = 100 - houseEdge
  return Math.max(1.00, Math.floor((e * 2 ** 52) / (2 ** 52 - n)) / 100)
}

export function generateMinePositions(
  serverSeed: string,
  clientSeed: string,
  gameId: string,
  totalTiles: number,
  mineCount: number,
): number[] {
  const tiles = Array.from({ length: totalTiles }, (_, i) => i)

  for (let i = totalTiles - 1; i > 0; i--) {
    const hash = createHmac('sha256', serverSeed)
      .update(`${clientSeed}-${gameId}-${i}`)
      .digest('hex')
    const j = parseInt(hash.slice(0, 8), 16) % (i + 1)
    ;[tiles[i], tiles[j]] = [tiles[j], tiles[i]]
  }

  return tiles.slice(0, mineCount).sort((a, b) => a - b)
}

export function rollDiceResult(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): number {
  const hash = createHmac('sha256', serverSeed)
    .update(`${clientSeed}-${nonce}`)
    .digest('hex')
  return parseInt(hash.slice(0, 8), 16) % 100
}
