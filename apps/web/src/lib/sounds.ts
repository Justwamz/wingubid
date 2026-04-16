let ctx: AudioContext | null = null

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  return ctx
}

function playTone(freq: number, duration: number, type: OscillatorType = 'sine', gain = 0.3) {
  if (typeof window === 'undefined') return
  try {
    const c = getCtx()
    const osc = c.createOscillator()
    const g = c.createGain()
    osc.connect(g)
    g.connect(c.destination)
    osc.type = type
    osc.frequency.setValueAtTime(freq, c.currentTime)
    g.gain.setValueAtTime(gain, c.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration)
    osc.start(c.currentTime)
    osc.stop(c.currentTime + duration)
  } catch {}
}

export const sounds = {
  win:     () => { playTone(880, 0.15); setTimeout(() => playTone(1100, 0.2), 80) },
  lose:    () => playTone(150, 0.4, 'sawtooth', 0.4),
  tick:    () => playTone(440, 0.05, 'sine', 0.1),
  roll:    () => playTone(600, 0.1, 'triangle'),
  mineHit: () => playTone(80, 0.6, 'sawtooth', 0.5),
  cashout: () => { playTone(660, 0.1); setTimeout(() => playTone(880, 0.1), 60); setTimeout(() => playTone(1100, 0.2), 120) },
}
