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

  // Single-source house edge. With n uniform in [0, 2^52), this formula gives
  //   P(crash >= x) = (1 - houseEdge/100) / x
  // so the realized RTP is exactly (1 - houseEdge/100) and the edge equals the
  // configured houseEdge. The clamp to 1.00 is what produces the instant-bust
  // rounds, at the correct frequency (~houseEdge% of rounds).
  //
  // Do NOT re-add a separate instant-crash branch (e.g. `if (hash[0]==='0')`):
  // that stacks a second edge on top and makes the true edge far exceed the
  // configured value.
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
  // Rejection sampling to remove modulo bias: a bare `x % 100` on a 32-bit value
  // favors 0..95 (2^32 % 100 = 96). Reject words at or above the largest
  // multiple of 100 that fits in 32 bits, drawing more HMAC output if needed.
  // Rejection is astronomically rare (~2e-8), so this returns on the first word
  // in practice while staying deterministic and verifiable.
  const max = Math.floor(0xffffffff / 100) * 100
  let counter = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const digest = createHmac('sha256', serverSeed)
      .update(`${clientSeed}-${nonce}-${counter}`)
      .digest()
    for (let off = 0; off + 4 <= digest.length; off += 4) {
      const val = digest.readUInt32BE(off)
      if (val < max) return val % 100
    }
    counter++
  }
}
