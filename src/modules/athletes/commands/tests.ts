import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { badRequest, conflict, isUniqueViolation, notFound } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  AthletesPlayer,
  AthletesTeam,
  AthletesTestDefinition,
  AthletesTestResult,
  AthletesTestSession,
  AthletesTestTrial,
  type TestReasonCode,
  type TestResultState,
  type TestSessionKind,
  type TestSessionStatus,
} from '../data/entities'
import {
  testResultRecordSchema,
  testSessionFinishSchema,
  testSessionStartSchema,
} from '../data/validators'
import { emitAthletesEvent } from '../events'
import { ensureClubScope, resolveUndoScope, type ClubScope } from '../lib/scope'
import { deriveResult, toNumberOrNull } from '../lib/testScoring'

/** Stable machine codes the UI maps to localized messages (`athletes.errors.*`). */
export const TEST_ERRORS = {
  definitionNotInClub: 'athletes.errors.testDefinitionNotInClub',
  definitionInactive: 'athletes.errors.testDefinitionInactive',
  teamNotInClub: 'athletes.errors.teamNotInClub',
  playerNotInClub: 'athletes.errors.playerNotInClub',
  playerNotInSession: 'athletes.errors.playerNotInSession',
  testedBeforeJoined: 'athletes.errors.testedBeforeJoined',
  sessionNotFound: 'athletes.errors.testSessionNotFound',
  sessionFinished: 'athletes.errors.testSessionFinished',
  sessionHasResults: 'athletes.errors.testSessionHasResults',
  sessionAlreadyOpen: 'athletes.errors.testSessionAlreadyOpen',
  attemptOutOfRange: 'athletes.errors.testAttemptOutOfRange',
  idempotencyKeyReused: 'athletes.errors.testIdempotencyKeyReused',
} as const

const ONE_OPEN_SESSION_INDEX = 'athletes_test_sessions_one_open_uq'
const RESULT_IDEMPOTENCY_INDEX = 'athletes_test_results_idempotency_uq'
const RESULT_SESSION_PLAYER_INDEX = 'athletes_test_results_session_player_uq'

function forkEm(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

function scoped<E>(scope: ClubScope, where: Record<string, unknown>): FilterQuery<E> {
  return { ...where, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null } as FilterQuery<E>
}

export function toIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value ?? '').slice(0, 10)
}

function toIso(value: Date | null | undefined): string | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null
}

