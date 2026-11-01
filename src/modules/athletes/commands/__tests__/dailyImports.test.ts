import { describe, expect, it, jest, beforeEach } from '@jest/globals'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { AthletesDailyImport, AthletesPlayer, AthletesTeam, AthletesTrainingSession } from '../../data/entities'
import { DAILY_IMPORT_ERRORS, DAILY_IMPORT_REASONS } from '../../lib/dailyImport'
import type { ParsedTable } from '../../lib/dailyFileParser'
import { DAILY_IMPORT_COMMAND_ERRORS, dailyImportCommands, isUndoFresh, undoDailyImport, type DailyImportUndoEntry } from '../dailyImports'

jest.mock('../../events', () => ({ emitAthletesEvent: jest.fn(async () => undefined) }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
  findOneWithDecryption: jest.fn(async () => null),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const CLUB = '22222222-2222-4222-8222-222222222222'
const TEAM = '44444444-4444-4444-8444-444444444444'
const ACTOR = '66666666-6666-4666-8666-666666666666'
const JAN = '55555555-5555-4555-8555-555555555551'
const ANNA = '55555555-5555-4555-8555-555555555552'
const IMPORT_A = '99999999-9999-4999-8999-99999999999a'
const IMPORT_B = '99999999-9999-4999-8999-99999999999b'
const HASH = 'a'.repeat(64)

type AnyFn = (...args: unknown[]) => unknown

const roster = [
  { id: JAN, firstName: 'Jan', lastName: 'Kowalski', joinedAt: '2025-09-01', isActive: true, teamId: TEAM },
  { id: ANNA, firstName: 'Anna', lastName: 'Nowak', joinedAt: '2025-09-01', isActive: true, teamId: TEAM },
]

function table(rows: Array<[string, string, number, number | null, number | null]>): ParsedTable {
  return {
    headers: ['Zawodnik', 'data', 'nr sesji', 'minuty', 'RPE', 'uwagi'],
    rows: rows.map((r, i) => ({
      line: i + 2,
      cells: { Zawodnik: r[0], data: r[1], 'nr sesji': r[2], minuty: r[3], RPE: r[4], uwagi: 'kontuzja kolana' },
    })),
  }
}

type SessionRow = Record<string, unknown> & { id: string }

function makeCtx(state: { sessions?: SessionRow[]; imports?: Array<Record<string, unknown>> } = {}) {
  const sessions = state.sessions ?? []
  const imports = state.imports ?? []
  const persisted: unknown[] = []
  let flushes = 0
  const em: Record<string, jest.Mock<AnyFn>> & { fork?: () => unknown } = {
    findOne: jest.fn<AnyFn>(async (entity: unknown, where: unknown, options?: unknown) => {
      const w = where as Record<string, unknown>
      if (entity === AthletesTeam) return { id: TEAM, tenantId: TENANT, organizationId: CLUB, isActive: true }
      if (entity === AthletesDailyImport) {
        if (w.id) return imports.find((row) => row.id === w.id) ?? null
        const live = imports.filter((row) => !row.undoneAt && row.kind === w.kind && row.teamId === w.teamId)
        const ordered = (options as { orderBy?: unknown })?.orderBy ? live.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) : live
        return ordered[0] ?? null
      }
      return null
    }),
    find: jest.fn<AnyFn>(async (entity: unknown, where: unknown) => {
      const w = where as Record<string, unknown>
      if (entity === AthletesTeam) return [{ id: TEAM }]
      if (entity === AthletesTrainingSession) {
        const ids = (w.id as { $in?: string[] } | undefined)?.$in
        return ids ? sessions.filter((row) => ids.includes(row.id)) : sessions.filter((row) => !row.deletedAt)
      }
      return []
    }),
    create: jest.fn<AnyFn>((_entity: unknown, data: unknown) => {
      const record = { id: `new-${persisted.length + 1}`, ...(data as Record<string, unknown>) }
      return record
    }),
    persist: jest.fn<AnyFn>((row: unknown) => {
      persisted.push(row)
    }),
    flush: jest.fn<AnyFn>(async () => {
      flushes += 1
    }),
    nativeUpdate: jest.fn<AnyFn>(async (entity: unknown, where: unknown, data: unknown) => {
      if (entity !== AthletesTrainingSession) return 0
      const row = sessions.find((candidate) => candidate.id === (where as { id: string }).id)
      if (row) Object.assign(row, data as Record<string, unknown>)
      return row ? 1 : 0
    }),
    transactional: jest.fn<AnyFn>(async (fn: unknown) => (fn as (tem: unknown) => Promise<unknown>)(em)),
  }
  em.fork = () => em
  const ctx = {
    container: { resolve: (name: string) => (name === 'em' ? em : undefined) },
    auth: { sub: ACTOR, tenantId: TENANT, orgId: CLUB },
    organizationScope: null,
    selectedOrganizationId: CLUB,
    organizationIds: [CLUB],
  } as unknown as CommandRuntimeContext
  return { ctx, em, persisted, flushes: () => flushes }
}

function events() {
  return (jest.requireMock('../../events') as { emitAthletesEvent: jest.Mock<AnyFn> }).emitAthletesEvent
}

beforeEach(() => {
  const find = jest.requireMock('@open-mercato/shared/lib/encryption/find') as { findWithDecryption: jest.Mock<AnyFn> }
  find.findWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => (entity === AthletesPlayer ? roster : []))
  events().mockClear()
})

