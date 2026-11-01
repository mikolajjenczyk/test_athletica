import path from 'node:path'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'

/**
 * TEST-010 (spec 2026-10-31-e01-dane-dzienne-zawodnikow, phase 1) and journey J-001 in the
 * browser: a coach at 1280 px chooses an RPE file, sees the preview (summary, sessions,
 * "Brak RPE", rejected rows with line and reason, names without a match), assigns the unknown
 * name, saves and sees the result announced; "Daily data" then lists the sessions with
 * "No RPE" instead of 0 and the import history, from which the import is undone after a
 * confirmation. At 390 px the import page asks for a computer instead.
 */

const SCREENSHOT_DIR = path.join(process.cwd(), '.ai', 'qa', 'test-results', 'screenshots', 'TC-ATH-013')

function daysAgo(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

async function screenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: true })
}

/** Signs a club user in through the login API (cookies land in the page context). */
async function loginAs(page: Page, email: string, password: string): Promise<void> {
  const form = new URLSearchParams({ email, password })
  const response = await page.request.post('/api/auth/login', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  })
  expect(response.ok()).toBe(true)
}

function clubApi(request: APIRequestContext, token: string, selectedOrgId: string) {
  return async (method: string, apiPath: string, data?: unknown) => {
    const response = await apiRequestWithSelectedOrg(request, method, apiPath, { token, selectedOrgId, data })
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
    return { status: response.status(), body }
  }
}

test.describe('TC-ATH-013 daily RPE import in the browser', () => {
  test('coach previews, assigns a name, saves, sees the sessions and undoes the import', async ({ page, request }) => {
    const admin = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const password = `Qa-${stamp}-Ff6!`
    const coachEmail = `qa-daily-ui-coach-${stamp}@example.test`
    let organizationId: string | null = null
    let coachId: string | null = null
    try {
      organizationId = await createOrganizationFixture(request, admin, { name: `QA daily UI ${stamp}` })
      const call = clubApi(request, admin, organizationId)
      const team = await call('POST', '/api/athletes/teams', { name: `QA U16 UI ${stamp}` })
      expect(team.status).toBe(201)
      const teamId = String(team.body!.id)
      const lastName = `Ui${stamp}`
      for (const firstName of ['Hanna', 'Irena', 'Julia']) {
        const created = await call('POST', '/api/athletes/players', { teamId, firstName, lastName, birthDate: '2010-10-10', joinedAt: '2025-01-01' })
        expect(created.status).toBe(201)
      }
      const coachCreated = await apiRequest(request, 'POST', '/api/auth/users', {
        token: admin,
        data: { email: coachEmail, password, organizationId, roles: ['coach'], name: 'QA Coach' },
      })
      expect(coachCreated.status()).toBe(201)
      coachId = ((await coachCreated.json()) as { id: string }).id

      const day = daysAgo(1)
      const csv = [
        'Zawodnik;Data;Nr sesji;Rodzaj;Minuty;RPE;Uwagi',
        `Hanna ${lastName};${day};1;trening;60;7;`,
        `Irena ${lastName};${day};1;trening;60;;`,
        `Hanna ${lastName};${day};2;siłownia;30;15;`,
        `Juli ${lastName};${day};1;trening;45;5;`,
      ].join('\n')
      const fileName = `rpe_ui_${stamp}.csv`

      await page.setViewportSize({ width: 1280, height: 900 })
      await loginAs(page, coachEmail, password)
      await page.goto('/backend/daily/import?kind=rpe')
      const main = page.getByRole('main')
      await expect(main.getByRole('heading', { level: 1, name: 'Upload RPE file' })).toBeVisible()
      await main.locator('input[type="file"]').setInputFiles({ name: fileName, mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') })
      await main.getByRole('button', { name: 'Show preview' }).click()

      // Preview: summary, nothing saved yet, sessions, missing RPE, rejected rows, unknown name.
      const summary = main.getByRole('region', { name: 'Preview summary' })
      await expect(summary).toBeVisible()
      await expect(main.getByText('This is a preview — nothing has been saved yet.')).toBeVisible()
      await expect(page.getByRole('status').filter({ hasText: 'Preview ready: 2 sessions read, 2 rows rejected.' })).toBeAttached()
      await expect(main.getByRole('region', { name: 'Missing RPE' })).toContainText('No RPE')
      const rejected = main.getByRole('region', { name: 'Rejected rows' })
      await expect(rejected).toContainText('Line 4 — ')
      await expect(rejected).toContainText('Line 5 — ')
      const assign = main.getByRole('region', { name: 'Names without a match' })
      const select = assign.getByRole('combobox', { name: `Player for “Juli ${lastName}”` })
      await expect(select).toBeVisible()
      await expect(select).toBeFocused()
      await screenshot(page, '01-preview')

      // Only the unmatched player is offered; choosing her recomputes the preview.
      await select.click()
      await expect(page.getByRole('option', { name: 'Skip' })).toBeVisible()
      await expect(page.getByRole('option', { name: new RegExp(`Hanna`) })).toHaveCount(0)
      await page.getByRole('option', { name: new RegExp(`Julia`) }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Preview ready: 3 sessions read, 1 rows rejected.' })).toBeAttached()
      await expect(rejected).not.toContainText('Line 5 — ')
      await screenshot(page, '02-assigned')

      await main.getByRole('button', { name: 'Save' }).click()
      await expect(main.getByText('Import saved')).toBeVisible()
      await expect(page.getByRole('status').filter({ hasText: 'Saved: 3 · Corrected: 0 · Unchanged: 0 · Rejected: 1' })).toBeAttached()
      await screenshot(page, '03-saved')

      // Daily data: sessions with "No RPE" (never 0) and the import history.
      await main.getByRole('link', { name: 'Go to daily data' }).click()
      await expect(page).toHaveURL(/\/backend\/daily(?:\?|$)/)
      const daily = page.getByRole('main')
      await expect(daily.getByRole('heading', { level: 1, name: 'Daily data' })).toBeVisible()
      const sessions = daily.getByRole('region', { name: 'RPE sessions' })
      await expect(sessions.getByRole('row')).toHaveCount(4)
      await expect(sessions).toContainText('No RPE')
      await expect(sessions).toContainText('420')
      const history = daily.getByRole('region', { name: 'Import history' })
      await expect(history).toContainText(fileName)
      await screenshot(page, '04-daily-data')

      await history.getByRole('button', { name: `Undo import ${fileName}` }).click()
      const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
      await expect(dialog.getByText('Undo the latest import?')).toBeVisible()
      await dialog.getByRole('button', { name: 'Undo', exact: true }).click()
      await expect(sessions.getByText('No sessions in the selected period')).toBeVisible()
      await expect(history.getByRole('button', { name: `Undo import ${fileName}` })).toHaveCount(0)
      await expect(history).toContainText('Undone')
      await screenshot(page, '05-undone')
      expect((await call('GET', `/api/athletes/training-sessions?teamId=${teamId}`)).body!.items).toEqual([])

      // On a phone the import page asks for a computer.
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto('/backend/daily/import?kind=rpe')
      await expect(page.getByRole('main').getByText('Upload the file on a computer')).toBeVisible()
      await expect(page.getByRole('main').getByRole('button', { name: 'Show preview' })).toBeHidden()
      await screenshot(page, '06-phone')
    } finally {
      await deleteUserIfExists(request, admin, coachId)
      await deleteOrganizationIfExists(request, admin, organizationId)
    }
  })
})
