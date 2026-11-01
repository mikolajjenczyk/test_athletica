import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'

/**
 * TEST-002 / TEST-011 assignment part (spec 2026-10-31-e01-dane-dzienne-zawodnikow, phase 1):
 * a name the roster cannot match is listed by the preview; the coach may assign it only to an
 * active team player not yet matched in this file — never one already matched by name, an
 * inactive one, a player of another club, or the same player twice (400, nothing saved).
 * With the assignment the rows are saved to the chosen player; "skip" rejects them.
 */

type UploadFile = { name: string; mimeType: string; buffer: Buffer }
type Session = { playerId: string; sessionDate: string; sessionNo: number; rpe: number | null }

function daysAgo(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

function clubApi(request: APIRequestContext, token: string, selectedOrgId: string) {
  return async (method: string, path: string, data?: unknown, headers?: Record<string, string>) => {
    const response = await request.fetch(path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Cookie: `om_selected_org=${selectedOrgId}`, ...(headers ?? {}) },
      data,
    })
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
    return { status: response.status(), body }
  }
}

function clubUpload(request: APIRequestContext, token: string, selectedOrgId: string) {
  return async (path: string, file: UploadFile, assignments?: Record<string, string | null>) => {
    const response = await request.fetch(path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Cookie: `om_selected_org=${selectedOrgId}` },
      multipart: { kind: 'rpe', ...(assignments ? { assignments: JSON.stringify(assignments) } : {}), file },
    })
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
    return { status: response.status(), body }
  }
}

function toCsv(table: Array<Array<string | number | null>>): UploadFile {
  const content = table.map((row) => row.map((cell) => (cell === null ? '' : String(cell))).join(';')).join('\n')
  return { name: 'rpe_przypisania.csv', mimeType: 'text/csv', buffer: Buffer.from(content, 'utf8') }
}

