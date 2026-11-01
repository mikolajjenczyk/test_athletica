import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { ensureRoles } from '@open-mercato/core/modules/auth/lib/setup-app'
import { Role } from '@open-mercato/core/modules/auth/data/entities'
import { ensureClubTestDefinitions } from './lib/testCatalog'

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

const COACH_FEATURES = [
  'athletes.players.view',
  'athletes.tests.view',
  'athletes.tests.record',
  // E01: daily data — never the director (REQ-011).
  'athletes.daily.view',
  'athletes.daily.import',
]
const DIRECTOR_FEATURES = ['athletes.players.view', 'athletes.tests.view']

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['athletes.*'],
    admin: ['athletes.*'],
    // The installed `auth` grant check lets an actor assign a role only when it holds every
    // feature of that role, so the club admin is a superset of coach and director
    // (decision 2026-10-31, option A — the club admin also sees what the coach sees).
    club_admin: Array.from(
      new Set([
        'athletes.club.manage',
        'athletes.players.manage',
        'auth.users.list',
        'auth.users.create',
        'auth.users.edit',
        ...COACH_FEATURES,
        ...DIRECTOR_FEATURES,
      ]),
    ),
    coach: COACH_FEATURES,
    director: DIRECTOR_FEATURES,
  },

  async onTenantCreated({ em, tenantId, organizationId }) {
    await ensureClubRoles(em, tenantId)
    // The tenant's first club may be created without `directory.organization.created`.
    await ensureClubTestDefinitions(em, { tenantId, organizationId })
  },

  async seedDefaults({ em, tenantId, organizationId }) {
    await ensureClubRoles(em, tenantId)
    // Existing clubs get missing template definitions; club definitions are never overwritten.
    await ensureClubTestDefinitions(em, { tenantId, organizationId })
  },
}

export default setup
