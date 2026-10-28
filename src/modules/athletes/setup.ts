import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { ensureRoles } from '@open-mercato/core/modules/auth/lib/setup-app'
import { Role } from '@open-mercato/core/modules/auth/data/entities'

/**
 * A club is its own tenant (spec E06, Q4), so `auth` isolates club accounts natively.
 * Each club tenant gets three club roles; `defaultRoleFeatures` attaches their features
 * once the roles exist (setup re-syncs custom role ACLs after `onTenantCreated`, and
 * `yarn mercato auth sync-role-acls` does the same for existing tenants).
 *
 * Guards check features, never these role names. A club admin can grant only roles
 * whose features it holds itself, so `admin`/`superadmin` stay out of its reach.
 */
export const CLUB_ROLE_NAMES = ['club_admin', 'coach', 'director'] as const
export type ClubRoleName = typeof CLUB_ROLE_NAMES[number]

export async function ensureClubRoles(em: EntityManager, tenantId: string): Promise<void> {
  await ensureRoles(em, { roleNames: [...CLUB_ROLE_NAMES], tenantId })
  // The installed protected-role floor rejects deactivating or demoting the last
  // active holder, which is exactly "the last club admin cannot be deactivated" (REQ-003).
  await em.nativeUpdate(Role, { name: 'club_admin', tenantId, minActiveHolders: 0 }, { minActiveHolders: 1 })
}

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['athletes.*'],
    admin: ['athletes.*'],
    club_admin: [
      'athletes.club.manage',
      'athletes.players.view',
      'athletes.players.manage',
      'auth.users.list',
      'auth.users.create',
      'auth.users.edit',
    ],
    coach: ['athletes.players.view'],
    director: ['athletes.players.view'],
  },

  async onTenantCreated({ em, tenantId }) {
    await ensureClubRoles(em, tenantId)
  },

  async seedDefaults({ em, tenantId }) {
    await ensureClubRoles(em, tenantId)
  },
}

export default setup