const commit = dailyImportCommands.commitDailyImportCommand

describe('athletes.daily_import.commit', () => {
  it('inserts new rows, corrects changed ones with previous values, skips unchanged, and emits the frozen payload', async () => {
    const existing: SessionRow[] = [
      { id: 's-jan-1', playerId: JAN, sessionDate: '2026-10-20', sessionNo: 1, kind: null, minutes: 60, rpe: 7, previousMinutes: null, previousRpe: null, correctedAt: null, importId: IMPORT_A, updatedAt: new Date('2026-10-21T08:00:00Z') },
      { id: 's-jan-2', playerId: JAN, sessionDate: '2026-10-21', sessionNo: 1, kind: null, minutes: 60, rpe: 5, previousMinutes: null, previousRpe: null, correctedAt: null, importId: IMPORT_A, updatedAt: new Date('2026-10-21T08:00:00Z') },
    ]
    const { ctx, persisted } = makeCtx({ sessions: existing })
    const { record } = await commit.execute({
      kind: 'rpe',
      fileName: 'rpe_tydzien_43.csv',
      fileHash: HASH,
      table: table([
        ['Jan Kowalski', '20.10.2026', 1, 60, 7], // unchanged
        ['Jan Kowalski', '21.10.2026', 1, 60, 6], // corrected 5 -> 6
        ['Anna Nowak', '21.10.2026', 1, 60, null], // new, Brak RPE
        ['Anna Nowak', '21.10.2026', 1, 50, 4], // duplicate in file
      ]),
      assignments: {},
    }, ctx)

    const inserted = persisted.filter((row) => (row as Record<string, unknown>).playerId) as Array<Record<string, unknown>>
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ playerId: ANNA, sessionDate: '2026-10-21', sessionNo: 1, minutes: 60, rpe: null, tenantId: TENANT, organizationId: CLUB })
    expect(existing[1]).toMatchObject({ minutes: 60, rpe: 6, previousMinutes: 60, previousRpe: 5, importId: record.id })
    expect(existing[1].correctedAt).toBeInstanceOf(Date)
    expect(existing[0]).toMatchObject({ rpe: 7, importId: IMPORT_A })

    expect(record).toMatchObject({ saved: 1, corrected: 1, unchanged: 1, rejected: 1, teamId: TEAM, periodFrom: '2026-10-20', periodTo: '2026-10-21', importedByUserId: ACTOR })
    expect(record.rejectedRows).toEqual([{ line: 5, reason: DAILY_IMPORT_REASONS.duplicateRow }])
    // Free-text columns are never stored anywhere on the import.
    expect(JSON.stringify(record)).not.toContain('kontuzja')
    const undoState = record.undoState as DailyImportUndoEntry[]
    expect(undoState.map((entry) => [entry.id, entry.op])).toEqual([['s-jan-2', 'update'], ['new-1', 'insert']])
    expect((undoState[0] as Extract<DailyImportUndoEntry, { op: 'update' }>).before).toMatchObject({ minutes: 60, rpe: 5, importId: IMPORT_A })

    expect(events()).toHaveBeenCalledTimes(1)
    const [eventId, payload, options] = events().mock.calls[0] as [string, Record<string, unknown>, Record<string, unknown>]
    expect(eventId).toBe('athletes.daily_import.committed')
    expect(Object.keys(payload).sort()).toEqual(['corrected', 'importId', 'kind', 'periodFrom', 'periodTo', 'rejected', 'saved', 'teamId', 'unchanged'])
    expect(payload).toMatchObject({ importId: record.id, kind: 'rpe', teamId: TEAM, saved: 1, corrected: 1, unchanged: 1, rejected: 1 })
    expect(options).toMatchObject({ persistent: true, tenantId: TENANT, organizationId: CLUB })
  })

  it('re-importing the same file writes no session and reports everything unchanged', async () => {
    const existing: SessionRow[] = [
      { id: 's1', playerId: JAN, sessionDate: '2026-10-20', sessionNo: 1, kind: null, minutes: 60, rpe: 7, importId: IMPORT_A, updatedAt: new Date() },
    ]
    const { ctx, persisted } = makeCtx({ sessions: existing })
    const { record } = await commit.execute({ kind: 'rpe', fileName: 'a.csv', fileHash: HASH, table: table([['Jan Kowalski', '20.10.2026', 1, 60, 7]]) }, ctx)
    expect(record).toMatchObject({ saved: 0, corrected: 0, unchanged: 1, rejected: 0 })
    expect(persisted.filter((row) => (row as Record<string, unknown>).playerId)).toHaveLength(0)
    expect(record.undoState).toEqual([])
  })

  it.each([
    [{ 'Kowalsky J.': JAN }, DAILY_IMPORT_ERRORS.assignmentPlayerAlreadyMatched],
    [{ 'Kowalsky J.': '77777777-7777-4777-8777-777777777777' }, DAILY_IMPORT_ERRORS.assignmentPlayerNotInTeam],
  ])('rejects invalid assignments %j with 400 before writing anything', async (assignments, code) => {
    const { ctx, persisted } = makeCtx()
    const promise = commit.execute({
      kind: 'rpe', fileName: 'a.csv', fileHash: HASH,
      table: table([['Jan Kowalski', '20.10.2026', 1, 60, 7], ['Kowalsky J.', '20.10.2026', 1, 60, 6]]),
      assignments,
    }, ctx)
    await expect(promise).rejects.toMatchObject({ status: 400, body: expect.objectContaining({ error: code }) })
    expect(persisted).toHaveLength(0)
    expect(events()).not.toHaveBeenCalled()
  })

  it('assigns an unknown name to an unmatched player, and rejects unassigned names', async () => {
    const { ctx } = makeCtx()
    const { record } = await commit.execute({
      kind: 'rpe', fileName: 'a.csv', fileHash: HASH,
      table: table([['Kowalsky J.', '20.10.2026', 1, 60, 6], ['Nieznany Ktoś', '20.10.2026', 1, 60, 6]]),
      assignments: { 'Kowalsky J.': ANNA, 'Nieznany Ktoś': null },
    }, ctx)
    expect(record).toMatchObject({ saved: 1, rejected: 1, assignedNames: 1 })
    expect(record.rejectedRows).toEqual([{ line: 3, reason: DAILY_IMPORT_REASONS.nameNotAssigned }])
  })

  it('rejects a file with no valid row (400) and a file without required columns (400 with column ids)', async () => {
    const { ctx } = makeCtx()
    await expect(commit.execute({ kind: 'rpe', fileName: 'a.csv', fileHash: HASH, table: table([['Jan Kowalski', '20.10.2026', 1, 60, 12]]) }, ctx))
      .rejects.toMatchObject({ status: 400, body: { error: DAILY_IMPORT_ERRORS.noValidRows } })
    await expect(commit.execute({ kind: 'rpe', fileName: 'a.csv', fileHash: HASH, table: { headers: ['Zawodnik', 'Data'], rows: [] } }, ctx))
      .rejects.toMatchObject({ status: 400, body: { error: DAILY_IMPORT_ERRORS.missingColumns, columns: ['sessionNo', 'minutes', 'rpe'] } })
  })

  it('keeps file rows and names out of the audit log redo input', async () => {
    const { ctx } = makeCtx()
    const { record } = await commit.execute({ kind: 'rpe', fileName: 'a.csv', fileHash: HASH, table: table([['Jan Kowalski', '20.10.2026', 1, 60, 7]]) }, ctx)
    const log = await commit.buildLog!({ result: { record }, snapshots: {}, input: {}, ctx } as never)
    expect(JSON.stringify(log)).not.toContain('Kowalski')
    expect((log as { redoInput?: unknown }).redoInput).toEqual({ kind: 'rpe', teamId: TEAM, fileName: 'a.csv' })
  })
})

