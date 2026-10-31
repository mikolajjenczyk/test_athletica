import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'

/**
 * TEST-003 / TEST-004 (spec 2026-10-28-e02-testy-i-wyniki): "Start test" refuses a future
 * date and a date before the player joined, and reuses the open session of the same team and
 * test; a recorded result is the best valid trial in the test's direction, a retry with the
 * same idempotency key returns the stored result without a second write, the first result has
 * "no previous measurement", and a result more than 10% away from the previous one is flagged.
 */

type Definition = { id: string; templateKey: string; direction: string; attempts: number }
type RecordedResult = {
  id: string
  playerId: string
  value: number | null
  state: string
  checkFlag: boolean
  noPreviousMeasurement: boolean
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function clubApi(request: APIRequestContext, token: string, selectedOrgId: string) {
  return async (method: string, path: string, data?: unknown) => {
    const response = await apiRequestWithSelectedOrg(request, method, path, { token, selectedOrgId, data })
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
    return { status: response.status(), body }
  }
}

test.describe('TC-ATH-006 test sessions and results', () => {
  test('start validates dates and reuses the open session; recording keeps the best trial once', async ({ request }) => {
    const admin = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let organizationId: string | null = null
    try {
      organizationId = await createOrganizationFixture(request, admin, { name: `QA test sessions ${stamp}` })
      const call = clubApi(request, admin, organizationId)

      await expect.poll(async () => ((await call('GET', '/api/athletes/test-definitions?activeOnly=true')).body?.items as unknown[] | undefined)?.length ?? 0).toBe(6)
      const definitions = (await call('GET', '/api/athletes/test-definitions?activeOnly=true')).body!.items as Definition[]
      const sprint = definitions.find((definition) => definition.templateKey === 'sprint_10m')!
      const jump = definitions.find((definition) => definition.templateKey === 'cmj')!
      expect(sprint.direction).toBe('lower_better')
      expect(jump.direction).toBe('higher_better')

      const team = await call('POST', '/api/athletes/teams', { name: `QA U16 ${stamp}` })
      expect(team.status).toBe(201)
      const teamId = String(team.body!.id)
      const createPlayer = async (firstName: string, joinedAt: string) => {
        const created = await call('POST', '/api/athletes/players', {
          teamId, firstName, lastName: `Test${stamp}`, birthDate: '2010-06-01', joinedAt,
        })
        expect(created.status).toBe(201)
        return String(created.body!.id)
      }
      const anna = await createPlayer('Anna', '2025-01-01')
      const beata = await createPlayer('Beata', '2025-01-01')
      const latecomer = await createPlayer('Celina', '2025-06-01')

      // TEST-003: no future date, no date before the player joined.
      const tomorrow = new Date()
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
      const future = await call('POST', '/api/athletes/test-sessions', { testDefinitionId: sprint.id, teamId, testedOn: isoDate(tomorrow) })
      expect(future.status).toBe(400)
      const beforeJoined = await call('POST', '/api/athletes/test-sessions', {
        testDefinitionId: sprint.id, kind: 'individual', playerId: latecomer, testedOn: '2025-03-01',
      })
      expect(beforeJoined.status).toBe(400)
      expect(beforeJoined.body?.error).toBe('The test date is earlier than the date the player joined.')

      const started = await call('POST', '/api/athletes/test-sessions', { testDefinitionId: sprint.id, teamId, testedOn: '2025-03-01' })
      expect(started.status).toBe(201)
      expect(started.body).toMatchObject({ reused: false, status: 'open', testedOn: '2025-03-01' })
      const sessionId = String(started.body!.id)
      const again = await call('POST', '/api/athletes/test-sessions', { testDefinitionId: sprint.id, teamId, testedOn: '2025-03-02' })
      expect(again.status).toBe(201)
      expect(again.body).toMatchObject({ id: sessionId, reused: true, status: 'open', testedOn: '2025-03-01' })
      const open = await call('GET', `/api/athletes/test-sessions?status=open&teamId=${teamId}`)
      expect((open.body!.items as Array<{ id: string }>).map((item) => item.id)).toEqual([sessionId])

      // TEST-004: best valid trial of a "lower is better" test, recorded once per key.
      const key = `qa-sprint-anna-${stamp}`
      const sprintTrials = [{ attemptNo: 1, value: 2.1 }, { attemptNo: 2, value: 2.05 }, { attemptNo: 3, isInvalid: true }]
      const first = await call('POST', '/api/athletes/test-results/record', { sessionId, playerId: anna, trials: sprintTrials, idempotencyKey: key })
      expect(first.status).toBe(201)
      const firstResult = first.body!.result as RecordedResult
      expect(first.body!.replayed).toBe(false)
      expect(firstResult).toMatchObject({ value: 2.05, state: 'recorded', noPreviousMeasurement: true, checkFlag: false })

      const retry = await call('POST', '/api/athletes/test-results/record', { sessionId, playerId: anna, trials: sprintTrials, idempotencyKey: key })
      expect(retry.status).toBe(200)
      expect(retry.body!.replayed).toBe(true)
      expect((retry.body!.result as RecordedResult).id).toBe(firstResult.id)
      const keyForAnotherPlayer = await call('POST', '/api/athletes/test-results/record', {
        sessionId, playerId: beata, trials: sprintTrials, idempotencyKey: key,
      })
      expect(keyForAnotherPlayer.status).toBe(409)

      const annaResults = await call('GET', `/api/athletes/test-results?sessionId=${sessionId}&playerId=${anna}`)
      expect(annaResults.status).toBe(200)
      expect(annaResults.body!.items as RecordedResult[]).toHaveLength(1)

      // A gap is a state, never 0; a player who joined after the test date needs "joined later".
      const zero = await call('POST', '/api/athletes/test-results/record', {
        sessionId, playerId: beata, trials: [{ attemptNo: 1, value: 0 }], idempotencyKey: `qa-zero-${stamp}`,
      })
      expect(zero.status).toBe(400)
      const tooEarly = await call('POST', '/api/athletes/test-results/record', {
        sessionId, playerId: latecomer, trials: [{ attemptNo: 1, value: 2.2 }], idempotencyKey: `qa-late-${stamp}`,
      })
      expect(tooEarly.status).toBe(400)
      const joinedLater = await call('POST', '/api/athletes/test-results/record', {
        sessionId, playerId: latecomer, trials: [], state: 'joined_later', idempotencyKey: `qa-late-state-${stamp}`,
      })
      expect(joinedLater.status).toBe(201)
      expect(joinedLater.body!.result).toMatchObject({ state: 'joined_later', value: null })

      expect((await call('POST', '/api/athletes/test-sessions/finish', { id: sessionId })).status).toBe(200)

      // Next sprint session: more than 10% slower than 2.05 s is flagged "check", not blocked.
      const second = await call('POST', '/api/athletes/test-sessions', { testDefinitionId: sprint.id, teamId, testedOn: '2025-04-01' })
      expect(second.status).toBe(201)
      expect(second.body!.reused).toBe(false)
      const secondId = String(second.body!.id)
      const slower = await call('POST', '/api/athletes/test-results/record', {
        sessionId: secondId, playerId: anna, trials: [{ attemptNo: 1, value: 2.4 }, { attemptNo: 2, value: 2.35 }], idempotencyKey: `qa-sprint-anna-2-${stamp}`,
      })
      expect(slower.status).toBe(201)
      expect(slower.body!.result).toMatchObject({ value: 2.35, state: 'recorded', noPreviousMeasurement: false, checkFlag: true })
      const close = await call('POST', '/api/athletes/test-results/record', {
        sessionId: secondId, playerId: beata, trials: [{ attemptNo: 1, value: 2.3 }], idempotencyKey: `qa-sprint-beata-2-${stamp}`,
      })
      expect(close.status).toBe(201)
      expect(close.body!.result).toMatchObject({ value: 2.3, noPreviousMeasurement: true, checkFlag: false })

      // "Higher is better": the best trial is the largest valid one.
      const jumpSession = await call('POST', '/api/athletes/test-sessions', { testDefinitionId: jump.id, teamId, testedOn: '2025-04-01' })
      expect(jumpSession.status).toBe(201)
      const jumpResult = await call('POST', '/api/athletes/test-results/record', {
        sessionId: String(jumpSession.body!.id),
        playerId: anna,
        trials: [{ attemptNo: 1, value: 31.5 }, { attemptNo: 2, isInvalid: true }, { attemptNo: 3, value: 33 }],
        idempotencyKey: `qa-cmj-anna-${stamp}`,
      })
      expect(jumpResult.status).toBe(201)
      expect(jumpResult.body!.result).toMatchObject({ value: 33, state: 'recorded', noPreviousMeasurement: true, checkFlag: false })
      const tooManyAttempts = await call('POST', '/api/athletes/test-results/record', {
        sessionId: String(jumpSession.body!.id),
        playerId: beata,
        trials: [{ attemptNo: jump.attempts + 1, value: 30 }],
        idempotencyKey: `qa-cmj-beata-${stamp}`,
      })
      expect(tooManyAttempts.status).toBe(400)
    } finally {
      await deleteOrganizationIfExists(request, admin, organizationId)
    }
  })
})
