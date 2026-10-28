import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'

/**
 * TEST-001 / TEST-002 (spec 2026-10-28-e06-cele-zalecenia-klub): a club admin builds the
 * roster through the API, and nothing of club A is readable or writable from club B.
 * Clubs are tenants in production; inside one tenant the module still scopes every row by
 * organization, which is what this test can exercise with the default fixtures.
 */
test.describe('TC-ATH-001 athletes roster and club isolation', () => {
  test('creates team, position and player; club B cannot read or change them', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let otherClubId: string | null = null
    let positionId: string | null = null
    let playerId: string | null = null
    try {
      otherClubId = await createOrganizationFixture(request, token, { name: `QA club B ${stamp}` })

      const teams = await apiRequest(request, 'GET', '/api/athletes/teams?isActive=true', { token })
      expect(teams.status()).toBe(200)
      const teamItems = ((await teams.json()) as { items: Array<{ id: string }> }).items
      let teamId = teamItems[0]?.id
      if (!teamId) {
        const created = await apiRequest(request, 'POST', '/api/athletes/teams', { token, data: { name: `QA U17 ${stamp}` } })
        expect(created.status()).toBe(201)
        teamId = ((await created.json()) as { id: string }).id
      }

      const secondActive = await apiRequest(request, 'POST', '/api/athletes/teams', { token, data: { name: `QA second ${stamp}` } })
      expect(secondActive.status()).toBe(409)

      const position = await apiRequest(request, 'POST', '/api/athletes/positions', { token, data: { name: `QA skrzydłowy ${stamp}` } })
      expect(position.status()).toBe(201)
      positionId = ((await position.json()) as { id: string }).id

      const player = await apiRequest(request, 'POST', '/api/athletes/players', {
        token,
        data: { teamId, firstName: 'Anna', lastName: `Nowak${stamp}`, birthDate: '2010-05-01', positionId, joinedAt: '2024-09-01' },
      })
      expect(player.status()).toBe(201)
      playerId = ((await player.json()) as { id: string }).id

      const own = await apiRequest(request, 'GET', `/api/athletes/players?id=${playerId}`, { token })
      const ownItem = ((await own.json()) as { items: Array<{ lastName: string; updatedAt: string }> }).items[0]
      expect(ownItem.lastName).toBe(`Nowak${stamp}`)
      expect(ownItem.updatedAt).toBeTruthy()

      const fromOtherClub = await apiRequestWithSelectedOrg(request, 'GET', `/api/athletes/players?id=${playerId}`, {
        token,
        selectedOrgId: otherClubId,
      })
      expect(fromOtherClub.status()).toBe(200)
      expect(((await fromOtherClub.json()) as { items: unknown[] }).items).toHaveLength(0)

      const changeFromOtherClub = await apiRequestWithSelectedOrg(request, 'PUT', '/api/athletes/players', {
        token,
        selectedOrgId: otherClubId,
        data: { id: playerId, firstName: 'Intruz' },
      })
      expect(changeFromOtherClub.status()).toBe(404)

      const inUse = await apiRequest(request, 'DELETE', '/api/athletes/positions', { token, data: { id: positionId } })
      expect(inUse.status()).toBe(409)
    } finally {
      if (playerId) await apiRequest(request, 'DELETE', '/api/athletes/players', { token, data: { id: playerId } }).catch(() => undefined)
      if (positionId) await apiRequest(request, 'DELETE', '/api/athletes/positions', { token, data: { id: positionId } }).catch(() => undefined)
      await deleteOrganizationIfExists(request, token, otherClubId)
    }
  })

  test('club data deletion requires the exact club name', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const wrong = await apiRequest(request, 'POST', '/api/athletes/club/delete-request', {
      token,
      data: { confirmationName: `not-the-club-${Date.now()}` },
    })
    expect(wrong.status()).toBe(400)
    expect(((await wrong.json()) as { error: string }).error).toBe('athletes.errors.clubNameMismatch')
  })
})
