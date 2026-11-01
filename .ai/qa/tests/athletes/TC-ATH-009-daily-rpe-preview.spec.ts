import { expect, test, type APIRequestContext } from '@playwright/test'
import ExcelJS from 'exceljs'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'

/**
 * TEST-001 / TEST-004 / TEST-006 RPE part (spec 2026-10-31-e01-dane-dzienne-zawodnikow, phase 1):
 * the preview of an RPE file — `.csv` and `.xlsx` alike — shows the period, the sessions read
 * with load = RPE × minutes only from complete pairs, "Brak RPE" per player and team session,
 * rejected rows with their line and reason and the names without a match, and saves nothing.
 * Two sessions of one day stay two rows; a missing RPE is null, never 0. The "Uwagi", "Ból" and
 * "Kontakt?" columns are ignored and never come back in any response. Wrong files: 413 over
 * 2 MB, 415 for a non-spreadsheet, 400 with the missing column names.
 */

type PreviewRow = {
  line: number
  name: string
  playerId: string
  sessionDate: string
  sessionNo: number
  kind: string | null
  minutes: number | null
  rpe: number | null
  load: number | null
  rpeMissing: boolean
  noMinutes: boolean
  status: string
}
type Preview = {
  period: { from: string; to: string } | null
  counts: Record<string, number>
  rows: PreviewRow[]
  missing: Array<{ playerId: string; sessionDate: string; sessionNo: number; hasRow: boolean }>
  corrections: unknown[]
  rejected: Array<{ line: number; reason: string }>
  unknownNames: Array<{ name: string; rowCount: number }>
  ignoredColumns: string[]
}
type Session = { playerId: string; sessionDate: string; sessionNo: number; minutes: number | null; rpe: number | null; load: number | null; rpeMissing: boolean }
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

/** Multipart upload to the daily-import routes in the selected club. */
function clubUpload(request: APIRequestContext, token: string, selectedOrgId: string) {
  return async (path: string, file: UploadFile, fields: Record<string, string> = {}) => {
    const response = await request.fetch(path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Cookie: `om_selected_org=${selectedOrgId}` },
      multipart: { kind: 'rpe', ...fields, file },
    })
    const text = await response.text()
    let body: Record<string, unknown> | null = null
    try {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : null
    } catch {
      body = null
    }
    return { status: response.status(), body, text }
  }
}

function toCsv(table: Array<Array<string | number | null>>): UploadFile {
  const content = table.map((row) => row.map((cell) => (cell === null ? '' : String(cell))).join(';')).join('\r\n')
  return { name: 'rpe_tydzien.csv', mimeType: 'text/csv', buffer: Buffer.from(`${content}\r\n`, 'utf8') }
}

async function toXlsx(table: Array<Array<string | number | Date | null>>): Promise<UploadFile> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('RPE')
  for (const row of table) sheet.addRow(row)
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
  return {
    name: 'rpe_tydzien.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer,
  }
}

