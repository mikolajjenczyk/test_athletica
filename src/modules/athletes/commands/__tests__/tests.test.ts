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
import { testResultRecordSchema, testSessionFinishSchema, testSessionStartSchema } from '../../data/validators'
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

  it('rejects an inactive player (400)', async () => {
    const rows = recordRows([[AthletesPlayer, { ...player, isActive: false }]])
    const { ctx, em } = makeCtx(rows, {
      findOne: jest.fn<AnyFn>(async (entity: unknown) => (entity === AthletesTestResult ? null : rows.get(entity) ?? null)),
    })
    await expect(testCommands.recordTestResultCommand.execute({ ...base, trials: [{ attemptNo: 1, value: 40 }] }, ctx))
      .rejects.toMatchObject({ status: 400, body: { error: TEST_ERRORS.playerInactive } })
    expect(em.transactional).not.toHaveBeenCalled()
  })

  it('rejects a finished session (409)', async () => {
    const rows = recordRows([[AthletesTestSession, { ...openSession, status: 'finished' }]])
    const { ctx } = makeCtx(rows, {
      findOne: jest.fn<AnyFn>(async (entity: unknown) => (entity === AthletesTestResult ? null : rows.get(entity) ?? null)),
    })
    await expect(testCommands.recordTestResultCommand.execute({ ...base, trials: [] }, ctx))
      .rejects.toMatchObject({ status: 409, body: { error: TEST_ERRORS.sessionFinished } })
  })

  describe('correcting an existing result', () => {
    const savedAt = '2026-10-28T10:00:00.000Z'
    function existingResult() {
      return {
        id: 'r-1', sessionId: SESSION, playerId: PLAYER, idempotencyKey: KEY, value: '40', state: 'recorded',
        reasonCode: null, correctedAt: null as Date | null, updatedAt: new Date(savedAt), deletedAt: null,
      }
    }
    /** `findByKey` (filters off) finds nothing for the new key; the (session, player) read finds `existing`. */
    function correctionCtx(existing: ReturnType<typeof existingResult>, trials: unknown[] = [{ attemptNo: 1, value: '40', isInvalid: false, deletedAt: null }]) {
      const rows = recordRows([['list:AthletesTestTrial', trials]])
      return makeCtx(rows, {
        findOne: jest.fn<AnyFn>(async (entity: unknown, _where: unknown, options?: unknown) => {
          if (entity !== AthletesTestResult) return rows.get(entity) ?? null
          return (options as { filters?: boolean } | undefined)?.filters === false ? null : existing
        }),
      })
    }
    const correction = { ...base, idempotencyKey: 'field-key-0002', trials: [{ attemptNo: 1, value: 44 }] }

    it('requires the version of the existing result (409 testResultAlreadyRecorded)', async () => {
      const existing = existingResult()
      const { ctx } = correctionCtx(existing)
      await expect(testCommands.recordTestResultCommand.execute(correction, ctx))
        .rejects.toMatchObject({ status: 409, body: { error: TEST_ERRORS.resultAlreadyRecorded } })
      expect(existing.value).toBe('40')
    })

    it('rejects a stale version with the optimistic-lock conflict (409)', async () => {
      const existing = existingResult()
      const { ctx } = correctionCtx(existing)
      await expect(testCommands.recordTestResultCommand.execute(
        { ...correction, expectedUpdatedAt: '2026-10-28T09:00:00.000Z' },
        ctx,
      )).rejects.toMatchObject({ status: 409, body: { code: 'optimistic_lock_conflict' } })
      expect(existing.value).toBe('40')
    })

    it('corrects with the current version, sets correctedAt and keeps the first idempotency key', async () => {
      const existing = existingResult()
      const { ctx } = correctionCtx(existing)
      const out = await testCommands.recordTestResultCommand.execute({ ...correction, expectedUpdatedAt: savedAt }, ctx)
      expect(out.replayed).toBe(false)
      expect(existing.value).toBe('44')
      expect(existing.correctedAt).toBeInstanceOf(Date)
      expect(existing.idempotencyKey).toBe(KEY)
    })

    it('answers saving the stored trials again as a replay without writing', async () => {
      const existing = existingResult()
      const { ctx, em } = correctionCtx(existing)
      const out = await testCommands.recordTestResultCommand.execute(
        { ...correction, trials: [{ attemptNo: 1, value: 40 }] },
        ctx,
      )
      expect(out).toMatchObject({ replayed: true, result: { id: 'r-1' } })
      expect(existing.correctedAt).toBeNull()
      expect(em.create).not.toHaveBeenCalled()
    })

    it('maps a concurrent first save of the same player to testResultAlreadyRecorded (409)', async () => {
      const rows = recordRows()
      const { ctx } = makeCtx(rows, {
        findOne: jest.fn<AnyFn>(async (entity: unknown) => (entity === AthletesTestResult ? null : rows.get(entity) ?? null)),
        transactional: jest.fn<AnyFn>(async () => {
          throw Object.assign(new Error('duplicate key value violates unique constraint "athletes_test_results_session_player_uq"'), { code: '23505' })
        }),
      })
      await expect(testCommands.recordTestResultCommand.execute(correction, ctx))
        .rejects.toMatchObject({ status: 409, body: { error: TEST_ERRORS.resultAlreadyRecorded } })
    })
  })

  it('validates gap states: "Nie wykonał" needs a reason, reasons only with it, no value 0', () => {
    expect(testResultRecordSchema.safeParse({ ...base, state: 'not_performed' }).success).toBe(false)
    expect(testResultRecordSchema.safeParse({ ...base, reasonCode: 'absent' }).success).toBe(false)
    expect(testResultRecordSchema.safeParse({ ...base, trials: [{ attemptNo: 1, value: 0 }] }).success).toBe(false)
    expect(testResultRecordSchema.safeParse({ ...base, state: 'empty', trials: [{ attemptNo: 1, value: 3 }] }).success).toBe(false)
    expect(testResultRecordSchema.safeParse({ ...base, trials: [{ attemptNo: 1, isInvalid: true, value: 3 }] }).success).toBe(false)
  })
})

