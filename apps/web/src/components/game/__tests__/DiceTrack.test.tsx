import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DiceTrack } from '../DiceTrack'

describe('DiceTrack', () => {
  it('describes the bet in plain language for HIGH', () => {
    render(<DiceTrack target={50} onChange={vi.fn()} direction="over" result={null} won={null} />)
    expect(screen.getByText(/roll above 50 to win/i)).toBeTruthy()
  })

  it('describes the bet in plain language for LOW', () => {
    render(<DiceTrack target={30} onChange={vi.fn()} direction="under" result={null} won={null} />)
    expect(screen.getByText(/roll below 30 to win/i)).toBeTruthy()
  })

  it('exposes an accessible target range control', () => {
    render(<DiceTrack target={50} onChange={vi.fn()} direction="over" result={null} won={null} />)
    const slider = screen.getByRole('slider') as HTMLInputElement
    expect(slider.value).toBe('50')
    expect(slider.min).toBe('1')
    expect(slider.max).toBe('99')
  })

  it('renders the rolled number on the track when there is a result', () => {
    render(<DiceTrack target={50} onChange={vi.fn()} direction="over" result={73} won={true} />)
    expect(screen.getByText('73')).toBeTruthy()
  })
})
