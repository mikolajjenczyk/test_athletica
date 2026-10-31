import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createOrganizationFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'

/**
 * TEST-003 / TEST-004 (spec 2026-10-28-e06-cele-zalecenia-klub): a club admin invites
 * people through the installed `auth` API, sees pending invitations, resends, deactivates
 * and reactivates accounts; it cannot escalate roles or reach another club (tenant).
 */

/** Direct login status — `getAuthToken` caches tokens, so it cannot prove a login is refused. */
async function loginStatus(request: APIRequestContext, email: string, password: string): Promise<number> {
  const form = new URLSearchParams({ email, password })
  const response = await request.post('/api/auth/login', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  })
  return response.status()
}

function organizationIdOf(token: string): string {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).orgId as string
}

test.describe('TC-ATH-002 club accounts', () => {
  test('club admin invites, resends, deactivates and reactivates within its own club', async ({ request }) => {
    const admin = await getAuthToken(request, 'admin')
    const organizationId = organizationIdOf(admin)
    const stamp = Date.now()
    const password = `Qa-${stamp}-Aa1!`
    const clubAdminEmail = `qa-club-admin-${stamp}@example.test`
    const coachEmail = `qa-coach-${stamp}@example.test`
    let clubAdminId: string | null = null
    let invitedId: string | null = null
    let coachId: string | null = null
    try {
      const clubAdminCreated = await apiRequest(request, 'POST', '/api/auth/users', {
        token: admin,
        data: { email: clubAdminEmail, password, organizationId, roles: ['club_admin'], name: 'QA Club Admin' },
      })
      expect(clubAdminCreated.status()).toBe(201)
      clubAdminId = ((await clubAdminCreated.json()) as { id: string }).id
      const clubAdmin = await getAuthToken(request, clubAdminEmail, password)

      const invited = await apiRequest(request, 'POST', '/api/auth/users', {
        token: clubAdmin,
        data: { email: `qa-invited-${stamp}@example.test`, organizationId, roles: ['coach'], name: 'QA Invited', sendInviteEmail: true },
      })
      expect(invited.status()).toBe(201)
      invitedId = ((await invited.json()) as { id: string }).id

      const status = await apiRequest(request, 'GET', `/api/athletes/accounts/invite-status?ids=${invitedId},${clubAdminId}`, {
        token: clubAdmin,
      })
      expect(status.status()).toBe(200)
      const pending = Object.fromEntries(
        ((await status.json()) as { items: Array<{ id: string; pending: boolean }> }).items.map((item) => [item.id, item.pending]),
      )
      expect(pending[invitedId]).toBe(true)
      expect(pending[clubAdminId]).toBe(false)

      const resend = await apiRequest(request, 'POST', '/api/auth/users/resend-invite', { token: clubAdmin, data: { id: invitedId } })
      expect(resend.status()).toBe(200)

      const coachCreated = await apiRequest(request, 'POST', '/api/auth/users', {
        token: clubAdmin,
        data: { email: coachEmail, password, organizationId, roles: ['coach'], name: 'QA Coach' },
      })
      expect(coachCreated.status()).toBe(201)
      coachId = ((await coachCreated.json()) as { id: string }).id
      const coach = await getAuthToken(request, coachEmail, password)
      expect((await apiRequest(request, 'GET', '/api/athletes/players', { token: coach })).status()).toBe(200)

      const deactivated = await apiRequest(request, 'PUT', '/api/auth/users', { token: clubAdmin, data: { id: coachId, isConfirmed: false } })
      expect(deactivated.status()).toBe(200)
      expect((await apiRequest(request, 'GET', '/api/athletes/players', { token: coach })).status()).toBe(401)
      expect(await loginStatus(request, coachEmail, password)).toBe(401)

      const reactivated = await apiRequest(request, 'PUT', '/api/auth/users', { token: clubAdmin, data: { id: coachId, isConfirmed: true } })
      expect(reactivated.status()).toBe(200)
      expect(await loginStatus(request, coachEmail, password)).toBe(200)
      // "The last club admin cannot be deactivated" is the installed protected-role floor,
      // counted per tenant (a club is its own tenant). The shared test tenant holds other
      // club admins, so the floor is covered by `src/modules/athletes/__tests__/setup.test.ts`.
    } finally {
      await deleteUserIfExists(request, admin, coachId)
      await deleteUserIfExists(request, admin, invitedId)
      await deleteUserIfExists(request, admin, clubAdminId)
    }
  })

  test('club admin cannot grant an operator role or reach another club', async ({ request }) => {
    const admin = await getAuthToken(request, 'admin')
    const superadmin = await getAuthToken(request, 'superadmin')
    const organizationId = organizationIdOf(admin)
    const stamp = Date.now()
    const password = `Qa-${stamp}-Bb2!`
    const clubAdminEmail = `qa-club-admin-x-${stamp}@example.test`
    let clubAdminId: string | null = null
    let otherTenantId: string | null = null
    try {
      const tenant = await apiRequest(request, 'POST', '/api/directory/tenants', { token: superadmin, data: { name: `QA club tenant ${stamp}` } })
      expect(tenant.status()).toBe(201)
      otherTenantId = ((await tenant.json()) as { id: string }).id
      const otherClubId = await createOrganizationFixture(request, superadmin, { name: `QA other club ${stamp}`, tenantId: otherTenantId })

      const clubAdminCreated = await apiRequest(request, 'POST', '/api/auth/users', {
        token: admin,
        data: { email: clubAdminEmail, password, organizationId, roles: ['club_admin'] },
      })
      expect(clubAdminCreated.status()).toBe(201)
      clubAdminId = ((await clubAdminCreated.json()) as { id: string }).id
      const clubAdmin = await getAuthToken(request, clubAdminEmail, password)

      const escalate = await apiRequest(request, 'POST', '/api/auth/users', {
        token: clubAdmin,
        data: { email: `qa-escalate-${stamp}@example.test`, organizationId, roles: ['admin'], sendInviteEmail: true },
      })
      expect(escalate.status()).toBe(403)

      const crossClub = await apiRequest(request, 'POST', '/api/auth/users', {
        token: clubAdmin,
        data: { email: `qa-cross-${stamp}@example.test`, organizationId: otherClubId, roles: [], sendInviteEmail: true },
      })
      expect(crossClub.status()).toBe(404)

      const otherClubUsers = await apiRequest(request, 'GET', `/api/auth/users?organizationId=${otherClubId}`, { token: clubAdmin })
      expect(otherClubUsers.status()).toBe(200)
      expect(((await otherClubUsers.json()) as { items: unknown[] }).items).toHaveLength(0)
    } finally {
      await deleteUserIfExists(request, admin, clubAdminId)
      if (otherTenantId) {
        await apiRequest(request, 'DELETE', '/api/directory/tenants', { token: superadmin, data: { id: otherTenantId } }).catch(() => undefined)
      }
    }
  })
})
