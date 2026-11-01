/**
 * Matching a person's name from a club file to a player (spec E01 REQ-002, same rule as the
 * E02 CSV import): case-, diacritic- and punctuation-insensitive, either name order
 * ("Jan Kowalski" or "Kowalski Jan"). A name shared by two players is ambiguous and never
 * matched — the coach assigns it by hand (R22: a decision, not a guess).
 *
 * Player names are encrypted at rest; callers decrypt the (small) roster in memory only for
 * the duration of the match.
 */

const EXTRA_FOLDS: Record<string, string> = { ł: 'l', đ: 'd', ø: 'o', ß: 'ss', æ: 'ae', œ: 'oe' }

export function normalizePersonName(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .toLocaleLowerCase('pl')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[łđøßæœ]/g, (char) => EXTRA_FOLDS[char] ?? char)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export type NameMatchPlayer = { id: string; firstName: string; lastName: string }

export type PlayerNameIndex = {
  /** The single player whose name matches, or null (unknown or ambiguous). */
  match(name: string): string | null
}

export function buildPlayerNameIndex(players: ReadonlyArray<NameMatchPlayer>): PlayerNameIndex {
  const byKey = new Map<string, Set<string>>()
  const add = (key: string, id: string) => {
    if (!key) return
    const set = byKey.get(key) ?? new Set<string>()
    set.add(id)
    byKey.set(key, set)
  }
  for (const player of players) {
    const first = normalizePersonName(player.firstName)
    const last = normalizePersonName(player.lastName)
    add(`${first} ${last}`.trim(), player.id)
    add(`${last} ${first}`.trim(), player.id)
  }
  return {
    match(name: string) {
      const ids = byKey.get(normalizePersonName(name))
      if (!ids || ids.size !== 1) return null
      return ids.values().next().value ?? null
    },
  }
}