test.describe('TC-ATH-010 daily RPE name assignment', () => {
  test('an unknown name goes only to an unmatched active team player, once; skipped names are rejected', async ({ request }) => {
    const admin = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let clubA: string | null = null
    let clubB: string | null = null
    try {
      clubA = await createOrganizationFixture(request, admin, { name: `QA daily assign A ${stamp}` })
      clubB = await createOrganizationFixture(request, admin, { name: `QA daily assign B ${stamp}` })
      const callA = clubApi(request, admin, clubA)
      const callB = clubApi(request, admin, clubB)
      const upload = clubUpload(request, admin, clubA)

      const lastName = `Assign${stamp}`
      const createPlayer = async (call: typeof callA, teamId: string, firstName: string) => {
        const created = await call('POST', '/api/athletes/players', { teamId, firstName, lastName, birthDate: '2010-01-10', joinedAt: '2025-01-01' })
        expect(created.status).toBe(201)
        return String(created.body!.id)
      }
      const teamA = await callA('POST', '/api/athletes/teams', { name: `QA A ${stamp}` })
      expect(teamA.status).toBe(201)
      const teamAId = String(teamA.body!.id)
      const ola = await createPlayer(callA, teamAId, 'Ola')
      const pola = await createPlayer(callA, teamAId, 'Pola')
      const rita = await createPlayer(callA, teamAId, 'Rita')
      const inactive = await createPlayer(callA, teamAId, 'Sara')
      const current = await callA('GET', `/api/athletes/players?id=${inactive}`)
      const deactivated = await callA('PUT', '/api/athletes/players', { id: inactive, isActive: false }, {
        'x-om-ext-optimistic-lock-expected-updated-at': String((current.body!.items as Array<{ updatedAt: string }>)[0].updatedAt),
      })
      expect(deactivated.status).toBe(200)

      const teamB = await callB('POST', '/api/athletes/teams', { name: `QA B ${stamp}` })
      expect(teamB.status).toBe(201)
      const foreign = await createPlayer(callB, String(teamB.body!.id), 'Tola')

      const day = daysAgo(1)
      const file = toCsv([
        ['Imię', 'Nazwisko', 'Data', 'Sesja', 'Minuty', 'RPE'],
        ['Ola', lastName, day, 1, 60, 6], // line 2: matched by name
        ['Olga', 'Kowalsky', day, 1, 60, 7], // line 3: unknown
        ['Olga', 'Kowalsky', day, 2, 20, 4], // line 4: unknown
        ['Zuza', 'Nieznana', day, 1, 50, 5], // line 5: unknown
      ])

      const preview = await upload('/api/athletes/daily-imports/preview', file)
      expect(preview.status).toBe(200)
      expect(preview.body!.unknownNames).toEqual([{ name: 'Olga Kowalsky', rowCount: 2 }, { name: 'Zuza Nieznana', rowCount: 1 }])
      const roster = preview.body!.players as Array<{ id: string; matchedByName: boolean }>
      expect(Object.fromEntries(roster.map((player) => [player.id, player.matchedByName]))).toEqual({ [ola]: true, [pola]: false, [rita]: false })

      // The preview recomputed with an assignment shows the rows under the chosen player.
      const assignedPreview = await upload('/api/athletes/daily-imports/preview', file, { 'Olga Kowalsky': pola })
      expect(assignedPreview.status).toBe(200)
      expect(assignedPreview.body!.counts).toMatchObject({ rows: 3, rejected: 1, assignedNames: 1 })
      expect((assignedPreview.body!.rows as Array<{ line: number; playerId: string; assigned: boolean }>).filter((row) => row.assigned))
        .toEqual([expect.objectContaining({ line: 3, playerId: pola }), expect.objectContaining({ line: 4, playerId: pola })])

      // Invalid assignments are a 400 with the reason — on preview and on commit alike.
      const invalid: Array<[Record<string, string | null>, string]> = [
        [{ 'Olga Kowalsky': ola }, 'athletes.dailyImport.errors.assignmentPlayerAlreadyMatched'],
        [{ 'Olga Kowalsky': inactive }, 'athletes.dailyImport.errors.assignmentPlayerInactive'],
        [{ 'Olga Kowalsky': foreign }, 'athletes.dailyImport.errors.assignmentPlayerNotInTeam'],
        [{ 'Olga Kowalsky': pola, 'Zuza Nieznana': pola }, 'athletes.dailyImport.errors.assignmentPlayerDuplicate'],
        [{ [`Ola ${lastName}`]: rita }, 'athletes.dailyImport.errors.assignmentUnknownName'],
      ]
      for (const [assignments, error] of invalid) {
        const refusedCommit = await upload('/api/athletes/daily-imports/commit', file, assignments)
        expect(refusedCommit.status, error).toBe(400)
        expect(refusedCommit.body?.error).toBe(error)
      }
      const refusedPreview = await upload('/api/athletes/daily-imports/preview', file, { 'Olga Kowalsky': foreign })
      expect(refusedPreview.status).toBe(400)
      expect(refusedPreview.body?.error).toBe('athletes.dailyImport.errors.assignmentPlayerNotInTeam')
      const malformed = await upload('/api/athletes/daily-imports/commit', file, ['x'] as unknown as Record<string, string>)
      expect(malformed.status).toBe(400)
      expect((await callA('GET', `/api/athletes/training-sessions?teamId=${teamAId}`)).body!.items).toEqual([])
      expect((await callA('GET', '/api/athletes/daily-imports')).body!.items).toEqual([])

      // Commit: one name assigned, the other skipped — its row is rejected with the reason.
      const committed = await upload('/api/athletes/daily-imports/commit', file, { 'Olga Kowalsky': pola, 'Zuza Nieznana': null })
      expect(committed.status).toBe(201)
      expect(committed.body).toMatchObject({
        saved: 3, corrected: 0, unchanged: 0, rejected: 1, assignedNames: 1,
        rejectedRows: [{ line: 5, reason: 'athletes.dailyImport.reasons.nameNotAssigned' }],
      })
      const sessions = (await callA('GET', `/api/athletes/training-sessions?teamId=${teamAId}`)).body!.items as Session[]
      expect(sessions.map((item) => `${item.playerId}|${item.sessionNo}|${item.rpe}`).sort()).toEqual([
        `${ola}|1|6`, `${pola}|1|7`, `${pola}|2|4`,
      ].sort())
      expect(sessions.some((item) => item.playerId === rita)).toBe(false)

      // Club B sees none of club A's sessions or imports.
      expect((await callB('GET', '/api/athletes/training-sessions')).body!.items).toEqual([])
      expect((await callB('GET', `/api/athletes/training-sessions?playerId=${pola}`)).body!.items).toEqual([])
      expect((await callB('GET', '/api/athletes/daily-imports')).body!.items).toEqual([])
      const foreignUndo = await callB('POST', '/api/athletes/daily-imports/undo', { importId: committed.body!.importId })
      expect(foreignUndo.status).toBe(404)
    } finally {
      await deleteOrganizationIfExists(request, admin, clubB)
      await deleteOrganizationIfExists(request, admin, clubA)
    }
  })
})
