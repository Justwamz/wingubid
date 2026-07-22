// Helpers for displaying a win honestly when it was funded by a bonus.
//
// Cash wins pay the full gross; bonus wins credit only the net (gross minus the
// free bonus stake, capped server-side), so the headline number and a short note
// must reflect what actually reached the player's cash balance.

export interface WinResult {
  fundSource?: 'cash' | 'bonus'
  winnings: number          // gross, in cents
  netCredited?: number      // amount added to cash, in cents (net for bonus)
  capped?: boolean          // bonus win clipped by the max-win cap
}

// KES-cents amount to headline: net-to-cash for a bonus win, gross for cash.
export function displayedWinCents(r: WinResult): number {
  return r.fundSource === 'bonus' ? (r.netCredited ?? 0) : r.winnings
}

// Sub-note for a bonus win (null for cash wins). The exact credited amount is
// already shown as the headline, so the cap note stays value-free to avoid
// drifting from the server's configurable cap.
export function bonusWinNote(r: WinResult): string | null {
  if (r.fundSource !== 'bonus') return null
  return r.capped ? 'bonus stake deducted · max bonus win reached' : 'bonus stake deducted'
}
