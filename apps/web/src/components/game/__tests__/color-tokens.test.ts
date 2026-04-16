import { describe, it, expect } from 'vitest'
import resolveConfig from 'tailwindcss/resolveConfig'
import tailwindConfig from '../../../../tailwind.config'

const config = resolveConfig(tailwindConfig as Parameters<typeof resolveConfig>[0])

describe('color tokens', () => {
  it('game-bg is dark violet', () => {
    expect((config.theme.colors as Record<string, string>)['game-bg']).toBe('#1a1025')
  })
  it('game-card is charcoal', () => {
    expect((config.theme.colors as Record<string, string>)['game-card']).toBe('#272422')
  })
})
