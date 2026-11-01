import { randomUUID } from 'node:crypto'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { badRequest, conflict, isUniqueViolation, notFound } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { AthletesDailyImport, AthletesTeam, AthletesTrainingSession, type DailyImportKind } from '../data/entities'
import { dailyImportCommitSchema, dailyImportUndoSchema } from '../data/validators'
import { emitAthletesEvent } from '../events'
import { DAILY_IMPORT_ERRORS, sessionKey } from '../lib/dailyImport'
import { prepareRpeImport } from '../lib/dailyImportService'
import { ensureClubScope, resolveUndoScope, type ClubScope } from '../lib/scope'

/** Stable machine codes the UI maps to localized messages. */
export const DAILY_IMPORT_COMMAND_ERRORS = {
  importNotFound: 'athletes.dailyImport.errors.importNotFound',
  alreadyUndone: 'athletes.dailyImport.errors.alreadyUndone',
  notLatestImport: 'athletes.dailyImport.errors.notLatestImport',
  changedSinceImport: 'athletes.dailyImport.errors.changedSinceImport',
  concurrentImport: 'athletes.dailyImport.errors.concurrentImport',
} as const

const SESSION_KEY_INDEX = 'athletes_training_sessions_key_uq'

function forkEm(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

function scoped<E>(scope: ClubScope, where: Record<string, unknown>): FilterQuery<E> {
  return { ...where, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null } as FilterQuery<E>
}

function toIso(value: Date | null | undefined): string | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null
}

function toIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value ?? '').slice(0, 10)
}

/** The row as it was before an import changed it — restored verbatim by undo. */
type SessionBefore = {
  kind: string | null
  minutes: number | null
  rpe: number | null
  previousMinutes: number | null
  previousRpe: number | null
  correctedAt: string | null
  importId: string
  /**
   * The row's `updated_at` before the import. Undo restores it with the values, so the import
   * that wrote that version can be undone next (its freshness check compares `updated_at`).
   * Absent in restore lists written before this field existed.
   */
  updatedAt?: string | null
}

/**
 * Per-row restore list stored on the import (ids and numbers only, no names): `insert` rows are
 * soft-deleted by undo, `update` rows get `before` back. `writtenAt` is the row's `updated_at`
 * right after the import — a row changed since makes the undo stale (409).
 */
export type DailyImportUndoEntry =
  | { id: string; op: 'insert'; writtenAt: string | null }
  | { id: string; op: 'update'; writtenAt: string | null; before: SessionBefore }

export type DailyImportCommittedPayload = {
  importId: string
  kind: DailyImportKind
  teamId: string
  periodFrom: string
  periodTo: string
  saved: number
  corrected: number
  unchanged: number
  rejected: number
}

export type DailyImportCommitResult = { record: AthletesDailyImport }

type ImportSnapshot = {
  importId: string
  kind: DailyImportKind
  teamId: string
  tenantId: string
  organizationId: string
}

export function buildCommittedPayload(record: AthletesDailyImport): DailyImportCommittedPayload {
  // Frozen contract (REQ-013): ids, period and counters only — no names, no values.
  return {
    importId: String(record.id),
    kind: record.kind,
    teamId: record.teamId,
    periodFrom: toIsoDate(record.periodFrom),
    periodTo: toIsoDate(record.periodTo),
    saved: record.saved,
    corrected: record.corrected,
    unchanged: record.unchanged,
    rejected: record.rejected,
  }
}

// ---------------------------------------------------------------------------
// athletes.daily_import.commit
// ---------------------------------------------------------------------------

/**
 * "Zapisz" in the RPE import (REQ-002, REQ-003, REQ-014). ONE transaction: the team row is
 * locked (one import or undo per team at a time), the plan is rebuilt from the file against the
 * stored sessions, then every new row is inserted, every changed row updated with
 * `previous_*`/`corrected_at`, identical rows left alone, and the import record written with its
 * counters and restore list. The same file again is all "bez zmian". The event follows the
 * commit. Invalid assignments are a 400 before anything is written.
 */
