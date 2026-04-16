import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { CrashChart } from '../CrashChart'

describe('CrashChart', () => {
  it('renders an SVG', () => {
    const { container } = render(<CrashChart points={[1, 1.5, 2, 2.8]} status="running" />)
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('renders polyline when points provided', () => {
    const { container } = render(<CrashChart points={[1, 1.5, 2]} status="running" />)
    expect(container.querySelector('polyline')).toBeTruthy()
  })

  it('shows no polyline when no points', () => {
    const { container } = render(<CrashChart points={[]} status="waiting" />)
    expect(container.querySelector('polyline')).toBeNull()
  })

  it('applies cyan stroke when running', () => {
    const { container } = render(<CrashChart points={[1, 2]} status="running" />)
    const polyline = container.querySelector('polyline')
    expect(polyline?.getAttribute('stroke')).toBe('#00F2FE')
  })

  it('applies coral stroke when crashed', () => {
    const { container } = render(<CrashChart points={[1, 2, 1.5]} status="crashed" />)
    const polyline = container.querySelector('polyline')
    expect(polyline?.getAttribute('stroke')).toBe('#FF4E50')
  })
})
