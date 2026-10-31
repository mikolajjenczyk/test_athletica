import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { AthletesTestResult, AthletesTestSession, AthletesTestTrial } from '../data/entities'
import type { ClubScope } from './scope'
import { computeCheckFlag, toNumberOrNull, type TrialLike } from './testScoring'
import { toTestResultView, type TestResultView } from './testResultView'

/**
 * `athletesTestResultsService` — the read contract for test results (spec E02, REQ-013) used by
 * the test view and, later, by the player card, AI observations, reports and the dashboard
 * (SPEC 4–7) instead of querying the tables themselves.
 *
 * Every read is bound to one club scope (tenant + organization from the trusted request
 * context); a missing scope returns nothing. Both flags are computed at read time so they stay
 * right after corrections:
 * - `checkFlag` ("sprawdź", D372): the best trial differs by more than 10% from the player's
 *   previous recorded result in the same test or from another valid trial of the same session.
 * - `noPreviousMeasurement` ("Brak wcześniejszego pomiaru", R12): no earlier recorded result of
 *   the player in this test.
 */
export type TestResultWithFlags = TestResultView & {
  checkFlag: boolean
  noPreviousMeasurement: boolean
}

export type TestResultsReadOptions = {
  /** Only callers with `athletes.tests.record` may see "Nie wykonał" reasons (D109). */
  includeReason?: boolean
}

export type TestResultsFilters = {
  definitionId?: string
  teamId?: string
  playerId?: string
  sessionId?: string
  from?: string
  to?: string
  limit?: number
}

export type AthletesTestResultsService = {
  getPlayerHistory(scope: ClubScope, playerId: string, definitionId: string, options?: TestResultsReadOptions): Promise<TestResultWithFlags[]>
  getSessionResults(scope: ClubScope, sessionId: string, options?: TestResultsReadOptions): Promise<TestResultWithFlags[]>
  listResults(scope: ClubScope, filters: TestResultsFilters, options?: TestResultsReadOptions): Promise<TestResultWithFlags[]>
}

export const ATHLETES_TEST_RESULTS_SERVICE = 'athletesTestResultsService' as const

const DEFAULT_LIMIT = 200
const MAX_LIMIT = 500

function hasScope(scope: ClubScope | null | undefined): scope is ClubScope {
  return !!scope?.tenantId && !!scope.organizationId
}

function scoped<E>(scope: ClubScope, where: Record<string, unknown>): FilterQuery<E> {
  return { ...where, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null } as FilterQuery<E>
}

function isoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value ?? '').slice(0, 10)
}

function createdMs(row: AthletesTestResult): number {
  return row.createdAt instanceof Date ? row.createdAt.getTime() : 0
}

/** Earlier = older test date; on the same date, the earlier created row. */
function isEarlier(candidate: AthletesTestResult, current: AthletesTestResult): boolean {
  const a = isoDate(candidate.testedOn)
  const b = isoDate(current.testedOn)
  if (a !== b) return a < b
  return createdMs(candidate) < createdMs(current)
}

/** Adds `checkFlag` and `noPreviousMeasurement` to a set of results with two batched reads. */
export async function decorateResults(
  em: EntityManager,
  scope: ClubScope,
  rows: AthletesTestResult[],
  options: TestResultsReadOptions = {},
): Promise<TestResultWithFlags[]> {
  if (rows.length === 0) return []
  const playerIds = Array.from(new Set(rows.map((row) => row.playerId)))
  const definitionIds = Array.from(new Set(rows.map((row) => row.testDefinitionId)))
  const sessionIds = Array.from(new Set(rows.map((row) => row.sessionId)))

  const [history, trials] = await Promise.all([
    em.find(
      AthletesTestResult,
      scoped<AthletesTestResult>(scope, {
        playerId: { $in: playerIds },
        testDefinitionId: { $in: definitionIds },
        state: 'recorded',
      }),
      { orderBy: { testedOn: 'asc', createdAt: 'asc' } },
    ),
    em.find(
      AthletesTestTrial,
      scoped<AthletesTestTrial>(scope, { sessionId: { $in: sessionIds }, playerId: { $in: playerIds } }),
    ),
  ])

  const historyByKey = new Map<string, AthletesTestResult[]>()
  for (const row of history) {
    const key = `${row.playerId}|${row.testDefinitionId}`
    const list = historyByKey.get(key) ?? []
    list.push(row)
    historyByKey.set(key, list)
  }
  const trialsByKey = new Map<string, TrialLike[]>()
  for (const trial of trials) {
    const key = `${trial.sessionId}|${trial.playerId}`
    const list = trialsByKey.get(key) ?? []
    list.push({ attemptNo: trial.attemptNo, value: trial.value ?? null, isInvalid: trial.isInvalid })
    trialsByKey.set(key, list)
  }

  return rows.map((row) => {
    const earlier = (historyByKey.get(`${row.playerId}|${row.testDefinitionId}`) ?? [])
      .filter((candidate) => candidate.id !== row.id && isEarlier(candidate, row))
    const previous = earlier.length > 0 ? earlier[earlier.length - 1] : null
    const view = toTestResultView(row, { includeReason: !!options.includeReason })
    return {
      ...view,
      noPreviousMeasurement: previous === null,
      checkFlag: computeCheckFlag({
        value: row.state === 'recorded' ? view.value : null,
        previousValue: previous ? toNumberOrNull(previous.value) : null,
        trials: trialsByKey.get(`${row.sessionId}|${row.playerId}`) ?? [],
      }),
    }
  })
}

/**
 * Awilix provider registered in `di.ts`. The parameter is named `em` on purpose: the container
 * resolves registrations by parameter name (classic injection). Registered `.scoped()` so it
 * never pins one request's EntityManager for the life of the process.
 */
export function createAthletesTestResultsService(em: EntityManager): AthletesTestResultsService {
  const read = () => em.fork()

  async function listResults(scope: ClubScope, filters: TestResultsFilters, options: TestResultsReadOptions = {}) {
    if (!hasScope(scope)) return []
    const manager = read()
    const where: Record<string, unknown> = {}
    if (filters.definitionId) where.testDefinitionId = filters.definitionId
    if (filters.playerId) where.playerId = filters.playerId
    if (filters.sessionId) where.sessionId = filters.sessionId
    if (filters.from || filters.to) {
      where.testedOn = { ...(filters.from ? { $gte: filters.from } : {}), ...(filters.to ? { $lte: filters.to } : {}) }
    }
    if (filters.teamId) {
      const sessions = await manager.find(
        AthletesTestSession,
        scoped<AthletesTestSession>(scope, { teamId: filters.teamId }),
        { fields: ['id'] },
      )
      const ids = sessions.map((row) => row.id).filter((id) => !filters.sessionId || id === filters.sessionId)
      if (ids.length === 0) return []
      where.sessionId = { $in: ids }
    }
    const limit = Math.min(Math.max(filters.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
    const rows = await manager.find(AthletesTestResult, scoped<AthletesTestResult>(scope, where), {
      orderBy: { testedOn: 'desc', createdAt: 'desc' },
      limit,
    })
    return decorateResults(manager, scope, rows, options)
  }

  return {
    listResults,
    getPlayerHistory: (scope, playerId, definitionId, options) =>
      listResults(scope, { playerId, definitionId, limit: MAX_LIMIT }, options),
    getSessionResults: (scope, sessionId, options) =>
      listResults(scope, { sessionId, limit: MAX_LIMIT }, options),
  }
}