const commitDailyImportCommand: CommandHandler<Record<string, unknown>, DailyImportCommitResult> = {
  id: 'athletes.daily_import.commit',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const input = dailyImportCommitSchema.parse(rawInput)
    const scope = ensureClubScope(ctx)
    const userId = ctx.auth?.sub ? String(ctx.auth.sub) : null
    const em = forkEm(ctx)
    const now = new Date()

    let record: AthletesDailyImport
    try {
      record = await em.transactional(async (tem) => {
        const { team, plan, sessionRows } = await prepareRpeImport(tem, scope, {
          table: input.table,
          teamId: input.teamId ?? null,
          assignments: input.assignments,
          lock: true,
        })
        if (!plan.period || plan.rows.length === 0) throw badRequest(DAILY_IMPORT_ERRORS.noValidRows)

        const importId = randomUUID()
        const byKey = new Map(sessionRows.map((row) => [sessionKey(row.playerId, toIsoDate(row.sessionDate), row.sessionNo), row]))
        const written: Array<{ row: AthletesTrainingSession; op: 'insert' } | { row: AthletesTrainingSession; op: 'update'; before: SessionBefore }> = []

        for (const planned of plan.rows) {
          if (planned.status === 'unchanged') continue
          if (planned.status === 'new') {
            const row = tem.create(AthletesTrainingSession, {
              playerId: planned.playerId,
              sessionDate: planned.sessionDate,
              sessionNo: planned.sessionNo,
              kind: planned.kind,
              minutes: planned.minutes,
              rpe: planned.rpe,
              previousMinutes: null,
              previousRpe: null,
              correctedAt: null,
              importId,
              tenantId: scope.tenantId,
              organizationId: scope.organizationId,
              createdAt: now,
              updatedAt: now,
            })
            tem.persist(row)
            written.push({ row, op: 'insert' })
            continue
          }
          const row = byKey.get(sessionKey(planned.playerId, planned.sessionDate, planned.sessionNo))
          if (!row) throw conflict(DAILY_IMPORT_COMMAND_ERRORS.concurrentImport)
          const before: SessionBefore = {
            kind: row.kind ?? null,
            minutes: row.minutes ?? null,
            rpe: row.rpe ?? null,
            previousMinutes: row.previousMinutes ?? null,
            previousRpe: row.previousRpe ?? null,
            correctedAt: toIso(row.correctedAt),
            importId: row.importId,
            updatedAt: toIso(row.updatedAt),
          }
          row.previousMinutes = row.minutes ?? null
          row.previousRpe = row.rpe ?? null
          row.kind = planned.kind
          row.minutes = planned.minutes
          row.rpe = planned.rpe
          row.correctedAt = now
          row.importId = importId
          row.updatedAt = now
          written.push({ row, op: 'update', before })
        }

        const created = tem.create(AthletesDailyImport, {
          id: importId,
          kind: input.kind,
          teamId: String(team.id),
          fileName: input.fileName,
          fileHash: input.fileHash,
          periodFrom: plan.period.from,
          periodTo: plan.period.to,
          saved: plan.counts.saved,
          corrected: plan.counts.corrected,
          unchanged: plan.counts.unchanged,
          rejected: plan.counts.rejected,
          assignedNames: plan.counts.assignedNames,
          // `{ line, reason }` only — never names or values.
          rejectedRows: plan.rejected.map(({ line, reason }) => ({ line, reason })),
          undoState: null,
          importedByUserId: userId,
          undoneAt: null,
          undoneByUserId: null,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          createdAt: now,
          updatedAt: now,
        })
        tem.persist(created)
        await tem.flush()

        // The versions as stored, read back from the flushed entities (no query in between).
        const undoState: DailyImportUndoEntry[] = written.map((entry) =>
          entry.op === 'insert'
            ? { id: String(entry.row.id), op: 'insert', writtenAt: toIso(entry.row.updatedAt) }
            : { id: String(entry.row.id), op: 'update', writtenAt: toIso(entry.row.updatedAt), before: entry.before },
        )
        created.undoState = undoState
        await tem.flush()
        return created
      })
    } catch (err) {
      // Another import of the same rows committed first (the team lock makes this rare).
      if (isUniqueViolation(err, SESSION_KEY_INDEX)) throw conflict(DAILY_IMPORT_COMMAND_ERRORS.concurrentImport)
      throw err
    }

    // After the commit: the frozen payload; scope travels in the trusted emit options.
    await emitAthletesEvent('athletes.daily_import.committed', buildCommittedPayload(record), {
      persistent: true,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    return { record }
  },
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    const snapshot: ImportSnapshot = {
      importId: String(result.record.id),
      kind: result.record.kind,
      teamId: result.record.teamId,
      tenantId: result.record.tenantId,
      organizationId: result.record.organizationId,
    }
    return {
      actionLabel: translate('athletes.audit.dailyImports.commit', 'Import daily data'),
      resourceKind: 'athletes.daily_import',
      resourceId: String(result.record.id),
      tenantId: result.record.tenantId,
      organizationId: result.record.organizationId,
      snapshotAfter: { ...snapshot, ...buildCommittedPayload(result.record) },
      // The raw input carries the file's rows and names, and the file name is free text the coach
      // chose (it may hold a player's name): keep them all out of `action_logs`.
      redoInput: { kind: result.record.kind, teamId: result.record.teamId, importId: String(result.record.id) },
    }
  },
  async undo({ logEntry, ctx }) {
    const snapshot = logEntry.snapshotAfter as ImportSnapshot | null | undefined
    if (!snapshot?.importId) throw new Error('[internal] Missing import snapshot for undo')
    const scope = resolveUndoScope(ctx, snapshot)
    const record = await undoDailyImport(forkEm(ctx), scope, snapshot.importId, ctx.auth?.sub ? String(ctx.auth.sub) : null)
    await emitUndone(record, scope)
  },
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

export type DailyImportUndoResult = { record: AthletesDailyImport }

/**
 * Cofnięcie importu (REQ-014): only the latest not-undone import of the same kind and team may
 * be undone (409 otherwise), and only while every row it wrote is exactly as it left it (409
 * when anything changed since). Inserted rows are soft-deleted, corrected rows get their
 * previous values back, and the import is marked undone — all in one transaction under the
 * team lock.
 */
export async function undoDailyImport(
  em: EntityManager,
  scope: ClubScope,
  importId: string,
  userId: string | null,
): Promise<AthletesDailyImport> {
  const now = new Date()
  return em.transactional(async (tem) => {
    const target = await tem.findOne(AthletesDailyImport, scoped<AthletesDailyImport>(scope, { id: importId }))
    if (!target) throw notFound(DAILY_IMPORT_COMMAND_ERRORS.importNotFound)
    // Serialize with commits and other undos of this team.
    await tem.findOne(AthletesTeam, { id: target.teamId, tenantId: scope.tenantId, organizationId: scope.organizationId } as FilterQuery<AthletesTeam>, {
      lockMode: LockMode.PESSIMISTIC_WRITE,
    })
    const locked = await tem.findOne(AthletesDailyImport, scoped<AthletesDailyImport>(scope, { id: importId }), { refresh: true })
    if (!locked) throw notFound(DAILY_IMPORT_COMMAND_ERRORS.importNotFound)
    if (locked.undoneAt) throw conflict(DAILY_IMPORT_COMMAND_ERRORS.alreadyUndone)

    const latest = await tem.findOne(
      AthletesDailyImport,
      scoped<AthletesDailyImport>(scope, { kind: locked.kind, teamId: locked.teamId, undoneAt: null }),
      { orderBy: { createdAt: 'desc', id: 'desc' } },
    )
    if (!latest || String(latest.id) !== String(locked.id)) throw conflict(DAILY_IMPORT_COMMAND_ERRORS.notLatestImport)

    const entries = Array.isArray(locked.undoState) ? (locked.undoState as DailyImportUndoEntry[]) : []
    const ids = entries.map((entry) => entry.id)
    const rows = ids.length
      ? await tem.find(
          AthletesTrainingSession,
          { id: { $in: ids }, tenantId: scope.tenantId, organizationId: scope.organizationId } as FilterQuery<AthletesTrainingSession>,
          { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
        )
      : []
    const byId = new Map(rows.map((row) => [String(row.id), row]))
    if (!isUndoFresh(entries, byId, String(locked.id))) throw conflict(DAILY_IMPORT_COMMAND_ERRORS.changedSinceImport)

    const restoredVersions: Array<{ id: string; updatedAt: Date }> = []
    for (const entry of entries) {
      const row = byId.get(entry.id) as AthletesTrainingSession
      if (entry.op === 'insert') {
        row.deletedAt = now
        row.updatedAt = now
        continue
      }
      row.kind = entry.before.kind
      row.minutes = entry.before.minutes
      row.rpe = entry.before.rpe
      row.previousMinutes = entry.before.previousMinutes
      row.previousRpe = entry.before.previousRpe
      row.correctedAt = entry.before.correctedAt ? new Date(entry.before.correctedAt) : null
      row.importId = entry.before.importId
      row.updatedAt = now
      if (entry.before.updatedAt) restoredVersions.push({ id: entry.id, updatedAt: new Date(entry.before.updatedAt) })
    }
    locked.undoneAt = now
    locked.undoneByUserId = userId
    locked.updatedAt = now
    await tem.flush()
    // Back to the version the earlier import left, so that import stays undoable. `updated_at`
    // has an `onUpdate` hook that a flush would apply, hence the native update after it.
    for (const restored of restoredVersions) {
      await tem.nativeUpdate(
        AthletesTrainingSession,
        { id: restored.id, tenantId: scope.tenantId, organizationId: scope.organizationId } as FilterQuery<AthletesTrainingSession>,
        { updatedAt: restored.updatedAt },
      )
    }
    return locked
  })
}

/** After the undo commits: ids only; scope travels in the trusted emit options. */
async function emitUndone(record: AthletesDailyImport, scope: ClubScope): Promise<void> {
  await emitAthletesEvent(
    'athletes.daily_import.undone',
    { importId: String(record.id), kind: record.kind, teamId: record.teamId },
    { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
}

/**
 * Every row the import wrote is still live, still owned by this import and at the version the
 * import left (`updated_at`). Anything else means data changed since: the undo would overwrite it.
 */
export function isUndoFresh(
  entries: DailyImportUndoEntry[],
  rowsById: Map<string, Pick<AthletesTrainingSession, 'importId' | 'updatedAt' | 'deletedAt'>>,
  importId: string,
): boolean {
  return entries.every((entry) => {
    const row = rowsById.get(entry.id)
    if (!row || row.deletedAt) return false
    if (row.importId !== importId) return false
    return entry.writtenAt == null || toIso(row.updatedAt) === entry.writtenAt
  })
}

/**
 * `POST /api/athletes/daily-imports/undo` — the same undo as the commit's audit-log undo, by
 * import id. Logged, not itself undoable (a new import is the way forward).
 */
const undoDailyImportCommand: CommandHandler<Record<string, unknown>, DailyImportUndoResult> = {
  id: 'athletes.daily_import.undo',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = dailyImportUndoSchema.parse(rawInput)
    const scope = ensureClubScope(ctx)
    const record = await undoDailyImport(forkEm(ctx), scope, input.importId, ctx.auth?.sub ? String(ctx.auth.sub) : null)
    await emitUndone(record, scope)
    return { record }
  },
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('athletes.audit.dailyImports.undo', 'Undo daily data import'),
      resourceKind: 'athletes.daily_import',
      resourceId: String(result.record.id),
      tenantId: result.record.tenantId,
      organizationId: result.record.organizationId,
      snapshotAfter: { importId: String(result.record.id), kind: result.record.kind, teamId: result.record.teamId, undone: true },
    }
  },
}

registerCommand(commitDailyImportCommand)
registerCommand(undoDailyImportCommand)

export const dailyImportCommands = { commitDailyImportCommand, undoDailyImportCommand }
