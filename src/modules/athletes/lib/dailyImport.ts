import type { ParsedCell, ParsedTable } from './dailyFileParser'
import { buildPlayerNameIndex, normalizePersonName } from './nameMatching'

/**
 * RPE file preview and commit plan (spec E01 phase 1, REQ-001…REQ-004, REQ-007) — pure
 * functions shared by the `preview` route and the `athletes.daily_import.commit` command, so
 * what the coach sees is exactly what is saved.
 *
 * - Columns are found by the prototype headers and synonyms (case/diacritic-insensitive);
 *   every other column — "Uwagi", "Obciążenie" (the app computes load itself) — is ignored and
 *   never read further (Q5, N18).
 * - A row is one player's session; RPE empty is "Brak RPE" (null), never 0 (R12).
 * - Reasons are translatable keys (`athletes.dailyImport.reasons.*`); rejected rows carry the
 *   file line and the reason only — no names, no values.
 */

export const SESSION_NO_MIN = 1
export const SESSION_NO_MAX = 3
export const MINUTES_MIN = 1
export const MINUTES_MAX = 300
export const RPE_MIN = 0
export const RPE_MAX = 10
export const KIND_MAX_LENGTH = 40

export const DAILY_IMPORT_REASONS = {
  nameMissing: 'athletes.dailyImport.reasons.nameMissing',
  nameNotAssigned: 'athletes.dailyImport.reasons.nameNotAssigned',
  dateMissing: 'athletes.dailyImport.reasons.dateMissing',
  dateInvalid: 'athletes.dailyImport.reasons.dateInvalid',
  dateInFuture: 'athletes.dailyImport.reasons.dateInFuture',
  dateBeforeJoined: 'athletes.dailyImport.reasons.dateBeforeJoined',
  sessionNoInvalid: 'athletes.dailyImport.reasons.sessionNoInvalid',
  minutesInvalid: 'athletes.dailyImport.reasons.minutesInvalid',
  rpeInvalid: 'athletes.dailyImport.reasons.rpeInvalid',
  duplicateRow: 'athletes.dailyImport.reasons.duplicateRow',
} as const

export type DailyImportReason = typeof DAILY_IMPORT_REASONS[keyof typeof DAILY_IMPORT_REASONS]

export const DAILY_IMPORT_ERRORS = {
  missingColumns: 'athletes.dailyImport.errors.missingColumns',
  noValidRows: 'athletes.dailyImport.errors.noValidRows',
  assignmentUnknownName: 'athletes.dailyImport.errors.assignmentUnknownName',
  assignmentPlayerNotInTeam: 'athletes.dailyImport.errors.assignmentPlayerNotInTeam',
  assignmentPlayerInactive: 'athletes.dailyImport.errors.assignmentPlayerInactive',
  assignmentPlayerAlreadyMatched: 'athletes.dailyImport.errors.assignmentPlayerAlreadyMatched',
  assignmentPlayerDuplicate: 'athletes.dailyImport.errors.assignmentPlayerDuplicate',
} as const

// ---------------------------------------------------------------------------
// Header mapping
// ---------------------------------------------------------------------------

export type RpeColumn = 'player' | 'firstName' | 'lastName' | 'date' | 'sessionNo' | 'kind' | 'minutes' | 'rpe'

/** Prototype rev-053 headers ("data, nr sesji, rodzaj, minuty, RPE 0–10") plus synonyms (decision 2026-10-31). */
const RPE_HEADER_SYNONYMS: Record<RpeColumn, string[]> = {
  player: ['zawodnik', 'zawodniczka', 'imie i nazwisko', 'nazwisko i imie', 'imie nazwisko', 'nazwisko imie', 'osoba', 'player', 'athlete', 'name', 'full name'],
  firstName: ['imie', 'first name', 'firstname'],
  lastName: ['nazwisko', 'last name', 'lastname', 'surname'],
  date: ['data', 'dzien', 'data sesji', 'data treningu', 'date', 'day'],
  sessionNo: ['nr sesji', 'numer sesji', 'sesja', 'sesja nr', 'nr', 'session', 'session no', 'session number', 'trening nr'],
  kind: ['rodzaj', 'rodzaj sesji', 'rodzaj zajec', 'typ', 'typ sesji', 'kind', 'type'],
  minutes: ['minuty', 'min', 'czas', 'czas min', 'czas trwania', 'czas trwania min', 'minutes', 'duration'],
  rpe: ['rpe', 'rpe 0 10', 'ocena rpe', 'srpe ocena'],
}

