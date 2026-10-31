import { describe, expect, it, jest } from '@jest/globals'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import {
  AthletesPlayer,
  AthletesTeam,
  AthletesTestDefinition,
  AthletesTestResult,
  AthletesTestSession,
  AthletesTestTrial,
} from '../../data/entities'
import { testResultRecordSchema, testSessionStartSchema } from '../../data/validators'
import { TEST_ERRORS, testCommands } from '../tests'

jest.mock('../../events', () => ({ emitAthletesEvent: jest.fn(async () => undefined) }))

const TENANT = '11111111-1111-4111-8111-111111111111'
const CLUB_A = '22222222-2222-4222-8222-222222222222'
const TEAM = '44444444-4444-4444-8444-444444444444'
const PLAYER = '55555555-5555-4555-8555-555555555555'
const OTHER_PLAYER = '77777777-7777-4777-8777-777777777777'
const ACTOR = '66666666-6666-4666-8666-666666666666'
const DEFINITION = '88888888-8888-4888-8888-888888888888'
const SESSION = '99999999-9999-4999-8999-999999999999'
const KEY = 'field-key-0001'

type AnyFn = (...args: unknown[]) => unknown
type Rows = Map<unknown, unknown>

function makeCtx(rows: Rows, extra: Record<string, unknown> = {}) {
  const created: Array<{ entity: unknown; data: Record<string, unknown> }> = []
  const em: Record<string, jest.Mock<AnyFn>> & { fork?: () => unknown } = {
    findOne: jest.fn<AnyFn>(async (entity: unknown) => rows.get(entity) ?? null),
    find: jest.fn<AnyFn>(async (entity: unknown) => (rows.get(`list:${String((entity as { name: string }).name)}`) as unknown[]) ?? []),
    count: jest.fn<AnyFn>(async () => 0),
    create: jest.fn<AnyFn>((entity: unknown, data: unknown) => {
      created.push({ entity, data: data as Record<string, unknown> })
      return { id: 'new-id', ...(data as Record<string, unknown>) }
    }),
    persist: jest.fn<AnyFn>(),
    flush: jest.fn<AnyFn>(async () => undefined),
    nativeUpdate: jest.fn<AnyFn>(async () => 1),
    transactional: jest.fn<AnyFn>(async (fn: unknown) => (fn as (tem: unknown) => Promise<unknown>)(em)),
    ...extra,
  }
  em.fork = () => em
  const ctx = {
    container: { resolve: (name: string) => (name === 'em' ? em : undefined) },
    auth: { sub: ACTOR, tenantId: TENANT, orgId: CLUB_A },
    organizationScope: null,
    selectedOrganizationId: CLUB_A,
    organizationIds: [CLUB_A],
  } as unknown as CommandRuntimeContext
  return { ctx, em, created }
}

const activeDefinition = {
  id: DEFINITION, isActive: true, direction: 'higher_better', attempts: 3, tenantId: TENANT, organizationId: CLUB_A,
}
const openSession = {
  id: SESSION, kind: 'team', teamId: TEAM, playerId: null, testDefinitionId: DEFINITION,
  testedOn: '2026-10-28', status: 'open', tenantId: TENANT, organizationId: CLUB_A,
}
const player = { id: PLAYER, teamId: TEAM, joinedAt: '2025-09-01' }

function yesterday(): string {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
}