describe('daily import undo', () => {
  const written = new Date('2026-10-31T10:00:00.000Z')
  const baseImport = { id: IMPORT_B, kind: 'rpe', teamId: TEAM, tenantId: TENANT, organizationId: CLUB, createdAt: '2026-10-31T10:00:00.000Z', undoneAt: null }
  const undoState: DailyImportUndoEntry[] = [
    { id: 's-new', op: 'insert', writtenAt: written.toISOString() },
    { id: 's-fix', op: 'update', writtenAt: written.toISOString(), before: { kind: 'trening', minutes: 60, rpe: 5, previousMinutes: null, previousRpe: null, correctedAt: null, importId: IMPORT_A } },
  ]

  function sessions(): SessionRow[] {
    return [
      { id: 's-new', importId: IMPORT_B, updatedAt: new Date(written), deletedAt: null, minutes: 60, rpe: 7 },
      { id: 's-fix', importId: IMPORT_B, updatedAt: new Date(written), deletedAt: null, kind: 'trening', minutes: 60, rpe: 6, previousMinutes: 60, previousRpe: 5, correctedAt: written },
    ]
  }

  it('restores corrected rows, soft-deletes inserted ones and marks the import undone', async () => {
    const rows = sessions()
    const imp = { ...baseImport, undoState }
    const { em } = makeCtx({ sessions: rows, imports: [imp, { ...baseImport, id: IMPORT_A, createdAt: '2026-10-30T10:00:00.000Z' }] })
    const record = await undoDailyImport(em as never, { tenantId: TENANT, organizationId: CLUB }, IMPORT_B, ACTOR)
    expect(rows[0].deletedAt).toBeInstanceOf(Date)
    expect(rows[1]).toMatchObject({ kind: 'trening', minutes: 60, rpe: 5, previousMinutes: null, previousRpe: null, correctedAt: null, importId: IMPORT_A })
    // A restore list without the earlier version (written before it was kept) falls back to now.
    expect((rows[1].updatedAt as Date).getTime()).toBeGreaterThan(written.getTime())
    expect(record.undoneAt).toBeInstanceOf(Date)
    expect(record.undoneByUserId).toBe(ACTOR)
  })

  it('restores the version the earlier import wrote, so that import can be undone next', async () => {
    const earlierWrittenAt = '2026-10-30T10:00:00.000Z'
    const rows = sessions()
    const chained: DailyImportUndoEntry[] = [
      undoState[0],
      { ...(undoState[1] as Extract<DailyImportUndoEntry, { op: 'update' }>), before: { ...(undoState[1] as Extract<DailyImportUndoEntry, { op: 'update' }>).before, updatedAt: earlierWrittenAt } },
    ]
    const earlier = { ...baseImport, id: IMPORT_A, createdAt: earlierWrittenAt, undoState: [{ id: 's-fix', op: 'insert', writtenAt: earlierWrittenAt }] as DailyImportUndoEntry[] }
    const { em } = makeCtx({ sessions: rows, imports: [{ ...baseImport, undoState: chained }, earlier] })
    // Like the entity's `onUpdate` hook: every flush stamps changed rows with a new `updated_at`.
    em.flush.mockImplementation(async () => {
      for (const row of rows) row.updatedAt = new Date()
    })
    await undoDailyImport(em as never, { tenantId: TENANT, organizationId: CLUB }, IMPORT_B, ACTOR)
    expect((rows[1].updatedAt as Date).toISOString()).toBe(earlierWrittenAt)
    expect(isUndoFresh(earlier.undoState, new Map(rows.map((row) => [row.id, row as never])), IMPORT_A)).toBe(true)
    await undoDailyImport(em as never, { tenantId: TENANT, organizationId: CLUB }, IMPORT_A, ACTOR)
    expect(rows[1].deletedAt).toBeInstanceOf(Date)
  })

  it('refuses an import that is not the latest one (409)', async () => {
    const { em } = makeCtx({ sessions: sessions(), imports: [{ ...baseImport, undoState }, { ...baseImport, id: IMPORT_A, createdAt: '2026-11-01T10:00:00.000Z' }] })
    await expect(undoDailyImport(em as never, { tenantId: TENANT, organizationId: CLUB }, IMPORT_B, ACTOR))
      .rejects.toMatchObject({ status: 409, body: { error: DAILY_IMPORT_COMMAND_ERRORS.notLatestImport } })
  })

  it('refuses when a row changed since the import (409) and changes nothing', async () => {
    const rows = sessions()
    rows[1].updatedAt = new Date('2026-10-31T11:00:00.000Z')
    const { em } = makeCtx({ sessions: rows, imports: [{ ...baseImport, undoState }] })
    await expect(undoDailyImport(em as never, { tenantId: TENANT, organizationId: CLUB }, IMPORT_B, ACTOR))
      .rejects.toMatchObject({ status: 409, body: { error: DAILY_IMPORT_COMMAND_ERRORS.changedSinceImport } })
    expect(rows[0].deletedAt).toBeNull()
    expect(rows[1].rpe).toBe(6)
  })

  it('refuses an import that was already undone (409) and an unknown one (404)', async () => {
    const { em } = makeCtx({ imports: [{ ...baseImport, undoState, undoneAt: new Date() }] })
    await expect(undoDailyImport(em as never, { tenantId: TENANT, organizationId: CLUB }, IMPORT_B, ACTOR))
      .rejects.toMatchObject({ status: 409, body: { error: DAILY_IMPORT_COMMAND_ERRORS.alreadyUndone } })
    await expect(undoDailyImport(em as never, { tenantId: TENANT, organizationId: CLUB }, IMPORT_A, ACTOR))
      .rejects.toMatchObject({ status: 404 })
  })

  it('isUndoFresh requires every row live, owned by the import and at the written version', () => {
    const ok = new Map(sessions().map((row) => [row.id, row as never]))
    expect(isUndoFresh(undoState, ok, IMPORT_B)).toBe(true)
    const deleted = new Map(sessions().map((row) => [row.id, { ...row, deletedAt: row.id === 's-new' ? new Date() : null } as never]))
    expect(isUndoFresh(undoState, deleted, IMPORT_B)).toBe(false)
    const reowned = new Map(sessions().map((row) => [row.id, { ...row, importId: IMPORT_A } as never]))
    expect(isUndoFresh(undoState, reowned, IMPORT_B)).toBe(false)
    expect(isUndoFresh(undoState, new Map(), IMPORT_B)).toBe(false)
  })

  it('the undo command emits athletes.daily_import.undone after the undo', async () => {
    const { ctx } = makeCtx({ sessions: sessions(), imports: [{ ...baseImport, undoState }] })
    await dailyImportCommands.undoDailyImportCommand.execute({ importId: IMPORT_B }, ctx)
    expect(events()).toHaveBeenCalledWith(
      'athletes.daily_import.undone',
      { importId: IMPORT_B, kind: 'rpe', teamId: TEAM },
      expect.objectContaining({ tenantId: TENANT, organizationId: CLUB }),
    )
  })
})