function toDecimal(value: number | null): string | null {
  return value === null ? null : String(value)
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

export type TestSessionSnapshot = {
  id: string
  testDefinitionId: string
  kind: TestSessionKind
  teamId: string | null
  playerId: string | null
  testedOn: string
  status: TestSessionStatus
  finishedAt: string | null
  startedByUserId: string | null
  tenantId: string | null
  organizationId: string | null
  updatedAt: string | null
}

export function serializeSession(row: AthletesTestSession): TestSessionSnapshot {
  return {
    id: String(row.id),
    testDefinitionId: row.testDefinitionId,
    kind: row.kind,
    teamId: row.teamId ?? null,
    playerId: row.playerId ?? null,
    testedOn: toIsoDate(row.testedOn),
    status: row.status,
    finishedAt: toIso(row.finishedAt),
    startedByUserId: row.startedByUserId ?? null,
    tenantId: row.tenantId ?? null,
    organizationId: row.organizationId ?? null,
    updatedAt: toIso(row.updatedAt),
  }
}

type TrialSnapshot = { attemptNo: number; value: number | null; isInvalid: boolean }

type ResultSnapshot = {
  id: string
  sessionId: string
  playerId: string
  testDefinitionId: string
  testedOn: string
  value: number | null
  state: TestResultState
  reasonCode: TestReasonCode | null
  isMakeup: boolean
  countsInTeamAverage: boolean
  idempotencyKey: string
}

type RecordSnapshot = {
  sessionId: string
  playerId: string
  tenantId: string
  organizationId: string
  result: ResultSnapshot | null
  trials: TrialSnapshot[]
  replayed?: boolean
}

function serializeResult(row: AthletesTestResult): ResultSnapshot {
  return {
    id: String(row.id),
    sessionId: row.sessionId,
    playerId: row.playerId,
    testDefinitionId: row.testDefinitionId,
    testedOn: toIsoDate(row.testedOn),
    value: toNumberOrNull(row.value),
    state: row.state,
    reasonCode: row.reasonCode ?? null,
    isMakeup: !!row.isMakeup,
    countsInTeamAverage: !!row.countsInTeamAverage,
    idempotencyKey: row.idempotencyKey,
  }
}

function serializeTrial(row: AthletesTestTrial): TrialSnapshot {
  return { attemptNo: row.attemptNo, value: toNumberOrNull(row.value), isInvalid: !!row.isInvalid }
}

async function loadRecordSnapshot(
  em: EntityManager,
  scope: ClubScope,
  sessionId: string,
  playerId: string,
): Promise<RecordSnapshot> {
  const result = await em.findOne(AthletesTestResult, scoped<AthletesTestResult>(scope, { sessionId, playerId }))
  const trials = await em.find(
    AthletesTestTrial,
    scoped<AthletesTestTrial>(scope, { sessionId, playerId }),
    { orderBy: { attemptNo: 'asc' } },
  )
  return {
    sessionId,
    playerId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    result: result ? serializeResult(result) : null,
    trials: trials.map(serializeTrial),
  }
}

/**
 * Makes the live trials of one player in one session equal to `trials`: updates attempts in
 * place, adds missing ones and soft-deletes attempts that are no longer entered. Entries with
 * neither a value nor "Próba nieważna" carry no information and are not stored.
 */
async function replaceTrials(
  em: EntityManager,
  scope: ClubScope,
  sessionId: string,
  playerId: string,
  trials: ReadonlyArray<{ attemptNo: number; value?: number | null; isInvalid?: boolean }>,
  now: Date,
): Promise<void> {
  const live = await em.find(AthletesTestTrial, scoped<AthletesTestTrial>(scope, { sessionId, playerId }))
  const byAttempt = new Map(live.map((row) => [row.attemptNo, row]))
  const kept = new Set<number>()
  for (const trial of trials) {
    const isInvalid = !!trial.isInvalid
    const value = isInvalid ? null : toNumberOrNull(trial.value)
    if (!isInvalid && value === null) continue
    kept.add(trial.attemptNo)
    const existing = byAttempt.get(trial.attemptNo)
    if (existing) {
      existing.value = toDecimal(value)
      existing.isInvalid = isInvalid
      existing.updatedAt = now
      continue
    }
    em.persist(
      em.create(AthletesTestTrial, {
        sessionId,
        playerId,
        attemptNo: trial.attemptNo,
        value: toDecimal(value),
        isInvalid,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        createdAt: now,
        updatedAt: now,
      }),
    )
  }
  for (const row of live) {
    if (!kept.has(row.attemptNo)) {
      row.deletedAt = now
      row.updatedAt = now
    }
  }
}

// ---------------------------------------------------------------------------
// athletes.test_sessions.start
// ---------------------------------------------------------------------------

export type TestSessionStartResult = { session: AthletesTestSession; reused: boolean }

async function findOpenTeamSession(em: EntityManager, scope: ClubScope, teamId: string, testDefinitionId: string) {
  return em.findOne(AthletesTestSession, scoped<AthletesTestSession>(scope, { teamId, testDefinitionId, status: 'open' }))
}

/**
 * "Rozpocznij test" (REQ-002): a team or one player, and a date that is not in the future
 * (validator) and not before the player joined (D162/D307). An open session of the same team
 * and test is returned instead of creating a second one — also when two coaches race.
 */
const startTestSessionCommand: CommandHandler<Record<string, unknown>, TestSessionStartResult> = {
  id: 'athletes.test_sessions.start',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const input = testSessionStartSchema.parse(rawInput)
    const scope = ensureClubScope(ctx)
    const em = forkEm(ctx)

    const definition = await em.findOne(
      AthletesTestDefinition,
      scoped<AthletesTestDefinition>(scope, { id: input.testDefinitionId }),
    )
    if (!definition) throw badRequest(TEST_ERRORS.definitionNotInClub)
    if (!definition.isActive) throw badRequest(TEST_ERRORS.definitionInactive)

    let teamId: string | null = null
    let playerId: string | null = null
    if (input.kind === 'team') {
      const team = await em.findOne(AthletesTeam, scoped<AthletesTeam>(scope, { id: input.teamId }))
      if (!team) throw badRequest(TEST_ERRORS.teamNotInClub)
      teamId = team.id
      const open = await findOpenTeamSession(em, scope, team.id, definition.id)
      if (open) return { session: open, reused: true }
    } else {
      const player = await em.findOne(
        AthletesPlayer,
        scoped<AthletesPlayer>(scope, { id: input.playerId }),
        { fields: ['id', 'teamId', 'joinedAt', 'tenantId', 'organizationId'] },
      )
      if (!player) throw badRequest(TEST_ERRORS.playerNotInClub)
      if (input.testedOn < toIsoDate(player.joinedAt)) throw badRequest(TEST_ERRORS.testedBeforeJoined)
      playerId = player.id
    }

    const now = new Date()
    const session = em.create(AthletesTestSession, {
      testDefinitionId: definition.id,
      kind: input.kind,
      teamId,
      playerId,
      testedOn: input.testedOn,
      status: 'open',
      finishedAt: null,
      startedByUserId: ctx.auth?.sub ? String(ctx.auth.sub) : null,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      createdAt: now,
      updatedAt: now,
    })
    try {
      em.persist(session)
      await em.flush()
    } catch (err) {
      if (teamId && isUniqueViolation(err, ONE_OPEN_SESSION_INDEX)) {
        const open = await findOpenTeamSession(forkEm(ctx), scope, teamId, definition.id)
        if (open) return { session: open, reused: true }
        throw conflict(TEST_ERRORS.sessionAlreadyOpen)
      }
      throw err
    }

    // After the commit: ids and scope only.
    await emitAthletesEvent(
      'athletes.test_session.started',
      {
        id: session.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        testDefinitionId: definition.id,
        teamId,
        playerId,
      },
      { persistent: true },
    )
    return { session, reused: false }
  },
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('athletes.audit.testSessions.start', 'Start test'),
      resourceKind: 'athletes.test_session',
      resourceId: String(result.session.id),
      tenantId: result.session.tenantId,
      organizationId: result.session.organizationId,
      snapshotAfter: { ...serializeSession(result.session), reused: result.reused },
    }
  },
  async undo({ logEntry, ctx }) {
    const snapshot = logEntry.snapshotAfter as (TestSessionSnapshot & { reused?: boolean }) | undefined
    if (!snapshot?.id) throw new Error('[internal] Missing session snapshot for undo')
    // Reusing an open session created nothing, so there is nothing to undo.
    if (snapshot.reused) return
    const scope = resolveUndoScope(ctx, snapshot)
    const em = forkEm(ctx)
    const results = await em.count(AthletesTestResult, scoped<AthletesTestResult>(scope, { sessionId: snapshot.id }))
    if (results > 0) throw conflict(TEST_ERRORS.sessionHasResults)
    await em.nativeUpdate(
      AthletesTestSession,
      scoped<AthletesTestSession>(scope, { id: snapshot.id }),
      { deletedAt: new Date() },
    )
  },
}