describe('athletes.test_sessions.start', () => {
  it('rejects a future test date (D307)', () => {
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)
    const parsed = testSessionStartSchema.safeParse({ testDefinitionId: DEFINITION, teamId: TEAM, testedOn: tomorrow })
    expect(parsed.success).toBe(false)
    expect(JSON.stringify(parsed.error?.issues)).toContain('athletes.validation.testedOnFuture')
  })

  it('rejects an individual test dated before the player joined (D162)', async () => {
    const rows: Rows = new Map<unknown, unknown>([
      [AthletesTestDefinition, activeDefinition],
      [AthletesPlayer, { ...player, joinedAt: '2026-10-20' }],
    ])
    const { ctx } = makeCtx(rows)
    await expect(testCommands.startTestSessionCommand.execute(
      { testDefinitionId: DEFINITION, kind: 'individual', playerId: PLAYER, testedOn: '2026-10-01' },
      ctx,
    )).rejects.toMatchObject({ status: 400, body: { error: TEST_ERRORS.testedBeforeJoined } })
  })

  it('rejects an inactive test', async () => {
    const { ctx } = makeCtx(new Map<unknown, unknown>([[AthletesTestDefinition, { ...activeDefinition, isActive: false }]]))
    await expect(testCommands.startTestSessionCommand.execute(
      { testDefinitionId: DEFINITION, teamId: TEAM, testedOn: yesterday() },
      ctx,
    )).rejects.toMatchObject({ status: 400, body: { error: TEST_ERRORS.definitionInactive } })
  })

  it('returns the open session of the same team and test instead of creating a second one', async () => {
    const rows: Rows = new Map<unknown, unknown>([
      [AthletesTestDefinition, activeDefinition],
      [AthletesTeam, { id: TEAM }],
      [AthletesTestSession, openSession],
    ])
    const { ctx, em } = makeCtx(rows)
    const result = await testCommands.startTestSessionCommand.execute(
      { testDefinitionId: DEFINITION, teamId: TEAM, testedOn: yesterday() },
      ctx,
    )
    expect(result).toMatchObject({ reused: true, session: { id: SESSION } })
    expect(em.persist).not.toHaveBeenCalled()
    const sessionQuery = em.findOne.mock.calls.find((call) => call[0] === AthletesTestSession)?.[1]
    expect(sessionQuery).toMatchObject({ tenantId: TENANT, organizationId: CLUB_A, teamId: TEAM, status: 'open', deletedAt: null })
  })

  it('creates an open session with the trusted scope and starting user', async () => {
    const rows: Rows = new Map<unknown, unknown>([
      [AthletesTestDefinition, activeDefinition],
      [AthletesTeam, { id: TEAM }],
    ])
    const { ctx, created } = makeCtx(rows)
    const result = await testCommands.startTestSessionCommand.execute(
      { testDefinitionId: DEFINITION, teamId: TEAM, testedOn: yesterday(), tenantId: 'evil', organizationId: 'evil' },
      ctx,
    )
    expect(result.reused).toBe(false)
    expect(created[0].data).toMatchObject({
      tenantId: TENANT, organizationId: CLUB_A, teamId: TEAM, status: 'open', startedByUserId: ACTOR, kind: 'team',
    })
  })
})

