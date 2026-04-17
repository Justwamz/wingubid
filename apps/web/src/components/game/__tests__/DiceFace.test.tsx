import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { DiceFace } from '../DiceFace'

describe('DiceFace', () => {
  it('renders SVG', () => {
    const { container } = render(<DiceFace value={3} />)
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('renders correct pip count for value 1', () => {
    const { container } = render(<DiceFace value={1} />)
    expect(container.querySelectorAll('circle').length).toBe(1)
  })

  it('renders correct pip count for value 6', () => {
    const { container } = render(<DiceFace value={6} />)
    expect(container.querySelectorAll('circle').length).toBe(6)
  })

  it('applies won color when won prop is true', () => {
    const { container } = render(<DiceFace value={4} won />)
    const rect = container.querySelector('rect')
    expect(rect?.getAttribute('fill')).toBe('#1a1025')
    const circles = container.querySelectorAll('circle')
    expect(circles[0]?.getAttribute('fill')).toBe('#00F2FE')
  })

  it('applies default color when not won', () => {
    const { container } = render(<DiceFace value={4} />)
    const circles = container.querySelectorAll('circle')
    expect(circles[0]?.getAttribute('fill')).toBe('#80508B')
  })
})