// ---------------------------------------------------------------------------
// athletes.test_results.record
// ---------------------------------------------------------------------------

export type TestResultRecordResult = { result: AthletesTestResult; replayed: boolean }

/**
 * "Dalej" in "Tryb boisko" (REQ-003…REQ-005, REQ-010): one player's trials and result in ONE
 * transaction. The result is the best valid trial (R02) or a gap state (R12, value null).
 *
 * Idempotent: the same `idempotencyKey` returns the stored result without writing again
 * (a retried request after a lost response). A key already used for another session/player
 * — or for a result that was undone — is a 409, never a silent overwrite.
 */
const recordTestResultCommand: CommandHandler<Record<string, unknown>, TestResultRecordResult> = {
  id: 'athletes.test_results.record',
  isUndoable: true,
  async prepare(rawInput, ctx) {
    const input = testResultRecordSchema.parse(rawInput)
    const scope = ensureClubScope(ctx)
    return { before: await loadRecordSnapshot(forkEm(ctx), scope, input.sessionId, input.playerId) }
  },
  async execute(rawInput, ctx) {
    const input = testResultRecordSchema.parse(rawInput)
    const scope = ensureClubScope(ctx)
    const em = forkEm(ctx)

    const findByKey = (manager: EntityManager) => manager.findOne(AthletesTestResult, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      idempotencyKey: input.idempotencyKey,
    } as FilterQuery<AthletesTestResult>, { filters: false })
    const replay = (row: AthletesTestResult | null): TestResultRecordResult | null => {
      if (!row) return null
      if (!row.deletedAt && row.sessionId === input.sessionId && row.playerId === input.playerId) {
        return { result: row, replayed: true }
      }
      throw conflict(TEST_ERRORS.idempotencyKeyReused)
    }

    const replayed = replay(await findByKey(em))
    if (replayed) return replayed

    const session = await em.findOne(AthletesTestSession, scoped<AthletesTestSession>(scope, { id: input.sessionId }))
    if (!session) throw notFound(TEST_ERRORS.sessionNotFound)
    if (session.status !== 'open') throw conflict(TEST_ERRORS.sessionFinished)
    const definition = await em.findOne(
      AthletesTestDefinition,
      scoped<AthletesTestDefinition>(scope, { id: session.testDefinitionId }),
    )
    if (!definition) throw badRequest(TEST_ERRORS.definitionNotInClub)
    const player = await em.findOne(
      AthletesPlayer,
      scoped<AthletesPlayer>(scope, { id: input.playerId }),
      { fields: ['id', 'teamId', 'joinedAt', 'tenantId', 'organizationId'] },
    )
    if (!player) throw badRequest(TEST_ERRORS.playerNotInClub)
    const belongs = session.kind === 'team' ? player.teamId === session.teamId : player.id === session.playerId
    if (!belongs) throw badRequest(TEST_ERRORS.playerNotInSession)
    const testedOn = toIsoDate(session.testedOn)
    if (testedOn < toIsoDate(player.joinedAt) && input.state !== 'joined_later') {
      throw badRequest(TEST_ERRORS.testedBeforeJoined)
    }
    if (input.trials.some((trial) => trial.attemptNo > definition.attempts)) {
      throw badRequest(TEST_ERRORS.attemptOutOfRange)
    }

    const derived = deriveResult({
      direction: definition.direction,
      trials: input.trials,
      state: input.state,
      reasonCode: input.reasonCode ?? null,
    })
    const now = new Date()
    let saved: AthletesTestResult
    try {
      saved = await em.transactional(async (tem) => {
        const values = {
          testDefinitionId: definition.id,
          testedOn,
          value: toDecimal(derived.value),
          state: derived.state,
          reasonCode: derived.reasonCode,
          idempotencyKey: input.idempotencyKey,
        }
        const existing = await tem.findOne(
          AthletesTestResult,
          scoped<AthletesTestResult>(scope, { sessionId: session.id, playerId: player.id }),
        )
        let row: AthletesTestResult
        if (existing) {
          Object.assign(existing, values)
          existing.updatedAt = now
          row = existing
        } else {
          row = tem.create(AthletesTestResult, {
            ...values,
            sessionId: session.id,
            playerId: player.id,
            isMakeup: false,
            // D113: an individual test never counts in the team average.
            countsInTeamAverage: session.kind === 'team',
            correctedAt: null,
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            createdAt: now,
            updatedAt: now,
          })
          tem.persist(row)
        }
        await replaceTrials(tem, scope, session.id, player.id, input.trials, now)
        return row
      })
    } catch (err) {
      // A concurrent retry of the same "Dalej" won the race: answer with its result.
      if (isUniqueViolation(err, RESULT_IDEMPOTENCY_INDEX) || isUniqueViolation(err, RESULT_SESSION_PLAYER_INDEX)) {
        const raced = replay(await findByKey(forkEm(ctx)))
        if (raced) return raced
        throw conflict(TEST_ERRORS.idempotencyKeyReused)
      }
      throw err
    }

    await emitAthletesEvent(
      'athletes.test_result.recorded',
      {
        id: saved.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        sessionId: session.id,
        playerId: player.id,
        testDefinitionId: definition.id,
      },
      { persistent: true },
    )
    return { result: saved, replayed: false }
  },
  captureAfter: async (rawInput, result, ctx) => {
    const input = testResultRecordSchema.parse(rawInput)
    const snapshot = await loadRecordSnapshot(forkEm(ctx), ensureClubScope(ctx), input.sessionId, input.playerId)
    return { ...snapshot, replayed: result.replayed }
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('athletes.audit.testResults.record', 'Record test result'),
      resourceKind: 'athletes.test_result',
      resourceId: String(result.result.id),
      tenantId: result.result.tenantId,
      organizationId: result.result.organizationId,
      snapshotBefore: (snapshots.before as RecordSnapshot | undefined) ?? null,
      snapshotAfter: (snapshots.after as RecordSnapshot | undefined) ?? null,
    }
  },
  async undo({ logEntry, ctx }) {
    const before = (logEntry.snapshotBefore as RecordSnapshot | null | undefined) ?? null
    const after = (logEntry.snapshotAfter as RecordSnapshot | null | undefined) ?? null
    const ref = after ?? before
    if (!ref?.sessionId || !ref.playerId) throw new Error('[internal] Missing result snapshot for undo')
    // A replayed request wrote nothing.
    if (after?.replayed) return
    const scope = resolveUndoScope(ctx, ref)
    const em = forkEm(ctx)
    const now = new Date()
    await em.transactional(async (tem) => {
      const current = await tem.findOne(
        AthletesTestResult,
        scoped<AthletesTestResult>(scope, { sessionId: ref.sessionId, playerId: ref.playerId }),
      )
      if (!before?.result) {
        if (current) {
          current.deletedAt = now
          current.updatedAt = now
        }
        await replaceTrials(tem, scope, ref.sessionId, ref.playerId, [], now)
        return
      }
      if (!current) throw conflict(TEST_ERRORS.sessionNotFound)
      current.value = toDecimal(before.result.value)
      current.state = before.result.state
      current.reasonCode = before.result.reasonCode
      current.idempotencyKey = before.result.idempotencyKey
      current.updatedAt = now
      await replaceTrials(tem, scope, ref.sessionId, ref.playerId, before.trials, now)
    })
  },
}