test.describe('TC-ATH-009 daily RPE import preview', () => {
  test('csv and xlsx preview show sessions, load, gaps, rejections and unknown names without saving', async ({ request }) => {
    const admin = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let organizationId: string | null = null
    try {
      organizationId = await createOrganizationFixture(request, admin, { name: `QA daily preview ${stamp}` })
      const call = clubApi(request, admin, organizationId)
      const upload = clubUpload(request, admin, organizationId)

      const team = await call('POST', '/api/athletes/teams', { name: `QA U17 daily ${stamp}` })
      expect(team.status).toBe(201)
      const teamId = String(team.body!.id)
      const lastName = `Rpe${stamp}`
      const players: Record<string, string> = {}
      for (const firstName of ['Anna', 'Beata', 'Celina']) {
        const created = await call('POST', '/api/athletes/players', {
          teamId, firstName, lastName, birthDate: '2009-04-04', joinedAt: '2025-01-01',
        })
        expect(created.status).toBe(201)
        players[firstName] = String(created.body!.id)
      }

      const day1 = daysAgo(3)
      const day2 = daysAgo(2)
      const secret = `QA-SECRET-${stamp}`
      const header = ['Zawodnik', 'Data', 'Nr sesji', 'Rodzaj', 'Minuty', 'RPE', 'Uwagi', 'Ból', 'Kontakt?']
      const data: Array<Array<string | number | null>> = [
        [`Anna ${lastName}`, day1, 1, 'trening', 60, 7, `${secret}-uwagi`, `${secret}-bol`, `${secret}-kontakt`], // line 2
        [`Anna ${lastName}`, day1, 2, 'siłownia', 30, 5, null, null, null], // line 3: second session of the day
        [`Beata ${lastName}`, day1, 1, 'trening', 60, null, null, null, null], // line 4: "Brak RPE"
        [`Celina ${lastName}`, day1, 1, 'trening', null, 6, null, null, null], // line 5: RPE without minutes
        [`Beata ${lastName}`, day2, 1, 'trening', 45, 12, null, null, null], // line 6: RPE out of 0–10
        [`Anna ${lastName}`, day2, 1, 'trening', 45, 8, null, null, null], // line 7
        [`Celina ${lastName}`, '31.02.2025', 1, 'trening', 45, 6, null, null, null], // line 8: impossible date
        ['Jan Kowalsky', day2, 1, 'trening', 45, 6, null, null, null], // line 9: unknown name
      ]
      const csv = toCsv([header, ...data])
      // In the xlsx the dates are real date cells.
      const xlsx = await toXlsx([
        header,
        ...data.map((row) => row.map((cell, index) => (index === 1 && /^\d{4}-/.test(String(cell)) ? new Date(`${cell}T00:00:00Z`) : cell))),
      ])

      const expectPreview = (preview: Preview) => {
        expect(preview.period).toEqual({ from: day1, to: day2 })
        const byLine = Object.fromEntries(preview.rows.map((row) => [row.line, row]))
        expect(Object.keys(byLine).map(Number).sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 7])
        expect(byLine[2]).toMatchObject({ playerId: players.Anna, sessionDate: day1, sessionNo: 1, minutes: 60, rpe: 7, load: 420, rpeMissing: false, status: 'new' })
        expect(byLine[3]).toMatchObject({ playerId: players.Anna, sessionDate: day1, sessionNo: 2, minutes: 30, rpe: 5, load: 150 })
        expect(byLine[4]).toMatchObject({ playerId: players.Beata, minutes: 60, rpe: null, load: null, rpeMissing: true, noMinutes: false })
        expect(byLine[5]).toMatchObject({ playerId: players.Celina, minutes: null, rpe: 6, load: null, rpeMissing: false, noMinutes: true })
        expect(byLine[7]).toMatchObject({ playerId: players.Anna, sessionDate: day2, load: 360 })
        expect(preview.rows.some((row) => row.load === 0 || row.rpe === 0)).toBe(false)

        expect(preview.rejected).toEqual([
          { line: 6, reason: 'athletes.dailyImport.reasons.rpeInvalid' },
          { line: 8, reason: 'athletes.dailyImport.reasons.dateInvalid' },
          { line: 9, reason: 'athletes.dailyImport.reasons.nameNotAssigned' },
        ])
        expect(preview.unknownNames).toEqual([{ name: 'Jan Kowalsky', rowCount: 1 }])

        // "Brak RPE" per player and team session: a row without RPE, or no row at all.
        const missing = preview.missing.map((entry) => `${entry.playerId}|${entry.sessionDate}|${entry.sessionNo}|${entry.hasRow}`).sort()
        expect(missing).toEqual([
          `${players.Beata}|${day1}|1|true`,
          `${players.Beata}|${day1}|2|false`,
          `${players.Celina}|${day1}|2|false`,
          `${players.Beata}|${day2}|1|false`,
          `${players.Celina}|${day2}|1|false`,
        ].sort())
        expect(preview.counts).toMatchObject({ rows: 5, saved: 5, corrected: 0, unchanged: 0, rejected: 3, missing: 5, assignedNames: 0 })
        expect(preview.corrections).toEqual([])
        expect(preview.ignoredColumns).toEqual(['Uwagi', 'Ból', 'Kontakt?'])
      }

      // TEST-001: csv preview.
      const csvPreview = await upload('/api/athletes/daily-imports/preview', csv)
      expect(csvPreview.status).toBe(200)
      expectPreview(csvPreview.body as unknown as Preview)
      expect(csvPreview.text).not.toContain(secret)

      // TEST-001: the same data as xlsx gives the same preview.
      const xlsxPreview = await upload('/api/athletes/daily-imports/preview', xlsx)
      expect(xlsxPreview.status).toBe(200)
      expectPreview(xlsxPreview.body as unknown as Preview)
      expect(xlsxPreview.text).not.toContain(secret)

      // Nothing was saved by either preview.
      const afterPreview = await call('GET', `/api/athletes/training-sessions?teamId=${teamId}`)
      expect(afterPreview.status).toBe(200)
      expect(afterPreview.body!.items).toEqual([])
      expect((await call('GET', '/api/athletes/daily-imports?kind=rpe')).body!.items).toEqual([])

      // TEST-004 / TEST-006: after the commit the read has load only from complete pairs,
      // "Brak RPE" as null, and none of the ignored columns anywhere.
      const committed = await upload('/api/athletes/daily-imports/commit', xlsx)
      expect(committed.status).toBe(201)
      expect(committed.body).toMatchObject({ saved: 5, corrected: 0, unchanged: 0, rejected: 3, periodFrom: day1, periodTo: day2 })
      expect(committed.text).not.toContain(secret)
      const sessions = await call('GET', `/api/athletes/training-sessions?teamId=${teamId}&from=${day1}&to=${day2}`)
      expect(sessions.status).toBe(200)
      const items = sessions.body!.items as Session[]
      expect(items).toHaveLength(5)
      const annaDay1 = items.filter((item) => item.playerId === players.Anna && item.sessionDate === day1).sort((a, b) => a.sessionNo - b.sessionNo)
      expect(annaDay1.map((item) => [item.sessionNo, item.rpe, item.minutes, item.load])).toEqual([[1, 7, 60, 420], [2, 5, 30, 150]])
      expect(items.find((item) => item.playerId === players.Beata)).toMatchObject({ rpe: null, load: null, rpeMissing: true, minutes: 60 })
      expect(items.find((item) => item.playerId === players.Celina)).toMatchObject({ rpe: 6, minutes: null, load: null, rpeMissing: false })
      expect(items.some((item) => item.load === 0 || item.rpe === 0)).toBe(false)
      expect(JSON.stringify(sessions.body)).not.toContain(secret)
      const history = await call('GET', '/api/athletes/daily-imports?kind=rpe')
      expect(history.status).toBe(200)
      const imports = history.body!.items as Array<{ fileName: string; rejectedRows: Array<{ line: number; reason: string }> }>
      expect(imports).toHaveLength(1)
      expect(imports[0].fileName).toBe('rpe_tydzien.xlsx')
      expect(imports[0].rejectedRows.map((row) => row.line)).toEqual([6, 8, 9])
      expect(JSON.stringify(history.body)).not.toContain(secret)
      expect(JSON.stringify(history.body)).not.toContain('Kowalsky')

      // Wrong files: missing columns, not a spreadsheet, over 2 MB, missing file.
      const noRpe = await upload('/api/athletes/daily-imports/preview', toCsv([['Zawodnik', 'Data', 'Minuty'], [`Anna ${lastName}`, day1, 60]]))
      expect(noRpe.status).toBe(400)
      expect(noRpe.body).toMatchObject({ error: 'athletes.dailyImport.errors.missingColumns', columns: ['sessionNo', 'rpe'] })
      const notSpreadsheet = await upload('/api/athletes/daily-imports/preview', {
        name: 'rpe.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('%PDF-1.4 not a workbook'),
      })
      expect(notSpreadsheet.status).toBe(415)
      expect(notSpreadsheet.body?.error).toBe('athletes.dailyImport.errors.unsupportedType')
      const binaryCsv = await upload('/api/athletes/daily-imports/preview', { name: 'rpe.csv', mimeType: 'text/csv', buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]) })
      expect(binaryCsv.status).toBe(415)
      const tooLarge = await upload('/api/athletes/daily-imports/commit', {
        name: 'rpe_duzy.csv', mimeType: 'text/csv', buffer: Buffer.alloc(2 * 1024 * 1024 + 1024, 'a'),
      })
      expect(tooLarge.status).toBe(413)
      expect(tooLarge.body?.error).toBe('athletes.dailyImport.errors.fileTooLarge')
      const noFile = await apiRequestWithSelectedOrg(request, 'POST', '/api/athletes/daily-imports/preview', {
        token: admin, selectedOrgId: organizationId, data: { kind: 'rpe' },
      })
      expect(noFile.status()).toBe(415)

      // The rejected uploads saved nothing more.
      expect((await call('GET', '/api/athletes/daily-imports?kind=rpe')).body!.items as unknown[]).toHaveLength(1)
    } finally {
      await deleteOrganizationIfExists(request, admin, organizationId)
    }
  })
})
