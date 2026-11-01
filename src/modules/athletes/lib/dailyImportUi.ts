/**
 * Pure helpers behind the daily-data screens ("Wgraj plik RPE", "Dane dzienne"). No React and no
 * I/O, so they are unit-tested on their own; components turn the returned i18n keys into copy.
 */

/** Daily-data kinds the import page accepts. Phase 2 adds `wellbeing`. */
export const DAILY_IMPORT_KINDS = ['rpe'] as const
export type DailyImportKind = (typeof DAILY_IMPORT_KINDS)[number]

export function parseDailyImportKind(value: string | null | undefined): DailyImportKind | null {
  const kind = (value ?? '').trim() || 'rpe'
  return (DAILY_IMPORT_KINDS as readonly string[]).includes(kind) ? (kind as DailyImportKind) : null
}

/** The value of the "Pomiń" option of a name select (Radix forbids empty item values). */
export const SKIP_ASSIGNMENT = '__skip__'

export type AssignablePlayer = { id: string; firstName: string; lastName: string; matchedByName: boolean }

/** `{ "<name as in the file>": playerId | null }` — null means "pomiń" (rows rejected). */
export type NameAssignments = Record<string, string | null>

/**
 * Players offered for one unknown name (REQ-002): team players not matched by name in this
 * import and not already chosen for another unknown name — each player at most once. The player
 * currently chosen for `name` stays in its own list.
 */
export function availablePlayersFor<T extends AssignablePlayer>(name: string, players: readonly T[], assignments: NameAssignments): T[] {
  const takenElsewhere = new Set(
    Object.entries(assignments)
      .filter(([other, playerId]) => other !== name && typeof playerId === 'string' && playerId)
      .map(([, playerId]) => playerId as string),
  )
  return players.filter((player) => !player.matchedByName && !takenElsewhere.has(player.id))
}

/** The `assignments` form field: only names with a chosen player; empty → `''` (field omitted). */
export function serializeAssignments(assignments: NameAssignments): string {
  const chosen = Object.entries(assignments).filter(([, playerId]) => typeof playerId === 'string' && playerId)
  if (chosen.length === 0) return ''
  return JSON.stringify(Object.fromEntries(chosen))
}

/** Unknown names left without a player: their rows will be rejected on "Zapisz". */
export function unassignedNames<T extends { name: string; rowCount: number }>(unknownNames: readonly T[], assignments: NameAssignments): {
  names: T[]
  rowCount: number
} {
  const names = unknownNames.filter((entry) => !assignments[entry.name])
  return { names, rowCount: names.reduce((sum, entry) => sum + entry.rowCount, 0) }
}

/** Drops choices for names that are no longer unknown or players no longer assignable. */
export function pruneAssignments(assignments: NameAssignments, unknownNames: readonly { name: string }[], players: readonly AssignablePlayer[]): NameAssignments {
  const names = new Set(unknownNames.map((entry) => entry.name))
  const assignable = new Set(players.filter((player) => !player.matchedByName).map((player) => player.id))
  const out: NameAssignments = {}
  const used = new Set<string>()
  for (const [name, playerId] of Object.entries(assignments)) {
    if (!names.has(name)) continue
    if (playerId && assignable.has(playerId) && !used.has(playerId)) {
      out[name] = playerId
      used.add(playerId)
    } else {
      out[name] = null
    }
  }
  return out
}

/** RPE display: a number, or the "Brak RPE" key — never 0 for a gap (R12). */
export function describeRpe(rpe: number | null | undefined): { text: string | null; missingKey: string | null } {
  if (rpe === null || rpe === undefined) return { text: null, missingKey: 'athletes.daily.rpeMissing' }
  return { text: String(rpe), missingKey: null }
}

/** Load (AU) display: the number, or an em dash when RPE or minutes is missing. */
export function formatLoad(load: number | null | undefined): string {
  return load === null || load === undefined ? '—' : String(load)
}

export function formatMinutes(minutes: number | null | undefined): string {
  return minutes === null || minutes === undefined ? '—' : String(minutes)
}

export const PREVIEW_ROW_STATUS_KEYS = {
  new: 'athletes.dailyImport.preview.status.new',
  corrected: 'athletes.dailyImport.preview.status.corrected',
  unchanged: 'athletes.dailyImport.preview.status.unchanged',
} as const

export const PREVIEW_ROW_STATUS_VARIANTS = {
  new: 'success',
  corrected: 'warning',
  unchanged: 'neutral',
} as const

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** "Dane dzienne" default period: the last 7 days including today (local calendar). */
export function defaultSessionRange(now: Date = new Date()): { from: string; to: string } {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)
  return { from: toIsoDate(from), to: toIsoDate(now) }
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** Null when the range can be queried; otherwise the i18n key of the problem. */
export function sessionRangeError(range: { from: string; to: string }): string | null {
  if (!isValidIsoDate(range.from) || !isValidIsoDate(range.to)) return 'athletes.daily.filters.invalidDate'
  if (range.from > range.to) return 'athletes.daily.filters.fromAfterTo'
  return null
}

const DAILY_ERROR_KEY = /^athletes\.dailyImport\.(errors|reasons)\.[A-Za-z0-9_]+$/

/**
 * The i18n key of a daily-data API error (`{ error: 'athletes.dailyImport.errors.*' }`), with
 * a status-based fallback for errors without a domain key.
 */
export function dailyImportErrorKey(err: unknown, fallbackKey: string): string {
  const source = err as { error?: unknown; message?: unknown; status?: unknown } | null
  for (const candidate of [source?.error, source?.message]) {
    if (typeof candidate === 'string' && DAILY_ERROR_KEY.test(candidate.trim())) return candidate.trim()
  }
  const status = typeof source?.status === 'number' ? source.status : null
  if (status === 403) return 'athletes.daily.errors.forbidden'
  if (status === 413) return 'athletes.dailyImport.errors.fileTooLarge'
  if (status === 415) return 'athletes.dailyImport.errors.unsupportedType'
  return fallbackKey
}

/** The missing column keys of a `missingColumns` 400 (`columns: RpeColumn[]`). */
export function missingColumnKeys(err: unknown): string[] {
  const columns = (err as { columns?: unknown } | null)?.columns
  if (!Array.isArray(columns)) return []
  return columns.filter((column): column is string => typeof column === 'string' && /^[A-Za-z]+$/.test(column))
    .map((column) => `athletes.dailyImport.columns.${column}`)
}

/** The import's file accept list and size cap (the API enforces both as well). */
export const DAILY_IMPORT_ACCEPT = '.xlsx,.csv'
export const DAILY_IMPORT_MAX_BYTES = 2 * 1024 * 1024
