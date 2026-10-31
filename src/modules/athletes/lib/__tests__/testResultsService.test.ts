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

type Row = ReturnType<typeof result>

/**
 * `history` stands for the table: the mocked previous-result query applies the same rule as
 * the SQL (same player and test, recorded, older date or same date created earlier, latest
 * first) to the result ids it is asked about.
 */
function makeEm(data: { listed: unknown[]; history: unknown[]; trials: unknown[]; sessions?: unknown[] }) {
  const find = jest.fn<AnyFn>(async (entity: unknown) => {
    if (entity === AthletesTestTrial) return data.trials
    if (entity === AthletesTestSession) return data.sessions ?? []
    if (entity === AthletesTestResult) return data.listed
    return []
  })
  const table = [...(data.listed as Row[]), ...(data.history as Row[])]
  const execute = jest.fn<AnyFn>(async (_sql: unknown, params: unknown) => {
    const ids = (params as string[]).slice(2)
    const out: Array<{ result_id: string; previous_value: unknown }> = []
    for (const id of ids) {
      const page = table.find((row) => row.id === id)
      if (!page) continue
      const earlier = (data.history as Row[])
        .filter((h) => h.id !== page.id && h.playerId === page.playerId && h.testDefinitionId === page.testDefinitionId && h.state === 'recorded')
        .filter((h) => h.testedOn < page.testedOn || (h.testedOn === page.testedOn && h.createdAt < page.createdAt))
        .sort((a, b) => (a.testedOn === b.testedOn ? b.createdAt.getTime() - a.createdAt.getTime() : a.testedOn < b.testedOn ? 1 : -1))
      if (earlier[0]) out.push({ result_id: id, previous_value: earlier[0].value })
    }
    return out
  })
  const em: Record<string, unknown> = { find, getConnection: () => ({ execute }) }
  em.fork = () => em
  return { em, find, execute }
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
    const { em, find, execute } = makeEm({ listed: [first], history: [first], trials: [] })
    const service = createAthletesTestResultsService(em as never)
    expect(await service.listResults({ tenantId: TENANT, organizationId: '' }, {})).toEqual([])
    expect(find).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
    await service.listResults(scope, { playerId: 'p-1' })
    for (const call of find.mock.calls) {
      expect(call[1]).toMatchObject({ tenantId: TENANT, organizationId: CLUB_A, deletedAt: null })
    }
    expect(execute.mock.calls[0][1]).toEqual([TENANT, CLUB_A, 'r-1'])
  })

  it('reads at most one earlier result per listed result, bounded by its own date', async () => {
    const { em, execute } = makeEm({ listed: [third], history: [first, second, third], trials: [] })
    const [item] = await createAthletesTestResultsService(em as never).getSessionResults(scope, 's-r-3')
    expect(item).toMatchObject({ id: 'r-3', noPreviousMeasurement: false, checkFlag: false }) // vs 45, not 40
    expect(execute).toHaveBeenCalledTimes(1)
    const sql = String(execute.mock.calls[0][0])
    expect(sql).toMatch(/join lateral/)
    expect(sql).toMatch(/h\.tested_on <= p\.tested_on/)
    expect(sql).toMatch(/limit 1/)
    expect(sql).toMatch(/h\.tenant_id = p\.tenant_id/)
  })

  it('treats a same-day result created earlier as the previous measurement', async () => {
    const morning = result('r-a', '2026-10-28', '40', { createdAt: new Date('2026-10-28T08:00:00Z') })
    const evening = result('r-b', '2026-10-28', '50', { createdAt: new Date('2026-10-28T18:00:00Z') })
    const { em } = makeEm({ listed: [evening, morning], history: [morning, evening], trials: [] })
    const items = await createAthletesTestResultsService(em as never).listResults(scope, {})
    const byId = Object.fromEntries(items.map((item) => [item.id, item]))
    expect(byId['r-a']).toMatchObject({ noPreviousMeasurement: true })
    expect(byId['r-b']).toMatchObject({ noPreviousMeasurement: false, checkFlag: true })
  })

  it('filters a team through its sessions and returns nothing for a team without sessions', async () => {
    const { em, find } = makeEm({ listed: [first], history: [first], trials: [], sessions: [] })
    expect(await createAthletesTestResultsService(em as never).listResults(scope, { teamId: 't-1' })).toEqual([])
    expect(find).toHaveBeenCalledTimes(1)
  })
})
