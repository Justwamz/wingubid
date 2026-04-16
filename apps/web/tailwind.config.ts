import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'game-bg':       '#272422',
        'game-card':     '#1e1b18',
        'game-border':   '#3a3530',
        'accent-cyan':   '#00F2FE',
        'accent-violet': '#80508B',
        'warning-coral': '#FF4E50',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
}

export default config