describe('athletes.test_results.record', () => {
  const base = { sessionId: SESSION, playerId: PLAYER, idempotencyKey: KEY }

  function recordRows(extra: Array<[unknown, unknown]> = []): Rows {
    return new Map<unknown, unknown>([
      [AthletesTestSession, openSession],
      [AthletesTestDefinition, activeDefinition],
      [AthletesPlayer, player],
      ...extra,
    ])
  }

  it('stores the best valid trial as the result in one transaction (R02)', async () => {
    const rows = recordRows()
    // No existing result by key or by (session, player).
    const { ctx, em, created } = makeCtx(rows, {
      findOne: jest.fn<AnyFn>(async (entity: unknown) => (entity === AthletesTestResult ? null : rows.get(entity) ?? null)),
    })
    const out = await testCommands.recordTestResultCommand.execute({
      ...base,
      trials: [{ attemptNo: 1, value: 41.5 }, { attemptNo: 2, value: 43 }, { attemptNo: 3, isInvalid: true }],
    }, ctx)
    expect(out.replayed).toBe(false)
    expect(em.transactional).toHaveBeenCalledTimes(1)
    const result = created.find((entry) => entry.entity === AthletesTestResult)?.data
    expect(result).toMatchObject({ value: '43', state: 'recorded', reasonCode: null, tenantId: TENANT, organizationId: CLUB_A, countsInTeamAverage: true })
    const trials = created.filter((entry) => entry.entity === AthletesTestTrial).map((entry) => entry.data)
    expect(trials.map((trial) => [trial.attemptNo, trial.value, trial.isInvalid])).toEqual([[1, '41.5', false], [2, '43', false], [3, null, true]])
  })

  it('stores "Nie wykonał" as a state with a reason and a null value, never 0 (R12)', async () => {
    const rows = recordRows()
    const { ctx, created } = makeCtx(rows, {
      findOne: jest.fn<AnyFn>(async (entity: unknown) => (entity === AthletesTestResult ? null : rows.get(entity) ?? null)),
    })
    await testCommands.recordTestResultCommand.execute({ ...base, state: 'not_performed', reasonCode: 'absent' }, ctx)
    const result = created.find((entry) => entry.entity === AthletesTestResult)?.data
    expect(result).toMatchObject({ value: null, state: 'not_performed', reasonCode: 'absent' })
  })

  it('returns the original result for a repeated idempotency key without writing again', async () => {
    const stored = { id: 'r-1', sessionId: SESSION, playerId: PLAYER, idempotencyKey: KEY, deletedAt: null }
    const { ctx, em } = makeCtx(recordRows([[AthletesTestResult, stored]]))
    const out = await testCommands.recordTestResultCommand.execute({ ...base, trials: [{ attemptNo: 1, value: 40 }] }, ctx)
    expect(out).toMatchObject({ replayed: true, result: { id: 'r-1' } })
    expect(em.transactional).not.toHaveBeenCalled()
    expect(em.create).not.toHaveBeenCalled()
  })

  it('rejects a key already used for another player (409)', async () => {
    const stored = { id: 'r-1', sessionId: SESSION, playerId: OTHER_PLAYER, idempotencyKey: KEY, deletedAt: null }
    const { ctx } = makeCtx(recordRows([[AthletesTestResult, stored]]))
    await expect(testCommands.recordTestResultCommand.execute({ ...base, trials: [] }, ctx))
      .rejects.toMatchObject({ status: 409, body: { error: TEST_ERRORS.idempotencyKeyReused } })
  })

  it('rejects a test dated before the player joined (D162)', async () => {
    const rows = recordRows([[AthletesPlayer, { ...player, joinedAt: '2026-10-29' }]])
    const { ctx } = makeCtx(rows, {
      findOne: jest.fn<AnyFn>(async (entity: unknown) => (entity === AthletesTestResult ? null : rows.get(entity) ?? null)),
    })
    await expect(testCommands.recordTestResultCommand.execute({ ...base, trials: [{ attemptNo: 1, value: 40 }] }, ctx))
      .rejects.toMatchObject({ status: 400, body: { error: TEST_ERRORS.testedBeforeJoined } })
  })

  it('rejects a finished session (409)', async () => {
    const rows = recordRows([[AthletesTestSession, { ...openSession, status: 'finished' }]])
    const { ctx } = makeCtx(rows, {
      findOne: jest.fn<AnyFn>(async (entity: unknown) => (entity === AthletesTestResult ? null : rows.get(entity) ?? null)),
    })
    await expect(testCommands.recordTestResultCommand.execute({ ...base, trials: [] }, ctx))
      .rejects.toMatchObject({ status: 409, body: { error: TEST_ERRORS.sessionFinished } })
  })

  it('validates gap states: "Nie wykonał" needs a reason, reasons only with it, no value 0', () => {
    expect(testResultRecordSchema.safeParse({ ...base, state: 'not_performed' }).success).toBe(false)
    expect(testResultRecordSchema.safeParse({ ...base, reasonCode: 'absent' }).success).toBe(false)
    expect(testResultRecordSchema.safeParse({ ...base, trials: [{ attemptNo: 1, value: 0 }] }).success).toBe(false)
    expect(testResultRecordSchema.safeParse({ ...base, state: 'empty', trials: [{ attemptNo: 1, value: 3 }] }).success).toBe(false)
    expect(testResultRecordSchema.safeParse({ ...base, trials: [{ attemptNo: 1, isInvalid: true, value: 3 }] }).success).toBe(false)
  })
})

describe('athletes.test_sessions.finish', () => {
  it('finishes an open session and summarizes results, "Nie wykonał" and empty fields', async () => {
    const session = { ...openSession }
    const rows: Rows = new Map<unknown, unknown>([
      [AthletesTestSession, session],
      ['list:AthletesTestResult', [{ state: 'recorded' }, { state: 'recorded' }, { state: 'not_performed' }, { state: 'empty' }]],
    ])
    const { ctx, em } = makeCtx(rows, { count: jest.fn<AnyFn>(async () => 6) })
    const out = await testCommands.finishTestSessionCommand.execute({ id: SESSION }, ctx)
    expect(session.status).toBe('finished')
    expect(em.flush).toHaveBeenCalled()
    expect(out.summary).toEqual({ recorded: 2, notPerformed: 1, empty: 3, invalidAttempt: 0, joinedLater: 0, playersTotal: 6 })
  })
})
