/**
 * Pure helpers behind the E02 test screens ("Zestaw testów", "Rozpocznij test", "Tryb boisko",
 * "Widok testu"). No React and no I/O, so they are unit-tested on their own; components turn the
 * returned i18n keys into copy.
 */

export type TestDirection = 'higher_better' | 'lower_better'

export type TestDefinitionListItem = {
  id: string
  templateKey: string
  name: string
  variant: string | null
  unit: string
  direction: TestDirection
  attempts: number
  countingRule: 'best'
  clearChangeThreshold: number | null
  thresholdSource: string | null
  repeatEveryWeeks: number
  sortOrder: number
  isActive: boolean
  updatedAt: string | null
}

export type TestSessionListItem = {
  id: string
  testDefinitionId: string
  kind: 'team' | 'individual'
  teamId: string | null
  playerId: string | null
  testedOn: string
  status: 'open' | 'finished'
  finishedAt: string | null
  updatedAt: string | null
}

export type TestResultState = 'recorded' | 'empty' | 'invalid_attempt' | 'not_performed' | 'joined_later'
export type TestReasonCode = 'absent' | 'excused' | 'other'

export type TestResultListItem = {
  id: string
  sessionId: string
  playerId: string
  testDefinitionId: string
  testedOn: string
  value: number | null
  state: TestResultState
  reasonCode?: TestReasonCode | null
  isMakeup: boolean
  countsInTeamAverage: boolean
  correctedAt: string | null
  updatedAt: string | null
  checkFlag: boolean
  noPreviousMeasurement: boolean
}

export const TEST_REASON_CODES: readonly TestReasonCode[] = ['absent', 'excused', 'other']

/** "Nazwa · wariant" — the Polish catalog name always comes first (FR-005). */
export function formatTestName(name: string, variant: string | null | undefined): string {
  const base = name.trim()
  const extra = (variant ?? '').trim()
  return extra ? `${base} · ${extra}` : base
}

export function directionLabelKey(direction: TestDirection): string {
  return direction === 'lower_better' ? 'athletes.tests.direction.lowerBetter' : 'athletes.tests.direction.higherBetter'
}

/** Formats a measured value in the user's locale; never turns a missing value into 0. */
export function formatTestNumber(value: number | null | undefined, locale: string): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  try {
    return new Intl.NumberFormat(locale || 'pl', { maximumFractionDigits: 2 }).format(value)
  } catch {
    return String(value)
  }
}

export function formatTestValue(value: number | null | undefined, unit: string, locale: string): string | null {
  const formatted = formatTestNumber(value, locale)
  if (formatted === null) return null
  return unit ? `${formatted} ${unit}` : formatted
}

/** The latest open session per test definition ("Test w trakcie · Wróć do testu"). */
export function openSessionsByDefinition(sessions: readonly TestSessionListItem[]): Map<string, TestSessionListItem> {
  const map = new Map<string, TestSessionListItem>()
  for (const session of sessions) {
    if (session.status !== 'open') continue
    const current = map.get(session.testDefinitionId)
    if (!current || session.testedOn > current.testedOn) map.set(session.testDefinitionId, session)
  }
  return map
}