// ---------------------------------------------------------------------------
// athletes.test_sessions.finish
// ---------------------------------------------------------------------------

export type TestSessionSummary = {
  recorded: number
  notPerformed: number
  empty: number
  invalidAttempt: number
  joinedLater: number
  playersTotal: number
}

/**
 * "Zakończ test" summary (REQ-006, D202). Players of the team who were already in the club
 * on the test date but have no result count as empty fields.
 */
export async function summarizeTestSession(
  em: EntityManager,
  scope: ClubScope,
  session: AthletesTestSession,
): Promise<TestSessionSummary> {
  const results = await em.find(
    AthletesTestResult,
    scoped<AthletesTestResult>(scope, { sessionId: session.id }),
    { fields: ['id', 'state', 'playerId'] },
  )
  const summary: TestSessionSummary = { recorded: 0, notPerformed: 0, empty: 0, invalidAttempt: 0, joinedLater: 0, playersTotal: 0 }
  for (const row of results) {
    if (row.state === 'recorded') summary.recorded += 1
    else if (row.state === 'not_performed') summary.notPerformed += 1
    else if (row.state === 'invalid_attempt') summary.invalidAttempt += 1
    else if (row.state === 'joined_later') summary.joinedLater += 1
    else summary.empty += 1
  }
  if (session.kind === 'team' && session.teamId) {
    summary.playersTotal = await em.count(AthletesPlayer, scoped<AthletesPlayer>(scope, {
      teamId: session.teamId,
      isActive: true,
      joinedAt: { $lte: toIsoDate(session.testedOn) },
    }))
  } else {
    summary.playersTotal = 1
  }
  summary.empty += Math.max(0, summary.playersTotal - results.length)
  return summary
}

