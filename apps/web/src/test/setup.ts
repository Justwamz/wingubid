import React from 'react'
import { vi } from 'vitest'

// Make React available globally so JSX in 'use client' components works
// without explicit imports in each file (mirrors Next.js behaviour)
;(globalThis as unknown as Record<string, unknown>).React = React