export function normalizeHeader(header: string): string {
  return normalizePersonName(header)
}

export type RpeHeaderMapping = Partial<Record<RpeColumn, string>>

export type RpeHeaderResult =
  | { ok: true; mapping: RpeHeaderMapping; ignoredColumns: string[] }
  | { ok: false; missingColumns: RpeColumn[] }

/** Synonym rank of a header for a column (lower is better), or -1 when it does not match. */
function headerRank(column: RpeColumn, normalized: string): number {
  const rank = RPE_HEADER_SYNONYMS[column].indexOf(normalized)
  if (rank >= 0) return rank
  // "RPE (0–10)", "RPE 1-10 skala" …: any header that starts with the word RPE.
  return column === 'rpe' && /^rpe( |$)/.test(normalized) ? RPE_HEADER_SYNONYMS.rpe.length : -1
}

/**
 * Maps file headers to RPE columns: for each column the header with the best-ranked synonym
 * wins (so "Sesja" beats a generic "Nr"). Required: a name (one "zawodnik" column, or first
 * and last name), date, session number, minutes and RPE; `rodzaj` is optional.
 */
export function mapRpeHeaders(headers: string[]): RpeHeaderResult {
  const mapping: RpeHeaderMapping = {}
  const used = new Set<string>()
  const order: RpeColumn[] = ['rpe', 'player', 'firstName', 'lastName', 'date', 'sessionNo', 'kind', 'minutes']
  for (const column of order) {
    let best: { header: string; rank: number } | null = null
    for (const header of headers) {
      if (used.has(header)) continue
      const rank = headerRank(column, normalizeHeader(header))
      if (rank >= 0 && (!best || rank < best.rank)) best = { header, rank }
    }
    if (best) {
      mapping[column] = best.header
      used.add(best.header)
    }
  }
  const missing: RpeColumn[] = []
  const hasName = !!mapping.player || (!!mapping.firstName && !!mapping.lastName)
  if (!hasName) {
    if (mapping.firstName && !mapping.lastName) missing.push('lastName')
    else if (mapping.lastName && !mapping.firstName) missing.push('firstName')
    else missing.push('player')
  }
  for (const column of ['date', 'sessionNo', 'minutes', 'rpe'] as const) {
    if (!mapping[column]) missing.push(column)
  }
  if (missing.length > 0) return { ok: false, missingColumns: missing }
  return { ok: true, mapping, ignoredColumns: headers.filter((header) => !used.has(header)) }
}

// ---------------------------------------------------------------------------
// Cell parsing
// ---------------------------------------------------------------------------

function isBlank(value: ParsedCell | undefined): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
}