describe('athletes.test_results.record undo', () => {
  const recordedAt = '2026-10-28T10:00:00.000Z'
  const trialsAfter = [{ attemptNo: 1, value: 43, isInvalid: false }]
  const afterResult = {
    id: 'r-1', sessionId: SESSION, playerId: PLAYER, testDefinitionId: DEFINITION, testedOn: '2026-10-28',
    value: 43, state: 'recorded', reasonCode: null, isMakeup: false, countsInTeamAverage: true,
    idempotencyKey: KEY, correctedAt: null, updatedAt: recordedAt,
  }
  const scopeFields = { sessionId: SESSION, playerId: PLAYER, tenantId: TENANT, organizationId: CLUB_A }
  const logEntry = {
    snapshotBefore: { ...scopeFields, result: null, trials: [] },
    snapshotAfter: { ...scopeFields, result: afterResult, trials: trialsAfter },
  }
  const liveTrial = { attemptNo: 1, value: '43', isInvalid: false, deletedAt: null as Date | null }

  function undoRows(result: Record<string, unknown> | null, session: Record<string, unknown> = openSession): Rows {
    return new Map<unknown, unknown>([
      [AthletesTestSession, session],
      [AthletesTestResult, result],
      ['list:AthletesTestTrial', [liveTrial]],
    ])
  }

  it('soft-deletes the result and its trials while it is still what this record wrote', async () => {
    const current = { id: 'r-1', idempotencyKey: KEY, updatedAt: new Date(recordedAt), deletedAt: null as Date | null }
    const trial = { ...liveTrial }
    const rows = undoRows(current)
    rows.set('list:AthletesTestTrial', [trial])
    const { ctx } = makeCtx(rows)
    await testCommands.recordTestResultCommand.undo!({ logEntry, ctx } as never)
    expect(current.deletedAt).toBeInstanceOf(Date)
    expect(trial.deletedAt).toBeInstanceOf(Date)
  })

  it('refuses to undo after a later correction (409) and leaves the data intact', async () => {
    const current = { id: 'r-1', idempotencyKey: KEY, updatedAt: new Date('2026-10-28T10:05:00.000Z'), deletedAt: null as Date | null }
    const trial = { ...liveTrial, value: '44' }
    const rows = undoRows(current)
    rows.set('list:AthletesTestTrial', [trial])
    const { ctx } = makeCtx(rows)
    await expect(testCommands.recordTestResultCommand.undo!({ logEntry, ctx } as never))
      .rejects.toMatchObject({ status: 409, body: { error: TEST_ERRORS.resultChangedSinceRecord } })
    expect(current.deletedAt).toBeNull()
    expect(trial.deletedAt).toBeNull()
  })

  it('refuses to undo when only the trials changed since the record (409)', async () => {
    const current = { id: 'r-1', idempotencyKey: KEY, updatedAt: new Date(recordedAt), deletedAt: null as Date | null }
    const rows = undoRows(current)
    rows.set('list:AthletesTestTrial', [{ ...liveTrial, value: '41' }])
    const { ctx } = makeCtx(rows)
    await expect(testCommands.recordTestResultCommand.undo!({ logEntry, ctx } as never))
      .rejects.toMatchObject({ status: 409, body: { error: TEST_ERRORS.resultChangedSinceRecord } })
    expect(current.deletedAt).toBeNull()
  })

  it('refuses to undo in a finished session (409)', async () => {
    const current = { id: 'r-1', idempotencyKey: KEY, updatedAt: new Date(recordedAt), deletedAt: null as Date | null }
    const { ctx } = makeCtx(undoRows(current, { ...openSession, status: 'finished' }))
    await expect(testCommands.recordTestResultCommand.undo!({ logEntry, ctx } as never))
      .rejects.toMatchObject({ status: 409, body: { error: TEST_ERRORS.sessionFinished } })
    expect(current.deletedAt).toBeNull()
  })

  it('answers a missing result with a result-specific code', async () => {
    const { ctx } = makeCtx(undoRows(null))
    await expect(testCommands.recordTestResultCommand.undo!({ logEntry, ctx } as never))
      .rejects.toMatchObject({ status: 409, body: { error: TEST_ERRORS.resultNotFound } })
  })
})

