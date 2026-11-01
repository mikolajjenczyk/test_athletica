import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'

/**
 * TEST-003 / TEST-013 import and undo (spec 2026-10-31-e01-dane-dzienne-zawodnikow, phase 1):
 * committing the same file again changes nothing ("bez zmian", no duplicates); a file with a
 * changed RPE is a correction old → new with the previous value kept. The history lists every
 * import; only the latest one of the team can be undone (an older one is 409); undoing the
 * correction restores the previous values and undoing the first import removes its rows.
 */

type UploadFile = { name: string; mimeType: string; buffer: Buffer }
type Session = {
  id: string
  playerId: string
  sessionDate: string
  sessionNo: number
  minutes: number | null
  rpe: number | null
  load: number | null
  previousRpe: number | null
  previousMinutes: number | null
  correctedAt: string | null
  importId: string
}
type ImportItem = { id: string; fileName: string; saved: number; corrected: number; unchanged: number; canUndo: boolean; undoneAt: string | null }

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

function clubUpload(request: APIRequestContext, token: string, selectedOrgId: string) {
  return async (path: string, file: UploadFile) => {
    const response = await request.fetch(path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Cookie: `om_selected_org=${selectedOrgId}` },
      multipart: { kind: 'rpe', file },
    })
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
    return { status: response.status(), body }
  }
}

function toCsv(name: string, table: Array<Array<string | number | null>>): UploadFile {
  const content = table.map((row) => row.map((cell) => (cell === null ? '' : String(cell))).join(',')).join('\n')
  return { name, mimeType: 'text/csv', buffer: Buffer.from(content, 'utf8') }
}

