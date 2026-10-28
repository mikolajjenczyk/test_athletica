import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandBus, CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { badRequest, notFound } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { AthletesPlayer, AthletesPosition, AthletesTeam } from '../data/entities'
import { clubDeleteRequestSchema } from '../data/validators'
import { emitAthletesEvent } from '../events'
import { ensureClubScope } from '../lib/scope'

const logger = createLogger('athletes').child({ component: 'club-delete' })

export const CLUB_DELETE_ERRORS = {
  nameMismatch: 'athletes.errors.clubNameMismatch',
} as const

export type ClubSoftDeleteResult = {
  organizationId: string
  deletedRecords: number
  deactivatedAccounts: number
  skippedAccounts: number
}

/**
 * Coarse "delete club data" flow (R26, D352): soft-deletes every module record of the
 * club and deactivates every other account of that club (same organization) through the installed `auth` update
 * command (sessions are revoked there). Not undoable from the UI — the operator restores
 * `deleted_at` / `isConfirmed`; permanent purge is a separate operator task.
 * Idempotent: a repeated request finds nothing left to delete or deactivate.
 */
const clubSoftDeleteCommand: CommandHandler<Record<string, unknown>, ClubSoftDeleteResult> = {
  id: 'athletes.club.soft_delete',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = clubDeleteRequestSchema.parse(rawInput)
    const scope = ensureClubScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const organization = await findOneWithDecryption(
      em,
      Organization,
      { id: scope.organizationId, tenant: scope.tenantId } as FilterQuery<Organization>,
      undefined,
      scope,
    )
    if (!organization) throw notFound('Club not found')
    if (organization.name.trim() !== input.confirmationName.trim()) throw badRequest(CLUB_DELETE_ERRORS.nameMismatch)

    const now = new Date()
    const where = { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }
    let deletedRecords = 0
    await em.transactional(async (tem) => {
      deletedRecords += await tem.nativeUpdate(AthletesPlayer, where as FilterQuery<AthletesPlayer>, { deletedAt: now })
      deletedRecords += await tem.nativeUpdate(AthletesPosition, where as FilterQuery<AthletesPosition>, { deletedAt: now })
      deletedRecords += await tem.nativeUpdate(AthletesTeam, where as FilterQuery<AthletesTeam>, { deletedAt: now })
    })

    const actorId = ctx.auth?.sub ? String(ctx.auth.sub) : null
    // Only this club's accounts — never other organizations of the same tenant.
    const users = await em.find(User, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
      isConfirmed: true,
      ...(actorId ? { id: { $ne: actorId } } : {}),
    } as FilterQuery<User>)
    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    let deactivatedAccounts = 0
    let skippedAccounts = 0
    for (const user of users) {
      try {
        await commandBus.execute('auth.users.update', { input: { id: user.id, isConfirmed: false }, ctx })
        deactivatedAccounts += 1
      } catch (err) {
        // e.g. an operator (superadmin) account the club admin may not modify.
        skippedAccounts += 1
        logger.warn('Club account was not deactivated', { err, userId: user.id, tenantId: scope.tenantId })
      }
    }

    await emitAthletesEvent(
      'athletes.club.soft_deleted',
      { id: scope.organizationId, tenantId: scope.tenantId, organizationId: scope.organizationId },
      { persistent: true },
    )

    return { organizationId: scope.organizationId, deletedRecords, deactivatedAccounts, skippedAccounts }
  },
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('athletes.audit.club.softDelete', 'Delete club data'),
      resourceKind: 'athletes.club',
      resourceId: result.organizationId,
      organizationId: result.organizationId,
      snapshotAfter: result,
    }
  },
}

registerCommand(clubSoftDeleteCommand)
