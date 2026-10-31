import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  deleteOrganizationIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'

/**
 * TEST-005 (spec 2026-10-28-e06-cele-zalecenia-klub): the coarse "delete club data" flow
 * soft-deletes the club's team, positions and players and deactivates every other account
 * of that club, while the executing admin keeps access. Runs on its own organization so it
 * never touches data other tests use.
 */
test.describe('TC-ATH-003 club data deletion', () => {
  test('deleting club data empties the roster and deactivates the other club accounts', async ({ request }) => {
    const admin = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const clubName = `QA club delete ${stamp}`
    const password = `Qa-${stamp}-Cc3!`
    const clubAdminEmail = `qa-del-admin-${stamp}@example.test`
    const coachEmail = `qa-del-coach-${stamp}@example.test`
    let organizationId: string | null = null
    let clubAdminId: string | null = null
    let coachId: string | null = null
    try {
      organizationId = await createOrganizationFixture(request, admin, { name: clubName })
      const clubAdminCreated = await apiRequest(request, 'POST', '/api/auth/users', {
        token: admin,
        data: { email: clubAdminEmail, password, organizationId, roles: ['club_admin'] },
      })
      expect(clubAdminCreated.status()).toBe(201)
      clubAdminId = ((await clubAdminCreated.json()) as { id: string }).id
      const coachCreated = await apiRequest(request, 'POST', '/api/auth/users', {
        token: admin,
        data: { email: coachEmail, password, organizationId, roles: ['coach'] },
      })
      expect(coachCreated.status()).toBe(201)
      coachId = ((await coachCreated.json()) as { id: string }).id

      const clubAdmin = await getAuthToken(request, clubAdminEmail, password)
      const team = await apiRequest(request, 'POST', '/api/athletes/teams', { token: clubAdmin, data: { name: `QA team ${stamp}` } })
      expect(team.status()).toBe(201)
      const teamId = ((await team.json()) as { id: string }).id
      const position = await apiRequest(request, 'POST', '/api/athletes/positions', { token: clubAdmin, data: { name: `QA bramkarz ${stamp}` } })
      expect(position.status()).toBe(201)
      const player = await apiRequest(request, 'POST', '/api/athletes/players', {
        token: clubAdmin,
        data: { teamId, firstName: 'Ewa', lastName: `Kowal${stamp}`, birthDate: '2011-02-03', joinedAt: '2024-09-01' },
      })
      expect(player.status()).toBe(201)

      const deleted = await apiRequest(request, 'POST', '/api/athletes/club/delete-request', {
        token: clubAdmin,
        data: { confirmationName: clubName },
      })
      expect(deleted.status()).toBe(202)
      const summary = (await deleted.json()) as { deletedRecords: number; deactivatedAccounts: number; skippedAccounts: number }
      expect(summary.deletedRecords).toBe(3)
      expect(summary.deactivatedAccounts).toBe(1)
      expect(summary.skippedAccounts).toBe(0)

      for (const path of ['/api/athletes/players', '/api/athletes/teams', '/api/athletes/positions']) {
        const rows = await apiRequest(request, 'GET', path, { token: clubAdmin })
        expect(rows.status()).toBe(200)
        expect(((await rows.json()) as { items: unknown[] }).items).toHaveLength(0)
      }

      const users = await apiRequest(request, 'GET', `/api/auth/users?organizationId=${organizationId}`, { token: admin })
      const byId = Object.fromEntries(
        ((await users.json()) as { items: Array<{ id: string; isConfirmed: boolean }> }).items.map((user) => [user.id, user.isConfirmed]),
      )
      expect(byId[clubAdminId]).toBe(true)
      expect(byId[coachId]).toBe(false)

      const form = new URLSearchParams({ email: coachEmail, password })
      const coachLogin = await request.post('/api/auth/login', {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        data: form.toString(),
      })
      expect(coachLogin.status()).toBe(401)
    } finally {
      await deleteUserIfExists(request, admin, coachId)
      await deleteUserIfExists(request, admin, clubAdminId)
      await deleteOrganizationIfExists(request, admin, organizationId)
    }
  })
})