test.describe('TC-ATH-011 daily RPE re-import, corrections and undo', () => {
  test('re-import is unchanged, a changed RPE is a correction, and only the latest import can be undone', async ({ request }) => {
    const admin = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let organizationId: string | null = null
    try {
      organizationId = await createOrganizationFixture(request, admin, { name: `QA daily undo ${stamp}` })
      const call = clubApi(request, admin, organizationId)
      const upload = clubUpload(request, admin, organizationId)

      const team = await call('POST', '/api/athletes/teams', { name: `QA U19 ${stamp}` })
      expect(team.status).toBe(201)
      const teamId = String(team.body!.id)
      const lastName = `Undo${stamp}`
      const players: Record<string, string> = {}
      for (const firstName of ['Kasia', 'Lena']) {
        const created = await call('POST', '/api/athletes/players', { teamId, firstName, lastName, birthDate: '2008-08-08', joinedAt: '2025-01-01' })
        expect(created.status).toBe(201)
        players[firstName] = String(created.body!.id)
      }

      const day = daysAgo(4)
      const header = ['Zawodnik', 'Data', 'Nr sesji', 'Rodzaj', 'Minuty', 'RPE']
      const original = toCsv('rpe_v1.csv', [
        header,
        [`Kasia ${lastName}`, day, 1, 'trening', 60, 6],
        [`Lena ${lastName}`, day, 1, 'trening', 60, null],
      ])
      const changed = toCsv('rpe_v2.csv', [
        header,
        [`Kasia ${lastName}`, day, 1, 'trening', 70, 8], // corrected minutes and RPE
        [`Lena ${lastName}`, day, 1, 'trening', 60, null], // unchanged "Brak RPE"
        [`Lena ${lastName}`, day, 2, 'rozruch', 20, 3], // new
      ])
      const sessions = async () =>
        ((await call('GET', `/api/athletes/training-sessions?teamId=${teamId}`)).body!.items as Session[])
          .slice()
          .sort((a, b) => `${a.playerId}${a.sessionNo}`.localeCompare(`${b.playerId}${b.sessionNo}`))
      const history = async () => (await call('GET', '/api/athletes/daily-imports?kind=rpe')).body!.items as ImportItem[]

      const first = await upload('/api/athletes/daily-imports/commit', original)
      expect(first.status).toBe(201)
      expect(first.body).toMatchObject({ saved: 2, corrected: 0, unchanged: 0, rejected: 0 })
      const firstId = String(first.body!.importId)
      const afterFirst = await sessions()
      expect(afterFirst).toHaveLength(2)

      // Same file again: the preview and the commit report everything unchanged; no duplicates.
      const samePreview = await upload('/api/athletes/daily-imports/preview', original)
      expect(samePreview.status).toBe(200)
      expect(samePreview.body!.counts).toMatchObject({ rows: 2, saved: 0, corrected: 0, unchanged: 2 })
      const second = await upload('/api/athletes/daily-imports/commit', original)
      expect(second.status).toBe(201)
      expect(second.body).toMatchObject({ saved: 0, corrected: 0, unchanged: 2, rejected: 0 })
      const secondId = String(second.body!.importId)
      expect(await sessions()).toEqual(afterFirst)

      // Changed file: the preview shows old → new before anything is written.
      const changedPreview = await upload('/api/athletes/daily-imports/preview', changed)
      expect(changedPreview.status).toBe(200)
      expect(changedPreview.body!.counts).toMatchObject({ rows: 3, saved: 1, corrected: 1, unchanged: 1 })
      expect(changedPreview.body!.corrections).toEqual([{
        line: 2,
        playerId: players.Kasia,
        sessionDate: day,
        sessionNo: 1,
        before: { kind: 'trening', minutes: 60, rpe: 6 },
        after: { kind: 'trening', minutes: 70, rpe: 8 },
      }])
      const third = await upload('/api/athletes/daily-imports/commit', changed)
      expect(third.status).toBe(201)
      expect(third.body).toMatchObject({ saved: 1, corrected: 1, unchanged: 1, rejected: 0 })
      const thirdId = String(third.body!.importId)
      const afterThird = await sessions()
      expect(afterThird).toHaveLength(3)
      const kasia = afterThird.find((item) => item.playerId === players.Kasia)!
      expect(kasia).toMatchObject({ minutes: 70, rpe: 8, load: 560, previousMinutes: 60, previousRpe: 6, importId: thirdId })
      expect(kasia.correctedAt).toBeTruthy()
      expect(kasia.id).toBe(afterFirst.find((item) => item.playerId === players.Kasia)!.id)
      expect(afterThird.find((item) => item.playerId === players.Lena && item.sessionNo === 1)).toMatchObject({ rpe: null, load: null, importId: firstId })

      // History: newest first, only the latest one can be undone.
      const listed = await history()
      expect(listed.map((item) => item.id)).toEqual([thirdId, secondId, firstId])
      expect(listed.map((item) => item.canUndo)).toEqual([true, false, false])

      // An older import is a 409 and changes nothing.
      const olderUndo = await call('POST', '/api/athletes/daily-imports/undo', { importId: firstId })
      expect(olderUndo.status).toBe(409)
      expect(olderUndo.body?.error).toBe('athletes.dailyImport.errors.notLatestImport')
      expect(await sessions()).toEqual(afterThird)

      // Undo of the correction import restores the previous values and removes its new row.
      const undoThird = await call('POST', '/api/athletes/daily-imports/undo', { importId: thirdId })
      expect(undoThird.status).toBe(200)
      expect(undoThird.body).toMatchObject({ ok: true, importId: thirdId })
      const afterUndoThird = await sessions()
      expect(afterUndoThird.map(({ id, playerId, sessionNo, minutes, rpe, previousRpe, previousMinutes, correctedAt, importId }) => (
        { id, playerId, sessionNo, minutes, rpe, previousRpe, previousMinutes, correctedAt, importId }
      ))).toEqual(afterFirst.map(({ id, playerId, sessionNo, minutes, rpe, previousRpe, previousMinutes, correctedAt, importId }) => (
        { id, playerId, sessionNo, minutes, rpe, previousRpe, previousMinutes, correctedAt, importId }
      )))
      const againUndo = await call('POST', '/api/athletes/daily-imports/undo', { importId: thirdId })
      expect(againUndo.status).toBe(409)
      expect(againUndo.body?.error).toBe('athletes.dailyImport.errors.alreadyUndone')
      const afterUndoList = await history()
      expect(afterUndoList.find((item) => item.id === thirdId)?.undoneAt).toBeTruthy()
      expect(afterUndoList.find((item) => item.id === secondId)?.canUndo).toBe(true)

      // The "unchanged" import, then the first one: its rows are gone.
      expect((await call('POST', '/api/athletes/daily-imports/undo', { importId: secondId })).status).toBe(200)
      const undoFirst = await call('POST', '/api/athletes/daily-imports/undo', { importId: firstId })
      expect(undoFirst.status).toBe(200)
      expect(await sessions()).toEqual([])
      expect((await history()).every((item) => item.undoneAt && !item.canUndo)).toBe(true)

      // After undoing everything the same file imports as new again.
      const reimported = await upload('/api/athletes/daily-imports/commit', original)
      expect(reimported.status).toBe(201)
      expect(reimported.body).toMatchObject({ saved: 2, corrected: 0, unchanged: 0 })

      const unknown = await call('POST', '/api/athletes/daily-imports/undo', { importId: randomUUID() })
      expect(unknown.status).toBe(404)
      expect((await call('POST', '/api/athletes/daily-imports/undo', { importId: 'not-a-uuid' })).status).toBe(400)
    } finally {
      await deleteOrganizationIfExists(request, admin, organizationId)
    }
  })
})
