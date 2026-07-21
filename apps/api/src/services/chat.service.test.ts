import { describe, it, expect, vi } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn() } }))

import { validateUsernameFormat, hasProfanity } from './chat.service.js'

describe('validateUsernameFormat', () => {
  it('accepts a valid handle', () => {
    expect(validateUsernameFormat('Swift_Falcon12')).toBeNull()
  })
  it('rejects too short / too long', () => {
    expect(validateUsernameFormat('ab')).toMatch(/3-20/)
    expect(validateUsernameFormat('a'.repeat(21))).toMatch(/3-20/)
  })
  it('rejects disallowed characters', () => {
    expect(validateUsernameFormat('bad name')).toMatch(/letters/i)
    expect(validateUsernameFormat('hi!')).toMatch(/letters/i)
  })
})

describe('hasProfanity', () => {
  const words = ['fuck', 'shit']
  it('catches a banned token', () => {
    expect(hasProfanity('this is shit', words)).toBe(true)
    expect(hasProfanity('FUCK that', words)).toBe(true)
  })
  it('is token-based, not substring (no false positive)', () => {
    expect(hasProfanity('assassin classic', ['ass'])).toBe(false)
  })
  it('passes clean text', () => {
    expect(hasProfanity('lets go crash to the moon', words)).toBe(false)
  })
})
