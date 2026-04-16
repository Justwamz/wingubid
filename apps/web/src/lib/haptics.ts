function vibe(pattern: number | number[]) {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(pattern)
  }
}

export const haptics = {
  win:  () => vibe(200),
  lose: () => vibe([50, 50, 50]),
  roll: () => vibe(30),
  tick: () => vibe(10),
}
