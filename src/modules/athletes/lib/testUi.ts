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
