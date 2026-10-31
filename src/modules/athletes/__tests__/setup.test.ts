import { describe, expect, it, jest } from '@jest/globals'
import { CLUB_ROLE_NAMES, ensureClubRoles, setup } from '../setup'

jest.mock('@open-mercato/core/modules/auth/lib/setup-app', () => ({
  ensureRoles: jest.fn(async () => undefined),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'

type AnyFn = (...args: unknown[]) => unknown

describe('athletes setup', () => {
  it('creates the three club roles and protects the last active club admin (REQ-003)', async () => {
    const { ensureRoles } = jest.requireMock('@open-mercato/core/modules/auth/lib/setup-app') as { ensureRoles: jest.Mock<AnyFn> }
    const em = { nativeUpdate: jest.fn<AnyFn>(async () => 1) }

    await ensureClubRoles(em as never, TENANT)

    expect(ensureRoles).toHaveBeenCalledWith(em, { roleNames: [...CLUB_ROLE_NAMES], tenantId: TENANT })
    // Only an unprotected club_admin role of this tenant is raised to a floor of one holder.
    expect(em.nativeUpdate).toHaveBeenCalledWith(
      expect.anything(),
      { name: 'club_admin', tenantId: TENANT, minActiveHolders: 0 },
      { minActiveHolders: 1 },
    )
  })

  it('grants coaches and directors read access only, and keeps operator wildcards out of club roles', () => {
    const features = setup.defaultRoleFeatures ?? {}
    expect(features.coach).toEqual(['athletes.players.view'])
    expect(features.director).toEqual(['athletes.players.view'])
    for (const role of CLUB_ROLE_NAMES) {
      expect((features[role] ?? []).some((feature) => feature.endsWith('*'))).toBe(false)
    }
  })
})
