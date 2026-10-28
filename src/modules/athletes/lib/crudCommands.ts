import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import {
  buildChanges,
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
  requireId,
} from '@open-mercato/shared/lib/commands/helpers'
import type { CrudEmitContext, CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { conflict, isUniqueViolation, notFound } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLock, enforceRecordGoneIsConflict } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { EntityData, EntityManager, EntityName, FilterQuery } from '@mikro-orm/postgresql'
import type { ZodType } from 'zod'
import { ensureClubScope, resolveUndoScope, type ClubScope } from './scope'

type ScopedRow = {
  id: string
  tenantId: string
  organizationId: string
  updatedAt: Date
  deletedAt?: Date | null
}

export type ScopedSnapshot = { id: string; tenantId: string | null; organizationId: string | null }

/**
 * Everything one app-owned entity needs for undoable create/update/delete commands.
 * Snapshots keep plaintext on purpose: undo restores what the user typed, and
 * `audit_logs` encrypts its snapshot columns at rest through its own encryption map.
 */
export type ScopedCrudDefinition<E extends ScopedRow, S extends ScopedSnapshot, C, U extends { id: string }> = {
  entityClass: EntityName<E>
  /** Short entity name: drives command ids (`athletes.<plural>.*`) and events (`athletes.<entity>.*`). */
  entity: string
  plural: string
  entityId: string
  createSchema: ZodType<C>
  updateSchema: ZodType<U>
  serialize: (row: E) => S
  /** Field values for a new row; validates references in the same club. */
  buildCreateData: (input: C, scope: ClubScope, ctx: CommandRuntimeContext) => Promise<EntityData<E>>
  /** Validates and applies a partial update to the loaded row. */
  applyUpdate: (row: E, input: U, scope: ClubScope, ctx: CommandRuntimeContext) => Promise<void>
  /** Writes snapshot values back onto a row (undo of update/delete). */
  restore: (row: E, snapshot: S) => void
  /** Rejects deleting a row that is still referenced (409). */
  assertDeletable?: (row: E, scope: ClubScope, ctx: CommandRuntimeContext) => Promise<void>
  /** Rejects restoring a snapshot whose references no longer exist in the club (undo). */
  validateRestore?: (snapshot: S, scope: ClubScope, ctx: CommandRuntimeContext) => Promise<void>
  /** Unique index name → domain error code; a DB uniqueness race maps to 409, not 500. */
  uniqueConstraints?: Record<string, string>
  changeKeys: string[]
  labels: { create: [string, string]; update: [string, string]; delete: [string, string] }
}

function scopedWhere<E>(id: string, scope: ClubScope, includeDeleted = false): FilterQuery<E> {
  return {
    id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    ...(includeDeleted ? {} : { deletedAt: null }),
  } as unknown as FilterQuery<E>
}

