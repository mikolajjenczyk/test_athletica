import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'

/**
 * TEST-006 / TEST-010 / TEST-013 (spec 2026-10-28-e02-testy-i-wyniki): "Finish test" returns a
 * summary with results, "did not perform" and empty fields; no gap is stored or returned as 0.
 * The results read (`athletesTestResultsService` behind `GET /api/athletes/test-results`) is
 * scoped to the caller's club, and a view-only director never receives the reason.
 */

type ResultItem = {
  id: string
  playerId: string
  testDefinitionId: string
  testedOn: string
  value: number | null
  state: string
  reasonCode?: string | null
  noPreviousMeasurement: boolean
  checkFlag: boolean
}

function clubApi(request: APIRequestContext, token: string, selectedOrgId: string) {
  return async (method: string, path: string, data?: unknown) => {
    const response = await apiRequestWithSelectedOrg(request, method, path, { token, selectedOrgId, data })
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
    return { status: response.status(), body }
  }
}

test.describe('TC-ATH-007 test summary and result visibility', () => {
  test('finish summarizes gaps, results stay in the club and the director gets no reasons', async ({ request }) => {
    const admin = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const password = `Qa-${stamp}-Dd4!`
    const directorEmail = `qa-director-${stamp}@example.test`
    let clubA: string | null = null
    let clubB: string | null = null
    let directorId: string | null = null
    try {
      clubA = await createOrganizationFixture(request, admin, { name: `QA tests club A ${stamp}` })
      clubB = await createOrganizationFixture(request, admin, { name: `QA tests club B ${stamp}` })
      const callA = clubApi(request, admin, clubA)
      const callB = clubApi(request, admin, clubB)

      await expect.poll(async () => ((await callA('GET', '/api/athletes/test-definitions?activeOnly=true')).body?.items as unknown[] | undefined)?.length ?? 0).toBe(6)
      const definitions = (await callA('GET', '/api/athletes/test-definitions?activeOnly=true')).body!.items as Array<{ id: string; templateKey: string }>
      const jump = definitions.find((definition) => definition.templateKey === 'cmj')!

      const team = await callA('POST', '/api/athletes/teams', { name: `QA U18 ${stamp}` })
      expect(team.status).toBe(201)
      const teamId = String(team.body!.id)
      const players: Record<string, string> = {}
      for (const firstName of ['Dorota', 'Ewa', 'Fela', 'Gosia']) {
        const created = await callA('POST', '/api/athletes/players', {
          teamId, firstName, lastName: `Summary${stamp}`, birthDate: '2009-09-09', joinedAt: '2025-01-01',
        })
        expect(created.status).toBe(201)
        players[firstName] = String(created.body!.id)
      }

      const started = await callA('POST', '/api/athletes/test-sessions', { testDefinitionId: jump.id, teamId, testedOn: '2025-05-05' })
      expect(started.status).toBe(201)
      const sessionId = String(started.body!.id)

      const record = (playerId: string, body: Record<string, unknown>, key: string) =>
        callA('POST', '/api/athletes/test-results/record', { sessionId, playerId, idempotencyKey: `qa-${key}-${stamp}`, ...body })
      expect((await record(players.Dorota, { trials: [{ attemptNo: 1, value: 30 }, { attemptNo: 2, value: 31 }] }, 'dorota')).status).toBe(201)
      expect((await record(players.Ewa, { trials: [], state: 'not_performed', reasonCode: 'absent' }, 'ewa')).status).toBe(201)
      expect((await record(players.Fela, { trials: [{ attemptNo: 1, isInvalid: true }, { attemptNo: 2, isInvalid: true }] }, 'fela')).status).toBe(201)
      // A reason without "did not perform", and "did not perform" without a reason, are refused.
      expect((await record(players.Gosia, { trials: [], state: 'not_performed' }, 'gosia-no-reason')).status).toBe(400)
      expect((await record(players.Gosia, { trials: [{ attemptNo: 1, value: 29 }], reasonCode: 'other' }, 'gosia-reason')).status).toBe(400)

      // Club B can neither read nor write club A's session.
      const foreignRead = await callB('GET', `/api/athletes/test-results?sessionId=${sessionId}`)
      expect(foreignRead.status).toBe(200)
      expect(foreignRead.body!.items).toEqual([])
      const foreignRecord = await callB('POST', '/api/athletes/test-results/record', {
        sessionId, playerId: players.Gosia, trials: [{ attemptNo: 1, value: 28 }], idempotencyKey: `qa-foreign-${stamp}`,
      })
      expect(foreignRecord.status).toBe(404)
      expect((await callB('POST', '/api/athletes/test-sessions/finish', { id: sessionId, updatedAt: started.body!.updatedAt })).status).toBe(404)
      const foreignStart = await callB('POST', '/api/athletes/test-sessions', { testDefinitionId: jump.id, teamId, testedOn: '2025-05-05' })
      expect(foreignStart.status).toBe(400)
      const foreignSessions = await callB('GET', `/api/athletes/test-sessions?id=${sessionId}`)
      expect(foreignSessions.body!.items).toEqual([])

      // TEST-006: the summary counts results, "did not perform", invalid attempts and empty fields.
      const finished = await callA('POST', '/api/athletes/test-sessions/finish', { id: sessionId, updatedAt: started.body!.updatedAt })
      expect(finished.status).toBe(200)
      expect(finished.body).toMatchObject({ status: 'finished', alreadyFinished: false })
      expect(finished.body!.summary).toEqual({ recorded: 1, notPerformed: 1, empty: 1, invalidAttempt: 1, joinedLater: 0, playersTotal: 4 })
      const finishedAgain = await callA('POST', '/api/athletes/test-sessions/finish', { id: sessionId, updatedAt: finished.body!.updatedAt })
      expect(finishedAgain.status).toBe(200)
      expect(finishedAgain.body!.alreadyFinished).toBe(true)
      expect((await record(players.Gosia, { trials: [{ attemptNo: 1, value: 29 }] }, 'gosia-late')).status).toBe(409)

      // TEST-010 / TEST-013: club-scoped read with gap states and no zeros.
      const resultsA = await callA('GET', `/api/athletes/test-results?definitionId=${jump.id}&teamId=${teamId}`)
      expect(resultsA.status).toBe(200)
      const items = resultsA.body!.items as ResultItem[]
      expect(items).toHaveLength(3)
      const byPlayer = Object.fromEntries(items.map((item) => [item.playerId, item]))
      expect(byPlayer[players.Dorota]).toMatchObject({ value: 31, state: 'recorded', testedOn: '2025-05-05', noPreviousMeasurement: true })
      expect(byPlayer[players.Ewa]).toMatchObject({ value: null, state: 'not_performed', reasonCode: 'absent' })
      expect(byPlayer[players.Fela]).toMatchObject({ value: null, state: 'invalid_attempt' })
      expect(items.some((item) => item.value === 0)).toBe(false)
      const resultsB = await callB('GET', `/api/athletes/test-results?playerId=${players.Dorota}`)
      expect(resultsB.status).toBe(200)
      expect(resultsB.body!.items).toEqual([])

      // A director (view-only) reads the results without any reason and cannot record.
      const directorCreated = await apiRequest(request, 'POST', '/api/auth/users', {
        token: admin,
        data: { email: directorEmail, password, organizationId: clubA, roles: ['director'], name: 'QA Director' },
      })
      expect(directorCreated.status()).toBe(201)
      directorId = ((await directorCreated.json()) as { id: string }).id
      const director = await getAuthToken(request, directorEmail, password)
      const directorRead = await apiRequest(request, 'GET', `/api/athletes/test-results?sessionId=${sessionId}`, { token: director })
      expect(directorRead.status()).toBe(200)
      const directorItems = ((await directorRead.json()) as { items: ResultItem[] }).items
      expect(directorItems).toHaveLength(3)
      for (const item of directorItems) expect(item).not.toHaveProperty('reasonCode')
      expect(directorItems.find((item) => item.playerId === players.Ewa)?.state).toBe('not_performed')
      const directorCatalog = await apiRequest(request, 'GET', '/api/athletes/test-definitions?activeOnly=true', { token: director })
      expect(directorCatalog.status()).toBe(200)
      const directorStart = await apiRequest(request, 'POST', '/api/athletes/test-sessions', {
        token: director,
        data: { testDefinitionId: jump.id, teamId, testedOn: '2025-05-06' },
      })
      expect(directorStart.status()).toBe(403)
      const directorRecord = await apiRequest(request, 'POST', '/api/athletes/test-results/record', {
        token: director,
        data: { sessionId, playerId: players.Gosia, trials: [{ attemptNo: 1, value: 28 }], idempotencyKey: `qa-director-${stamp}` },
      })
      expect(directorRecord.status()).toBe(403)
    } finally {
      await deleteUserIfExists(request, admin, directorId)
      await deleteOrganizationIfExists(request, admin, clubB)
      await deleteOrganizationIfExists(request, admin, clubA)
    }
  })
})
