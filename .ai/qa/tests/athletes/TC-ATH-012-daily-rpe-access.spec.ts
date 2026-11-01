import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'

/**
 * TEST-011 access part (spec 2026-10-31-e01-dane-dzienne-zawodnikow, phase 1): a coach of the
 * club imports and reads daily RPE data; a director of the same club and a user without the
 * `athletes.daily.*` features get 403 on preview, commit, undo and every read; a coach of
 * another club sees none of the club's sessions or imports and cannot undo them.
 */

type UploadFile = { name: string; mimeType: string; buffer: Buffer }

function daysAgo(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

function clubApi(request: APIRequestContext, token: string, selectedOrgId: string) {
  return async (method: string, path: string, data?: unknown) => {
    const response = await apiRequestWithSelectedOrg(request, method, path, { token, selectedOrgId, data })
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
    return { status: response.status(), body }
  }
}

/** Multipart upload as a given user (own club from the token). */
async function uploadAs(request: APIRequestContext, token: string, path: string, file: UploadFile) {
  const response = await request.fetch(path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    multipart: { kind: 'rpe', file },
  })
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
  return { status: response.status(), body }
}

async function getAs(request: APIRequestContext, token: string, path: string) {
  const response = await apiRequest(request, 'GET', path, { token })
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
  return { status: response.status(), body }
}

test.describe('TC-ATH-012 daily RPE data access', () => {
  test('coach imports and reads; director and a user without features get 403; another club sees nothing', async ({ request }) => {
    const admin = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const password = `Qa-${stamp}-Ee5!`
    let clubA: string | null = null
    let clubB: string | null = null
    const userIds: Array<string | null> = []
    try {
      clubA = await createOrganizationFixture(request, admin, { name: `QA daily access A ${stamp}` })
      clubB = await createOrganizationFixture(request, admin, { name: `QA daily access B ${stamp}` })
      const callA = clubApi(request, admin, clubA)
      const callB = clubApi(request, admin, clubB)

      const team = await callA('POST', '/api/athletes/teams', { name: `QA U15 ${stamp}` })
      expect(team.status).toBe(201)
      const teamId = String(team.body!.id)
      const lastName = `Access${stamp}`
      const player = await callA('POST', '/api/athletes/players', { teamId, firstName: 'Wanda', lastName, birthDate: '2011-03-03', joinedAt: '2025-01-01' })
      expect(player.status).toBe(201)
      const teamB = await callB('POST', '/api/athletes/teams', { name: `QA U15 B ${stamp}` })
      expect(teamB.status).toBe(201)

      const createUser = async (organizationId: string, role: string) => {
        const email = `qa-daily-${role}-${organizationId.slice(0, 8)}-${stamp}@example.test`
        const created = await apiRequest(request, 'POST', '/api/auth/users', {
          token: admin,
          data: { email, password, organizationId, roles: [role], name: `QA ${role}` },
        })
        expect(created.status()).toBe(201)
        userIds.push(((await created.json()) as { id: string }).id)
        return getAuthToken(request, email, password)
      }
      const coachA = await createUser(clubA, 'coach')
      const director = await createUser(clubA, 'director')
      const coachB = await createUser(clubB, 'coach')
      const employee = await getAuthToken(request, 'employee')

      const file: UploadFile = {
        name: 'rpe_trener.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(['Zawodnik;Data;Nr sesji;Minuty;RPE', `Wanda ${lastName};${daysAgo(1)};1;50;6`].join('\n'), 'utf8'),
      }

      // The coach of the club previews, commits and reads.
      const preview = await uploadAs(request, coachA, '/api/athletes/daily-imports/preview', file)
      expect(preview.status).toBe(200)
      expect(preview.body!.counts).toMatchObject({ rows: 1, saved: 1 })
      const committed = await uploadAs(request, coachA, '/api/athletes/daily-imports/commit', file)
      expect(committed.status).toBe(201)
      const importId = String(committed.body!.importId)
      const coachSessions = await getAs(request, coachA, `/api/athletes/training-sessions?teamId=${teamId}`)
      expect(coachSessions.status).toBe(200)
      expect(coachSessions.body!.items as unknown[]).toHaveLength(1)
      const coachImports = await getAs(request, coachA, '/api/athletes/daily-imports')
      expect(coachImports.status).toBe(200)
      expect((coachImports.body!.items as Array<{ id: string }>).map((item) => item.id)).toEqual([importId])

      // Director and a user without the daily features: 403 everywhere.
      for (const [label, token] of [['director', director], ['employee', employee]] as const) {
        expect((await uploadAs(request, token, '/api/athletes/daily-imports/preview', file)).status, label).toBe(403)
        expect((await uploadAs(request, token, '/api/athletes/daily-imports/commit', file)).status, label).toBe(403)
        expect((await getAs(request, token, '/api/athletes/training-sessions')).status, label).toBe(403)
        expect((await getAs(request, token, '/api/athletes/daily-imports')).status, label).toBe(403)
        const undo = await apiRequest(request, 'POST', '/api/athletes/daily-imports/undo', { token, data: { importId } })
        expect(undo.status(), label).toBe(403)
      }

      // A coach of another club: allowed in general, but sees nothing of club A.
      const foreignSessions = await getAs(request, coachB, '/api/athletes/training-sessions')
      expect(foreignSessions.status).toBe(200)
      expect(foreignSessions.body!.items).toEqual([])
      const foreignByTeam = await getAs(request, coachB, `/api/athletes/training-sessions?teamId=${teamId}`)
      expect(foreignByTeam.body!.items).toEqual([])
      expect((await getAs(request, coachB, '/api/athletes/daily-imports')).body!.items).toEqual([])
      const foreignUndo = await apiRequest(request, 'POST', '/api/athletes/daily-imports/undo', { token: coachB, data: { importId } })
      expect(foreignUndo.status()).toBe(404)
      // Club B's own import of club A's file finds none of club A's players.
      const foreignPreview = await uploadAs(request, coachB, '/api/athletes/daily-imports/preview', file)
      expect(foreignPreview.status).toBe(200)
      expect(foreignPreview.body!.counts).toMatchObject({ rows: 0, rejected: 1 })
      expect(foreignPreview.body!.unknownNames).toEqual([{ name: `Wanda ${lastName}`, rowCount: 1 }])

      // Club A's data is untouched.
      expect(((await callA('GET', `/api/athletes/training-sessions?teamId=${teamId}`)).body!.items as unknown[])).toHaveLength(1)
    } finally {
      for (const id of userIds) await deleteUserIfExists(request, admin, id)
      await deleteOrganizationIfExists(request, admin, clubB)
      await deleteOrganizationIfExists(request, admin, clubA)
    }
  })
})