export function registerScopedCrudCommands<E extends ScopedRow, S extends ScopedSnapshot, C, U extends { id: string }>(
  def: ScopedCrudDefinition<E, S, C, U>,
) {
  const resourceKind = `athletes.${def.entity}`

  function toConflict(err: unknown): unknown {
    for (const [constraint, code] of Object.entries(def.uniqueConstraints ?? {})) {
      if (isUniqueViolation(err, constraint)) return conflict(code)
    }
    return err
  }

  const events: CrudEventsConfig<E> = {
    module: 'athletes',
    entity: def.entity,
    persistent: true,
    buildPayload: (ctx: CrudEmitContext<E>) => ({
      id: ctx.identifiers.id,
      tenantId: ctx.identifiers.tenantId,
      organizationId: ctx.identifiers.organizationId,
      ...(ctx.syncOrigin ? { syncOrigin: ctx.syncOrigin } : {}),
    }),
  }

  const indexer: CrudIndexerConfig<E> = {
    entityType: def.entityId,
    buildUpsertPayload: (ctx: CrudEmitContext<E>) => ({
      entityType: def.entityId,
      recordId: ctx.identifiers.id,
      tenantId: ctx.identifiers.tenantId,
      organizationId: ctx.identifiers.organizationId,
    }),
    buildDeletePayload: (ctx: CrudEmitContext<E>) => ({
      entityType: def.entityId,
      recordId: ctx.identifiers.id,
      tenantId: ctx.identifiers.tenantId,
      organizationId: ctx.identifiers.organizationId,
    }),
  }

  async function loadDecrypted(ctx: CommandRuntimeContext, id: string, scope: ClubScope, includeDeleted = false) {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return findOneWithDecryption(em, def.entityClass, scopedWhere<E>(id, scope, includeDeleted), undefined, scope)
  }

  async function emit(ctx: CommandRuntimeContext, action: 'created' | 'updated' | 'deleted', row: E, scope: ClubScope, undo = false) {
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    const args = {
      dataEngine,
      action,
      entity: row,
      identifiers: { id: String(row.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events,
      indexer,
    }
    if (undo) await emitCrudUndoSideEffects(args)
    else await emitCrudSideEffects(args)
  }

  const createCommand: CommandHandler<Record<string, unknown>, E> = {
    id: `athletes.${def.plural}.create`,
    isUndoable: true,
    async execute(rawInput, ctx) {
      const input = def.createSchema.parse(rawInput)
      const scope = ensureClubScope(ctx)
      const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
      const data = await def.buildCreateData(input, scope, ctx)
      const row = await dataEngine.createOrmEntity({
        entity: def.entityClass,
        data: { ...data, tenantId: scope.tenantId, organizationId: scope.organizationId } as EntityData<E>,
      }).catch((err) => {
        throw toConflict(err)
      })
      await emit(ctx, 'created', row, scope)
      return row
    },
    captureAfter: async (_input, result, ctx) => {
      const reloaded = await loadDecrypted(ctx, String(result.id), ensureClubScope(ctx))
      return reloaded ? def.serialize(reloaded) : null
    },
    buildLog: async ({ result, snapshots }) => {
      const { translate } = await resolveTranslations()
      return {
        actionLabel: translate(...def.labels.create),
        resourceKind,
        resourceId: String(result.id),
        tenantId: result.tenantId,
        organizationId: result.organizationId,
        snapshotAfter: (snapshots.after as S | undefined) ?? null,
      }
    },
    async undo({ logEntry, ctx }) {
      const snapshot = logEntry.snapshotAfter as S | undefined
      const id = snapshot?.id ?? logEntry.resourceId
      if (!id) throw new Error('[internal] Missing record id for undo')
      const scope = resolveUndoScope(ctx, snapshot)
      if (def.assertDeletable) {
        const em = ctx.container.resolve('em') as EntityManager
        const existing = await em.findOne(def.entityClass, scopedWhere<E>(String(id), scope))
        if (existing) await def.assertDeletable(existing, scope, ctx)
      }
      const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
      const removed = await dataEngine.deleteOrmEntity({
        entity: def.entityClass,
        where: scopedWhere<E>(String(id), scope),
        soft: true,
        softDeleteField: 'deletedAt' as keyof E & string,
      })
      if (removed) await emit(ctx, 'deleted', removed, scope, true)
    },
  }

  const updateCommand: CommandHandler<Record<string, unknown>, E> = {
    id: `athletes.${def.plural}.update`,
    isUndoable: true,
    async prepare(rawInput, ctx) {
      const input = def.updateSchema.parse(rawInput)
      const scope = ensureClubScope(ctx)
      const existing = await loadDecrypted(ctx, input.id, scope)
      if (!existing) throw notFound('Record not found')
      // `prepare` is awaited before `execute`, so a stale version aborts the write.
      enforceCommandOptimisticLock({
        resourceKind,
        resourceId: input.id,
        current: existing.updatedAt,
        request: ctx.request ?? null,
      })
      return { before: def.serialize(existing) }
    },
    async execute(rawInput, ctx) {
      const input = def.updateSchema.parse(rawInput)
      const scope = ensureClubScope(ctx)
      const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
      let applyError: unknown = null
      const row = await dataEngine.updateOrmEntity({
        entity: def.entityClass,
        where: scopedWhere<E>(input.id, scope),
        apply: async (current) => {
          try {
            await def.applyUpdate(current, input, scope, ctx)
          } catch (err) {
            applyError = err
            throw err
          }
        },
      }).catch((err) => {
        throw applyError ?? toConflict(err)
      })
      if (!row) throw notFound('Record not found')
      await emit(ctx, 'updated', row, scope)
      return row
    },
    captureAfter: async (_input, result, ctx) => {
      const reloaded = await loadDecrypted(ctx, String(result.id), ensureClubScope(ctx))
      return reloaded ? def.serialize(reloaded) : null
    },
    buildLog: async ({ result, snapshots }) => {
      const { translate } = await resolveTranslations()
      const before = (snapshots.before as S | undefined) ?? null
      const after = (snapshots.after as S | undefined) ?? null
      return {
        actionLabel: translate(...def.labels.update),
        resourceKind,
        resourceId: String(result.id),
        tenantId: result.tenantId,
        organizationId: result.organizationId,
        changes: buildChanges(
          before as unknown as Record<string, unknown> | null,
          (after ?? {}) as unknown as Record<string, unknown>,
          def.changeKeys,
        ),
        snapshotBefore: before,
        snapshotAfter: after,
      }
    },
    async undo({ logEntry, ctx }) {
      const before = logEntry.snapshotBefore as S | undefined
      if (!before?.id) throw new Error('[internal] Missing previous snapshot for undo')
      const scope = resolveUndoScope(ctx, before)
      if (def.validateRestore) await def.validateRestore(before, scope, ctx)
      const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
      const restored = await dataEngine.updateOrmEntity({
        entity: def.entityClass,
        where: scopedWhere<E>(before.id, scope),
        apply: (row) => def.restore(row, before),
      }).catch((err) => {
        throw toConflict(err)
      })
      if (restored) await emit(ctx, 'updated', restored, scope, true)
    },
  }

  const deleteCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, E> = {
    id: `athletes.${def.plural}.delete`,
    isUndoable: true,
    async prepare(input, ctx) {
      const id = requireId(input, 'Record id required')
      const scope = ensureClubScope(ctx)
      const existing = await loadDecrypted(ctx, id, scope)
      if (!existing) return {}
      enforceCommandOptimisticLock({
        resourceKind,
        resourceId: id,
        current: existing.updatedAt,
        request: ctx.request ?? null,
      })
      return { before: def.serialize(existing) }
    },
    async execute(input, ctx) {
      const id = requireId(input, 'Record id required')
      const scope = ensureClubScope(ctx)
      const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
      const em = ctx.container.resolve('em') as EntityManager
      const existing = await em.findOne(def.entityClass, scopedWhere<E>(id, scope))
      if (!existing) {
        // Deleted meanwhile by someone else: a client holding a version gets the conflict bar.
        enforceRecordGoneIsConflict({ resourceKind, resourceId: id, request: ctx.request ?? null })
        throw notFound('Record not found')
      }
      if (def.assertDeletable) await def.assertDeletable(existing, scope, ctx)
      const row = await dataEngine.deleteOrmEntity({
        entity: def.entityClass,
        where: scopedWhere<E>(id, scope),
        soft: true,
        softDeleteField: 'deletedAt' as keyof E & string,
      })
      if (!row) throw notFound('Record not found')
      await emit(ctx, 'deleted', row, scope)
      return row
    },
    buildLog: async ({ snapshots, input }) => {
      const { translate } = await resolveTranslations()
      const before = snapshots.before as S | undefined
      return {
        actionLabel: translate(...def.labels.delete),
        resourceKind,
        resourceId: requireId(input, 'Record id required'),
        tenantId: before?.tenantId ?? null,
        organizationId: before?.organizationId ?? null,
        snapshotBefore: before ?? null,
      }
    },
    async undo({ logEntry, ctx }) {
      const before = logEntry.snapshotBefore as S | undefined
      if (!before?.id) throw new Error('[internal] Missing snapshot for undo')
      const scope = resolveUndoScope(ctx, before)
      if (def.validateRestore) await def.validateRestore(before, scope, ctx)
      const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
      const restored = await dataEngine.updateOrmEntity({
        entity: def.entityClass,
        where: scopedWhere<E>(before.id, scope, true),
        apply: (row) => {
          row.deletedAt = null
          def.restore(row, before)
        },
      }).catch((err) => {
        throw toConflict(err)
      })
      if (restored) await emit(ctx, 'updated', restored, scope, true)
    },
  }

  registerCommand(createCommand)
  registerCommand(updateCommand)
  registerCommand(deleteCommand)

  return { events, indexer, createCommand, updateCommand, deleteCommand }
}
