import { describe, expect, it, jest } from '@jest/globals'
import { AthletesTestResult, AthletesTestSession, AthletesTestTrial } from '../../data/entities'
import { createAthletesTestResultsService } from '../testResultsService'

const TENANT = '11111111-1111-4111-8111-111111111111'
const CLUB_A = '22222222-2222-4222-8222-222222222222'
const scope = { tenantId: TENANT, organizationId: CLUB_A }

type AnyFn = (...args: unknown[]) => unknown

function result(id: string, testedOn: string, value: string | null, extra: Record<string, unknown> = {}) {
  return {
    id, sessionId: `s-${id}`, playerId: 'p-1', testDefinitionId: 'd-1', testedOn, value,
    state: value === null ? 'not_performed' : 'recorded', reasonCode: value === null ? 'absent' : null,
    isMakeup: false, countsInTeamAverage: true, correctedAt: null,
    createdAt: new Date(`${testedOn}T10:00:00Z`), updatedAt: new Date(`${testedOn}T10:00:00Z`),
    tenantId: TENANT, organizationId: CLUB_A, ...extra,
  }
}

function makeEm(data: { listed: unknown[]; history: unknown[]; trials: unknown[]; sessions?: unknown[] }) {
  const find = jest.fn<AnyFn>(async (entity: unknown, where: unknown) => {
    if (entity === AthletesTestTrial) return data.trials
    if (entity === AthletesTestSession) return data.sessions ?? []
    if (entity === AthletesTestResult) return (where as Record<string, unknown>).state === 'recorded' ? data.history : data.listed
    return []
  })
  const em: Record<string, unknown> = { find }
  em.fork = () => em
  return { em, find }
}

describe('athletesTestResultsService', () => {
  const first = result('r-1', '2026-08-10', '40')
  const second = result('r-2', '2026-09-20', '45')
  const third = result('r-3', '2026-10-28', '46')

  it('marks the first result "Brak wcześniejszego pomiaru" and flags a >10% jump (D372)', async () => {
    const { em } = makeEm({
      listed: [third, second, first],
      history: [first, second, third],
      trials: [
        { sessionId: 's-r-3', playerId: 'p-1', attemptNo: 1, value: '46', isInvalid: false },
        { sessionId: 's-r-3', playerId: 'p-1', attemptNo: 2, value: '45.5', isInvalid: false },
      ],
    })
    const service = createAthletesTestResultsService(em as never)
    const items = await service.getPlayerHistory(scope, 'p-1', 'd-1')
    const byId = Object.fromEntries(items.map((item) => [item.id, item]))
    expect(byId['r-1']).toMatchObject({ noPreviousMeasurement: true, checkFlag: false })
    expect(byId['r-2']).toMatchObject({ noPreviousMeasurement: false, checkFlag: true }) // 45 vs 40 = +12.5%
    expect(byId['r-3']).toMatchObject({ noPreviousMeasurement: false, checkFlag: false }) // 46 vs 45, trials close
  })

  it('flags a best trial far from another valid trial in the same session', async () => {
    const only = result('r-9', '2026-10-28', '50')
    const { em } = makeEm({
      listed: [only],
      history: [only],
      trials: [
        { sessionId: 's-r-9', playerId: 'p-1', attemptNo: 1, value: '50', isInvalid: false },
        { sessionId: 's-r-9', playerId: 'p-1', attemptNo: 2, value: '40', isInvalid: false },
      ],
    })
    const [item] = await createAthletesTestResultsService(em as never).getSessionResults(scope, 's-r-9')
    expect(item).toMatchObject({ checkFlag: true, noPreviousMeasurement: true })
  })

  it('omits reasons unless asked by a caller who records tests (D109)', async () => {
    const gap = result('r-5', '2026-10-28', null)
    const { em } = makeEm({ listed: [gap], history: [], trials: [] })
    const service = createAthletesTestResultsService(em as never)
    const [viewOnly] = await service.listResults(scope, {})
    expect('reasonCode' in viewOnly).toBe(false)
    expect(viewOnly).toMatchObject({ value: null, state: 'not_performed', checkFlag: false })
    const [recorder] = await service.listResults(scope, {}, { includeReason: true })
    expect(recorder.reasonCode).toBe('absent')
  })

  it('scopes every read to the club and fails closed without one', async () => {
    const { em, find } = makeEm({ listed: [first], history: [first], trials: [] })
    const service = createAthletesTestResultsService(em as never)
    expect(await service.listResults({ tenantId: TENANT, organizationId: '' }, {})).toEqual([])
    expect(find).not.toHaveBeenCalled()
    await service.listResults(scope, { playerId: 'p-1' })
    for (const call of find.mock.calls) {
      expect(call[1]).toMatchObject({ tenantId: TENANT, organizationId: CLUB_A, deletedAt: null })
    }
  })

  it('filters a team through its sessions and returns nothing for a team without sessions', async () => {
    const { em, find } = makeEm({ listed: [first], history: [first], trials: [], sessions: [] })
    expect(await createAthletesTestResultsService(em as never).listResults(scope, { teamId: 't-1' })).toEqual([])
    expect(find).toHaveBeenCalledTimes(1)
  })
})
