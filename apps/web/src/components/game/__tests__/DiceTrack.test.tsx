import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DiceTrack } from '../DiceTrack'

describe('DiceTrack', () => {
  it('labels the target control with the bet, HIGH', () => {
    render(<DiceTrack target={50} onChange={vi.fn()} direction="over" result={null} won={null} />)
    expect(screen.getByRole('slider', { name: /roll above 50 to win/i })).toBeTruthy()
  })

  it('labels the target control with the bet, LOW', () => {
    render(<DiceTrack target={30} onChange={vi.fn()} direction="under" result={null} won={null} />)
    expect(screen.getByRole('slider', { name: /roll below 30 to win/i })).toBeTruthy()
  })

  it('exposes an accessible target range control', () => {
    render(<DiceTrack target={50} onChange={vi.fn()} direction="over" result={null} won={null} />)
    const slider = screen.getByRole('slider') as HTMLInputElement
    expect(slider.value).toBe('50')
    expect(slider.min).toBe('1')
    expect(slider.max).toBe('99')
  })

  it('shows the live spinning value while rolling', () => {
    render(<DiceTrack target={50} onChange={vi.fn()} direction="over" result={null} won={null} rollingValue={42} />)
    expect(screen.getByText('42')).toBeTruthy()
  })

  it('shows the landed result number once rolling stops', () => {
    render(<DiceTrack target={50} onChange={vi.fn()} direction="over" result={73} won={true} rollingValue={null} />)
    expect(screen.getByText('73')).toBeTruthy()
  })
})
