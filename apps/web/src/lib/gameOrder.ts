// Maps a game route href to its ranking key (as returned by /games/config order).
export const GAME_KEY_BY_HREF: Record<string, string> = {
  '/games/wingu-crash': 'crash',
  '/games/wingu-mines': 'mines',
  '/games/wingu-dice': 'dice',
  '/games/wingu-lotto': 'lottery',
  '/games/wingu-scratch': 'scratch',
}

// Stable reorder: entries whose key appears in `order` come first (by rank);
// everything else (unranked games, provider "coming soon" tiles) keeps its
// original relative order.
export function applyGameOrder<T extends { href: string }>(list: T[], order: string[]): T[] {
  const rank = new Map(order.map((k, i) => [k, i]))
  const rankOf = (href: string) => rank.get(GAME_KEY_BY_HREF[href] ?? '') ?? Infinity
  return list
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const ra = rankOf(a.item.href), rb = rankOf(b.item.href)
      return ra !== rb ? ra - rb : a.i - b.i
    })
    .map(x => x.item)
}