function cellText(value: ParsedCell | undefined): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function isoFromParts(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2999 || month < 1 || month > 12 || day < 1 || day > 31) return null
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const parsed = new Date(`${iso}T12:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : null
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30)

/**
 * `YYYY-MM-DD` (optionally with a time), `d.m.yyyy`, `d/m/yyyy`, `d-m-yyyy`, or an Excel date
 * serial number (a date cell saved without date formatting). Impossible dates are null.
 */
export function parseSessionDate(value: ParsedCell | undefined): string | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 1 || value > 2958465) return null
    const ms = EXCEL_EPOCH_MS + Math.floor(value) * 86_400_000
    return new Date(ms).toISOString().slice(0, 10)
  }
  const text = cellText(value)
  if (!text) return null
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/.exec(text)
  if (iso) return isoFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(text)
  if (dmy) return isoFromParts(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]))
  return null
}

/** An integer cell ("7", "7,0", 7); anything else — text, fractions — is NaN. Blank is null. */
export function parseInteger(value: ParsedCell | undefined): number | null {
  if (isBlank(value)) return null
  if (typeof value === 'number') return Number.isInteger(value) ? value : Number.NaN
  const text = cellText(value).replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(text)) return Number.NaN
  const parsed = Number(text)
  return Number.isInteger(parsed) ? parsed : Number.NaN
}

// ---------------------------------------------------------------------------
// Row validation
// ---------------------------------------------------------------------------

export type RpeRowValues = {
  line: number
  name: string
  sessionDate: string
  sessionNo: number
  kind: string | null
  /** null: no minutes in the file — kept, load stays empty and the row is flagged. */
  minutes: number | null
  /** null: "Brak RPE" — never 0. */
  rpe: number | null
}

export type RpeRowResult = { ok: true; row: RpeRowValues } | { ok: false; line: number; reason: DailyImportReason }

function rowName(cells: Record<string, ParsedCell>, mapping: RpeHeaderMapping): string {
  if (mapping.firstName && mapping.lastName) {
    const full = `${cellText(cells[mapping.firstName])} ${cellText(cells[mapping.lastName])}`.trim()
    if (full) return full
  }
  return mapping.player ? cellText(cells[mapping.player]) : ''
}

/** Validates one row's own values (name present, date, session number, minutes, RPE). */
export function validateRpeRow(
  row: { line: number; cells: Record<string, ParsedCell> },
  mapping: RpeHeaderMapping,
  today: string,
): RpeRowResult {
  const fail = (reason: DailyImportReason): RpeRowResult => ({ ok: false, line: row.line, reason })
  const name = rowName(row.cells, mapping)
  if (!name) return fail(DAILY_IMPORT_REASONS.nameMissing)

  const rawDate = mapping.date ? row.cells[mapping.date] : null
  if (isBlank(rawDate)) return fail(DAILY_IMPORT_REASONS.dateMissing)
  const sessionDate = parseSessionDate(rawDate)
  if (!sessionDate) return fail(DAILY_IMPORT_REASONS.dateInvalid)
  if (sessionDate > today) return fail(DAILY_IMPORT_REASONS.dateInFuture)

  const sessionNo = parseInteger(mapping.sessionNo ? row.cells[mapping.sessionNo] : null)
  if (sessionNo === null || Number.isNaN(sessionNo) || sessionNo < SESSION_NO_MIN || sessionNo > SESSION_NO_MAX) {
    return fail(DAILY_IMPORT_REASONS.sessionNoInvalid)
  }

  const minutes = parseInteger(mapping.minutes ? row.cells[mapping.minutes] : null)
  if (minutes !== null && (Number.isNaN(minutes) || minutes < MINUTES_MIN || minutes > MINUTES_MAX)) {
    return fail(DAILY_IMPORT_REASONS.minutesInvalid)
  }

  const rpe = parseInteger(mapping.rpe ? row.cells[mapping.rpe] : null)
  if (rpe !== null && (Number.isNaN(rpe) || rpe < RPE_MIN || rpe > RPE_MAX)) {
    return fail(DAILY_IMPORT_REASONS.rpeInvalid)
  }

  const kindText = mapping.kind ? cellText(row.cells[mapping.kind]) : ''
  return {
    ok: true,
    row: {
      line: row.line,
      name,
      sessionDate,
      sessionNo,
      kind: kindText ? kindText.slice(0, KIND_MAX_LENGTH) : null,
      minutes,
      rpe,
    },
  }
}

/** Load in AU = RPE × minutes, only when both are present (REQ-004). */
export function computeLoad(rpe: number | null | undefined, minutes: number | null | undefined): number | null {
  if (rpe === null || rpe === undefined || minutes === null || minutes === undefined) return null
  return rpe * minutes
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export type RosterPlayer = {
  id: string
  firstName: string
  lastName: string
  joinedAt: string
  isActive: boolean
}

export type ExistingSession = {
  id: string
  playerId: string
  sessionDate: string
  sessionNo: number
  kind: string | null
  minutes: number | null
  rpe: number | null
}

export type SessionValues = { kind: string | null; minutes: number | null; rpe: number | null }

export type PlannedRowStatus = 'new' | 'corrected' | 'unchanged'

export type PlannedRow = RpeRowValues & {
  playerId: string
  status: PlannedRowStatus
  load: number | null
  /** RPE present but no minutes: load empty, flagged in the preview. */
  noMinutes: boolean
  assigned: boolean
  existingId: string | null
  previous: SessionValues | null
}

export type MissingRpe = { playerId: string; sessionDate: string; sessionNo: number; hasRow: boolean }

export type RpeImportPlan = {
  period: { from: string; to: string } | null
  rows: PlannedRow[]
  missing: MissingRpe[]
  corrections: Array<{ line: number; playerId: string; sessionDate: string; sessionNo: number; before: SessionValues; after: SessionValues }>
  rejected: Array<{ line: number; reason: DailyImportReason }>
  unknownNames: Array<{ name: string; rowCount: number }>
  ignoredColumns: string[]
  counts: { saved: number; corrected: number; unchanged: number; rejected: number; assignedNames: number }
}

export type AssignmentIssue = { code: string; name: string; playerId?: string }

export function sessionKey(playerId: string, sessionDate: string, sessionNo: number): string {
  return `${playerId}|${sessionDate}|${sessionNo}`
}

function sameValues(a: SessionValues, b: SessionValues): boolean {
  return (a.kind ?? null) === (b.kind ?? null) && (a.minutes ?? null) === (b.minutes ?? null) && (a.rpe ?? null) === (b.rpe ?? null)
}

/** Distinct row names (in file order) the roster cannot match unambiguously. */
export function findUnknownNames(rows: RpeRowValues[], roster: RosterPlayer[]): Array<{ name: string; rowCount: number; key: string }> {
  const index = buildPlayerNameIndex(roster.filter((player) => player.isActive))
  const unknown = new Map<string, { name: string; rowCount: number; key: string }>()
  for (const row of rows) {
    if (index.match(row.name)) continue
    const key = normalizePersonName(row.name)
    const entry = unknown.get(key) ?? { name: row.name, rowCount: 0, key }
    entry.rowCount += 1
    unknown.set(key, entry)
  }
  return Array.from(unknown.values())
}

/**
 * Validates the coach's `{ name: playerId }` map (REQ-002, Q4): the name must be one of the
 * file's unknown names; the player must be in the team, active, not already matched by name in
 * this import and assigned at most once. Empty values mean "pomiń". Returns the first issue
 * (400) or the resolved `normalizedName → playerId` map.
 */
export function resolveAssignments(
  assignments: Record<string, string | null | undefined> | null | undefined,
  rows: RpeRowValues[],
  roster: RosterPlayer[],
): { ok: true; byName: Map<string, string> } | { ok: false; issue: AssignmentIssue } {
  const byName = new Map<string, string>()
  if (!assignments) return { ok: true, byName }
  const unknownKeys = new Set(findUnknownNames(rows, roster).map((entry) => entry.key))
  const index = buildPlayerNameIndex(roster.filter((player) => player.isActive))
  const matchedByName = new Set<string>()
  for (const row of rows) {
    const id = index.match(row.name)
    if (id) matchedByName.add(id)
  }
  const rosterById = new Map(roster.map((player) => [player.id, player]))
  const used = new Set<string>()
  for (const [name, playerId] of Object.entries(assignments)) {
    if (!playerId) continue
    const key = normalizePersonName(name)
    if (!unknownKeys.has(key)) return { ok: false, issue: { code: DAILY_IMPORT_ERRORS.assignmentUnknownName, name } }
    const player = rosterById.get(playerId)
    if (!player) return { ok: false, issue: { code: DAILY_IMPORT_ERRORS.assignmentPlayerNotInTeam, name, playerId } }
    if (!player.isActive) return { ok: false, issue: { code: DAILY_IMPORT_ERRORS.assignmentPlayerInactive, name, playerId } }
    if (matchedByName.has(playerId)) {
      return { ok: false, issue: { code: DAILY_IMPORT_ERRORS.assignmentPlayerAlreadyMatched, name, playerId } }
    }
    if (used.has(playerId) || byName.has(key)) {
      return { ok: false, issue: { code: DAILY_IMPORT_ERRORS.assignmentPlayerDuplicate, name, playerId } }
    }
    used.add(playerId)
    byName.set(key, playerId)
  }
  return { ok: true, byName }
}

export type BuildRpePlanInput = {
  table: ParsedTable
  mapping: RpeHeaderMapping
  ignoredColumns: string[]
  roster: RosterPlayer[]
  /** Live sessions of the roster players in the file's period. */
  existing: ExistingSession[]
  /** Resolved assignments (`normalizedName → playerId`) from {@link resolveAssignments}. */
  assignments: Map<string, string>
  today: string
}

/**
 * Validates every row, resolves players (by name, then by assignment), drops duplicates within
 * the file and classifies each remaining row as new, corrected or unchanged against the stored
 * sessions. Rows of an unassigned unknown name are rejected ("nie przypisano zawodnika").
 */
export function buildRpePlan(input: BuildRpePlanInput): RpeImportPlan {
  const rejected: RpeImportPlan['rejected'] = []
  const valid: RpeRowValues[] = []
  for (const raw of input.table.rows) {
    const result = validateRpeRow(raw, input.mapping, input.today)
    if (result.ok) valid.push(result.row)
    else rejected.push({ line: result.line, reason: result.reason })
  }

  const unknown = findUnknownNames(valid, input.roster)
  const index = buildPlayerNameIndex(input.roster.filter((player) => player.isActive))
  const rosterById = new Map(input.roster.map((player) => [player.id, player]))
  const existingByKey = new Map(input.existing.map((row) => [sessionKey(row.playerId, row.sessionDate, row.sessionNo), row]))

  const rows: PlannedRow[] = []
  const seen = new Set<string>()
  const assignedUsed = new Set<string>()
  for (const row of valid) {
    const matched = index.match(row.name)
    const assignedId = matched ? null : input.assignments.get(normalizePersonName(row.name)) ?? null
    const playerId = matched ?? assignedId
    if (!playerId) {
      rejected.push({ line: row.line, reason: DAILY_IMPORT_REASONS.nameNotAssigned })
      continue
    }
    const player = rosterById.get(playerId)
    if (player && row.sessionDate < player.joinedAt) {
      rejected.push({ line: row.line, reason: DAILY_IMPORT_REASONS.dateBeforeJoined })
      continue
    }
    const key = sessionKey(playerId, row.sessionDate, row.sessionNo)
    if (seen.has(key)) {
      rejected.push({ line: row.line, reason: DAILY_IMPORT_REASONS.duplicateRow })
      continue
    }
    seen.add(key)
    if (assignedId) assignedUsed.add(normalizePersonName(row.name))

    const existing = existingByKey.get(key) ?? null
    const next: SessionValues = { kind: row.kind, minutes: row.minutes, rpe: row.rpe }
    const previous: SessionValues | null = existing
      ? { kind: existing.kind ?? null, minutes: existing.minutes ?? null, rpe: existing.rpe ?? null }
      : null
    const status: PlannedRowStatus = !previous ? 'new' : sameValues(previous, next) ? 'unchanged' : 'corrected'
    rows.push({
      ...row,
      playerId,
      status,
      load: computeLoad(row.rpe, row.minutes),
      noMinutes: row.rpe !== null && row.minutes === null,
      assigned: !!assignedId,
      existingId: existing?.id ?? null,
      previous,
    })
  }

  rejected.sort((a, b) => a.line - b.line)

  const dates = rows.map((row) => row.sessionDate).sort()
  const period = dates.length > 0 ? { from: dates[0], to: dates[dates.length - 1] } : null

  // "Brak RPE" per player and team session (date, number): a row without RPE, or no row at
  // all for a roster player who had already joined (a later joiner is not missing).
  const teamSessions = new Map<string, { sessionDate: string; sessionNo: number }>()
  for (const row of rows) teamSessions.set(`${row.sessionDate}|${row.sessionNo}`, { sessionDate: row.sessionDate, sessionNo: row.sessionNo })
  const rowByKey = new Map(rows.map((row) => [sessionKey(row.playerId, row.sessionDate, row.sessionNo), row]))
  const missing: MissingRpe[] = []
  const sortedSessions = Array.from(teamSessions.values()).sort(
    (a, b) => a.sessionDate.localeCompare(b.sessionDate) || a.sessionNo - b.sessionNo,
  )
  for (const session of sortedSessions) {
    for (const player of input.roster) {
      if (!player.isActive || player.joinedAt > session.sessionDate) continue
      const row = rowByKey.get(sessionKey(player.id, session.sessionDate, session.sessionNo))
      if (!row) missing.push({ playerId: player.id, ...session, hasRow: false })
      else if (row.rpe === null) missing.push({ playerId: player.id, ...session, hasRow: true })
    }
  }

  const corrections = rows
    .filter((row) => row.status === 'corrected' && row.previous)
    .map((row) => ({
      line: row.line,
      playerId: row.playerId,
      sessionDate: row.sessionDate,
      sessionNo: row.sessionNo,
      before: row.previous as SessionValues,
      after: { kind: row.kind, minutes: row.minutes, rpe: row.rpe },
    }))

  return {
    period,
    rows,
    missing,
    corrections,
    rejected,
    unknownNames: unknown.map(({ name, rowCount }) => ({ name, rowCount })),
    ignoredColumns: input.ignoredColumns,
    counts: {
      saved: rows.filter((row) => row.status === 'new').length,
      corrected: corrections.length,
      unchanged: rows.filter((row) => row.status === 'unchanged').length,
      rejected: rejected.length,
      assignedNames: assignedUsed.size,
    },
  }
}