/** Local calendar date as `YYYY-MM-DD` (the start form defaults to today). */
export function todayIsoDate(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

// ---------------------------------------------------------------------------
// "Tryb boisko" (REQ-003…REQ-006)
// ---------------------------------------------------------------------------

/** One player's entry on the field screen; nothing of it is kept once it is lost or saved. */
export type FieldEntry = {
  values: string[]
  invalid: boolean[]
  reason: TestReasonCode | null
}

export type RecordTrialInput = { attemptNo: number; value?: number; isInvalid?: boolean }

export type RecordBody = {
  trials: RecordTrialInput[]
  state?: 'not_performed'
  reasonCode?: TestReasonCode
}

export type BuildRecordOutcome =
  | { kind: 'empty' }
  | { kind: 'invalidValue'; attemptNo: number }
  | { kind: 'ok'; body: RecordBody }

export type RosterPlayer = {
  id: string
  teamId: string
  firstName: string
  lastName: string
  joinedAt: string
  isActive: boolean
}

export const FIELD_VALUE_MAX_LENGTH = 7

export function emptyFieldEntry(attempts: number): FieldEntry {
  const count = Math.max(1, Math.floor(attempts) || 1)
  return { values: Array.from({ length: count }, () => ''), invalid: Array.from({ length: count }, () => false), reason: null }
}

export function isFieldEntryEmpty(entry: FieldEntry): boolean {
  return !entry.reason && entry.invalid.every((flag) => !flag) && entry.values.every((value) => value.trim() === '')
}

/** Accepts "41,5" and "41.5"; a gap is never 0, so anything not > 0 is rejected. */
export function parseTrialValue(text: string): number | null {
  const normalized = text.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null
  const value = Number(normalized)
  return Number.isFinite(value) && value > 0 ? value : null
}

/** Keeps digits and one decimal separator (shown as `separator`), at most 7 characters. */
export function sanitizeTrialText(text: string, separator: string): string {
  let seen = false
  let out = ''
  for (const char of text) {
    if (char >= '0' && char <= '9') out += char
    else if ((char === ',' || char === '.') && !seen) {
      seen = true
      out += separator
    }
    if (out.length >= FIELD_VALUE_MAX_LENGTH) break
  }
  return out
}

/** The big keypad: a digit, the decimal separator or `backspace`. */
export function applyKeypadKey(current: string, key: string, separator: string): string {
  if (key === 'backspace') return current.slice(0, -1)
  if (key === 'separator') {
    if (current.includes(',') || current.includes('.')) return current
    return sanitizeTrialText(`${current || '0'}${separator}`, separator)
  }
  if (!/^\d$/.test(key)) return current
  return sanitizeTrialText(`${current}${key}`, separator)
}

/** One record call per player ("Dalej"); an untouched entry saves nothing. */
export function buildRecordBody(entry: FieldEntry): BuildRecordOutcome {
  if (entry.reason) return { kind: 'ok', body: { trials: [], state: 'not_performed', reasonCode: entry.reason } }
  const trials: RecordTrialInput[] = []
  for (let index = 0; index < entry.values.length; index += 1) {
    const attemptNo = index + 1
    if (entry.invalid[index]) {
      trials.push({ attemptNo, isInvalid: true })
      continue
    }
    const text = entry.values[index]?.trim() ?? ''
    if (!text) continue
    const value = parseTrialValue(text)
    if (value === null) return { kind: 'invalidValue', attemptNo }
    trials.push({ attemptNo, value })
  }
  if (trials.length === 0) return { kind: 'empty' }
  return { kind: 'ok', body: { trials } }
}

/** Same player + same trials = same entry, so a retry reuses its idempotency key. */
export function recordFingerprint(playerId: string, body: RecordBody): string {
  return JSON.stringify([playerId, body.state ?? null, body.reasonCode ?? null, body.trials])
}

export function createIdempotencyKey(
  randomUUID: (() => string) | undefined = typeof globalThis.crypto?.randomUUID === 'function'
    ? () => globalThis.crypto.randomUUID()
    : undefined,
): string {
  if (randomUUID) return `field-${randomUUID()}`
  return `field-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/** Players who take a team test: active, in the team, and already in the club on the test date. */
export function buildRoster(
  players: readonly RosterPlayer[],
  session: Pick<TestSessionListItem, 'kind' | 'teamId' | 'playerId' | 'testedOn'>,
): RosterPlayer[] {
  const roster = session.kind === 'individual'
    ? players.filter((player) => player.id === session.playerId)
    : players.filter((player) => player.isActive && player.teamId === session.teamId && player.joinedAt.slice(0, 10) <= session.testedOn)
  return [...roster].sort((a, b) => {
    const byLast = a.lastName.localeCompare(b.lastName)
    return byLast !== 0 ? byLast : a.firstName.localeCompare(b.firstName)
  })
}

/** "Dalej": the next player after `currentId` (wrapping) who has no saved data, or null. */
export function nextPlayerWithMissing(
  rosterIds: readonly string[],
  savedIds: ReadonlySet<string>,
  currentId: string | null,
): string | null {
  if (rosterIds.length === 0) return null
  const start = currentId ? rosterIds.indexOf(currentId) : -1
  for (let step = 1; step <= rosterIds.length; step += 1) {
    const candidate = rosterIds[(start + step + rosterIds.length) % rosterIds.length]
    if (candidate !== currentId && !savedIds.has(candidate)) return candidate
  }
  return null
}

export function countSaved(rosterIds: readonly string[], savedIds: ReadonlySet<string>): number {
  return rosterIds.filter((id) => savedIds.has(id)).length
}

/** Decimal separator of the locale ("," in Polish, "." in English). */
export function decimalSeparator(locale: string): string {
  try {
    const part = new Intl.NumberFormat(locale || 'pl').formatToParts(1.5).find((item) => item.type === 'decimal')
    return part?.value === '.' ? '.' : ','
  } catch {
    return ','
  }
}

// ---------------------------------------------------------------------------
// Result states (REQ-010: a gap is a state, never 0)
// ---------------------------------------------------------------------------

export function resultStateLabelKey(state: TestResultState): string | null {
  switch (state) {
    case 'recorded':
      return null
    case 'invalid_attempt':
      return 'athletes.tests.state.invalidAttempt'
    case 'not_performed':
      return 'athletes.tests.state.notPerformed'
    case 'joined_later':
      return 'athletes.tests.state.joinedLater'
    case 'empty':
    default:
      return 'athletes.tests.state.empty'
  }
}

export function reasonLabelKey(reason: TestReasonCode): string {
  return `athletes.tests.reason.${reason}`
}
