import React from 'react'
import { vi } from 'vitest'

// Make React available globally so 'use client' components that don't
// explicitly import React still work in the jsdom test environment
// (Next.js injects this automatically; vitest does not)
;(globalThis as unknown as Record<string, unknown>).React = React