export type TestSessionFinishResult = { session: AthletesTestSession; summary: TestSessionSummary; alreadyFinished: boolean }

const finishTestSessionCommand: CommandHandler<Record<string, unknown>, TestSessionFinishResult> = {
  id: 'athletes.test_sessions.finish',
  isUndoable: true,
  async prepare(rawInput, ctx) {
    const input = testSessionFinishSchema.parse(rawInput)
    const scope = ensureClubScope(ctx)
    const existing = await forkEm(ctx).findOne(AthletesTestSession, scoped<AthletesTestSession>(scope, { id: input.id }))
    if (!existing) throw notFound(TEST_ERRORS.sessionNotFound)
    enforceCommandOptimisticLock({
      resourceKind: 'athletes.test_session',
      resourceId: input.id,
      current: existing.updatedAt,
      expected: input.updatedAt ?? null,
      request: ctx.request ?? null,
    })
    return { before: serializeSession(existing) }
  },
  async execute(rawInput, ctx) {
    const input = testSessionFinishSchema.parse(rawInput)
    const scope = ensureClubScope(ctx)
    const em = forkEm(ctx)
    const session = await em.findOne(AthletesTestSession, scoped<AthletesTestSession>(scope, { id: input.id }))
    if (!session) throw notFound(TEST_ERRORS.sessionNotFound)
    if (session.status === 'finished') {
      return { session, summary: await summarizeTestSession(em, scope, session), alreadyFinished: true }
    }
    const now = new Date()
    session.status = 'finished'
    session.finishedAt = now
    session.updatedAt = now
    await em.flush()
    const summary = await summarizeTestSession(em, scope, session)
    await emitAthletesEvent(
      'athletes.test_session.finished',
      {
        id: session.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        testDefinitionId: session.testDefinitionId,
        teamId: session.teamId ?? null,
        playerId: session.playerId ?? null,
      },
      { persistent: true },
    )
    return { session, summary, alreadyFinished: false }
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('athletes.audit.testSessions.finish', 'Finish test'),
      resourceKind: 'athletes.test_session',
      resourceId: String(result.session.id),
      tenantId: result.session.tenantId,
      organizationId: result.session.organizationId,
      snapshotBefore: (snapshots.before as TestSessionSnapshot | undefined) ?? null,
      snapshotAfter: serializeSession(result.session),
    }
  },
  async undo({ logEntry, ctx }) {
    const before = logEntry.snapshotBefore as TestSessionSnapshot | undefined
    if (!before?.id) throw new Error('[internal] Missing session snapshot for undo')
    if (before.status !== 'open') return
    const scope = resolveUndoScope(ctx, before)
    try {
      await forkEm(ctx).nativeUpdate(
        AthletesTestSession,
        scoped<AthletesTestSession>(scope, { id: before.id }),
        { status: 'open', finishedAt: null, updatedAt: new Date() },
      )
    } catch (err) {
      // Another session of the same team and test was started since.
      if (isUniqueViolation(err, ONE_OPEN_SESSION_INDEX)) throw conflict(TEST_ERRORS.sessionAlreadyOpen)
      throw err
    }
  },
}

registerCommand(startTestSessionCommand)
registerCommand(recordTestResultCommand)
registerCommand(finishTestSessionCommand)

export const testCommands = { startTestSessionCommand, recordTestResultCommand, finishTestSessionCommand }
