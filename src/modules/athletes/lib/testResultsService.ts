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

type PreviousRow = { result_id: string; previous_value: string | number | null }

/**
 * The previous recorded result of each given result: same player and test, an older test date
 * (or the same date and created earlier), never the row itself. One bounded read — at most
 * one history row per result on the page, found through `athletes_test_results_history_idx`
 * — instead of loading the players' whole history.
 */
async function loadPreviousValues(
  em: EntityManager,
  scope: ClubScope,
  resultIds: string[],
): Promise<Map<string, string | number | null>> {
  const placeholders = resultIds.map(() => '?').join(', ')
  const rows = await em.getConnection().execute<PreviousRow[]>(
    `select p.id as result_id, prev.value as previous_value
       from athletes_test_results p
       join lateral (
         select h.value
           from athletes_test_results h
          where h.tenant_id = p.tenant_id
            and h.organization_id = p.organization_id
            and h.player_id = p.player_id
            and h.test_definition_id = p.test_definition_id
            and h.state = 'recorded'
            and h.deleted_at is null
            and h.id <> p.id
            and h.tested_on <= p.tested_on
            and (h.tested_on < p.tested_on or h.created_at < p.created_at)
          order by h.tested_on desc, h.created_at desc
          limit 1
       ) prev on true
      where p.tenant_id = ?
        and p.organization_id = ?
        and p.id in (${placeholders})`,
    [scope.tenantId, scope.organizationId, ...resultIds],
  )
  return new Map(rows.map((row) => [String(row.result_id), row.previous_value]))
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
  const sessionIds = Array.from(new Set(rows.map((row) => row.sessionId)))

  const [previousById, trials] = await Promise.all([
    loadPreviousValues(em, scope, rows.map((row) => String(row.id))),
    em.find(
      AthletesTestTrial,
      scoped<AthletesTestTrial>(scope, { sessionId: { $in: sessionIds }, playerId: { $in: playerIds } }),
    ),
  ])

  const trialsByKey = new Map<string, TrialLike[]>()
  for (const trial of trials) {
    const key = `${trial.sessionId}|${trial.playerId}`
    const list = trialsByKey.get(key) ?? []
    list.push({ attemptNo: trial.attemptNo, value: trial.value ?? null, isInvalid: trial.isInvalid })
    trialsByKey.set(key, list)
  }

  return rows.map((row) => {
    const hasPrevious = previousById.has(String(row.id))
    const view = toTestResultView(row, { includeReason: !!options.includeReason })
    return {
      ...view,
      noPreviousMeasurement: !hasPrevious,
      checkFlag: computeCheckFlag({
        value: row.state === 'recorded' ? view.value : null,
        previousValue: hasPrevious ? toNumberOrNull(previousById.get(String(row.id)) ?? null) : null,
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