describe('athletes.test_sessions.finish', () => {
  const at = '2026-10-28T09:00:00.000Z'
  const roster = ['p-1', 'p-2', 'p-3', 'p-4', 'p-5', 'p-6'].map((id) => ({ id }))

  it('finishes an open session and summarizes results, "Nie wykonał" and empty fields', async () => {
    const session = { ...openSession }
    const rows: Rows = new Map<unknown, unknown>([
      [AthletesTestSession, session],
      ['list:AthletesTestResult', [
        { playerId: 'p-1', state: 'recorded' }, { playerId: 'p-2', state: 'recorded' },
        { playerId: 'p-3', state: 'not_performed' }, { playerId: 'p-4', state: 'empty' },
      ]],
      ['list:AthletesPlayer', roster],
    ])
    const { ctx, em } = makeCtx(rows)
    const out = await testCommands.finishTestSessionCommand.execute({ id: SESSION, updatedAt: at }, ctx)
    expect(session.status).toBe('finished')
    expect(em.flush).toHaveBeenCalled()
    expect(out.summary).toEqual({ recorded: 2, notPerformed: 1, empty: 3, invalidAttempt: 0, joinedLater: 0, playersTotal: 6 })
    const rosterQuery = em.find.mock.calls.find((call) => call[0] === AthletesPlayer)?.[1]
    expect(rosterQuery).toMatchObject({ teamId: TEAM, isActive: true, joinedAt: { $lte: '2026-10-28' }, tenantId: TENANT, organizationId: CLUB_A })
  })

  it('counts empty fields only for roster players: outside results and "joined later" never offset them', async () => {
    const rows: Rows = new Map<unknown, unknown>([
      [AthletesTestSession, { ...openSession, status: 'finished' }],
      ['list:AthletesTestResult', [
        { playerId: 'p-1', state: 'recorded' },
        { playerId: 'moved-away', state: 'recorded' },
        { playerId: 'newcomer', state: 'joined_later' },
      ]],
      ['list:AthletesPlayer', roster.slice(0, 3)],
    ])
    const { ctx } = makeCtx(rows)
    const out = await testCommands.finishTestSessionCommand.execute({ id: SESSION, updatedAt: at }, ctx)
    expect(out.summary).toEqual({ recorded: 2, notPerformed: 0, empty: 2, invalidAttempt: 0, joinedLater: 1, playersTotal: 3 })
  })

  it('requires the session version: the contract is { id, updatedAt }', () => {
    expect(testSessionFinishSchema.safeParse({ id: SESSION }).success).toBe(false)
    expect(testSessionFinishSchema.safeParse({ id: SESSION, updatedAt: '' }).success).toBe(false)
    expect(testSessionFinishSchema.safeParse({ id: SESSION, updatedAt: at }).success).toBe(true)
  })

  it('rejects finishing a session that changed since it was loaded (409)', async () => {
    const rows: Rows = new Map<unknown, unknown>([
      [AthletesTestSession, { ...openSession, updatedAt: new Date('2026-10-28T09:30:00.000Z') }],
    ])
    const { ctx } = makeCtx(rows)
    await expect(testCommands.finishTestSessionCommand.prepare!({ id: SESSION, updatedAt: at }, ctx))
      .rejects.toMatchObject({ status: 409, body: { code: 'optimistic_lock_conflict' } })
  })
})
