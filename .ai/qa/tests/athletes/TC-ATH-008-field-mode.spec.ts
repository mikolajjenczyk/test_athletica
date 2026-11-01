import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'

/**
 * TEST-005 / TEST-012 (spec 2026-10-28-e02-testy-i-wyniki): "Field mode" at 390 px — attempts
 * from the keypad, "Next", "Did not perform" with a reason, entry blocked without a connection
 * and unblocked when it returns, "Finish test" with its summary; the test set shows
 * "Test in progress · Back to test", fits 1024 px in light and dark mode, and a test that has
 * not taken place shows its empty state.
 */

async function selectOrganization(page: Page, organizationId: string): Promise<void> {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
  await page.context().addCookies([{ name: 'om_selected_org', value: organizationId, url: baseUrl, sameSite: 'Lax' }])
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
}

type Definition = { id: string; templateKey: string; name: string; variant: string | null }

/** A club with one team of two players and the template catalog; returns ids for the test. */
async function createClubWithTeam(request: APIRequestContext, token: string, organizationId: string, stamp: number) {
  const call = async (method: string, path: string, data?: unknown) => {
    const response = await apiRequestWithSelectedOrg(request, method, path, { token, selectedOrgId: organizationId, data })
    return { status: response.status(), body: (await response.json().catch(() => null)) as Record<string, unknown> | null }
  }
  await expect.poll(async () => ((await call('GET', '/api/athletes/test-definitions?activeOnly=true')).body?.items as unknown[] | undefined)?.length ?? 0).toBe(6)
  const definitions = (await call('GET', '/api/athletes/test-definitions?activeOnly=true')).body!.items as Definition[]
  const team = await call('POST', '/api/athletes/teams', { name: `QA U14 ${stamp}` })
  expect(team.status).toBe(201)
  const teamId = String(team.body!.id)
  for (const firstName of ['Hania', 'Iga']) {
    const player = await call('POST', '/api/athletes/players', {
      teamId, firstName, lastName: `Field${stamp}`, birthDate: '2012-02-02', joinedAt: '2025-01-01',
    })
    expect(player.status).toBe(201)
  }
  return { call, definitions, teamId }
}

test.describe('TC-ATH-008 field mode and test pages', () => {
  test('field mode records attempts and a reason, blocks entry offline and finishes with a summary', async ({ page, request }) => {
    const admin = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let organizationId: string | null = null
    try {
      organizationId = await createOrganizationFixture(request, admin, { name: `QA field mode ${stamp}` })
      const { call, definitions, teamId } = await createClubWithTeam(request, admin, organizationId, stamp)
      const sprint = definitions.find((definition) => definition.templateKey === 'sprint_10m')!
      const started = await call('POST', '/api/athletes/test-sessions', { testDefinitionId: sprint.id, teamId, testedOn: '2025-03-03' })
      expect(started.status).toBe(201)
      const sessionId = String(started.body!.id)

      await page.setViewportSize({ width: 390, height: 844 })
      await login(page, 'admin')
      await selectOrganization(page, organizationId)
      await page.goto(`/backend/tests/field/${sessionId}`)
      const main = page.getByRole('main')
      await expect(main.getByRole('heading', { level: 1, name: /^Sprint 10 m · start wysoki · / })).toBeVisible()
      await expect(main.getByText('saved 0 of 2')).toBeVisible()
      await expectNoHorizontalScroll(page)

      const keypad = main.getByRole('group', { name: 'Keypad' })
      const next = main.getByRole('button', { name: 'Next', exact: true })
      // Field targets are at least 48 px high.
      for (const target of [next, keypad.getByRole('button', { name: '1', exact: true }), main.getByRole('button', { name: 'Did not perform' })]) {
        expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(47.5)
      }

      // First player: attempt 1 from the keypad, attempt 2 typed, attempt 3 invalid.
      await main.getByRole('textbox', { name: 'Attempt 1' }).click()
      for (const key of ['2', 'Decimal point', '1']) await keypad.getByRole('button', { name: key, exact: true }).click()
      await expect(main.getByRole('textbox', { name: 'Attempt 1' })).toHaveValue('2.1')
      await main.getByRole('textbox', { name: 'Attempt 2' }).fill('2.05')
      await main.getByRole('textbox', { name: 'Attempt 3' }).click()
      await main.getByRole('button', { name: 'Invalid attempt' }).click()
      await next.click()
      await expect(main.getByText('saved 1 of 2')).toBeVisible()

      // No connection: the banner shows what is saved and the keypad is disabled.
      await page.context().setOffline(true)
      await expect(main.getByText('No connection — entry blocked')).toBeVisible()
      await expect(main.getByText('Saved 1 of 2 players.')).toBeVisible()
      await expect(keypad.getByRole('button', { name: '1', exact: true })).toBeDisabled()
      await expect(next).toBeDisabled()
      await expect(main.getByRole('button', { name: 'Finish test' })).toBeDisabled()
      await page.context().setOffline(false)
      await expect(main.getByText('No connection — entry blocked')).toHaveCount(0)
      await expect(keypad.getByRole('button', { name: '1', exact: true })).toBeEnabled()

      // Second player: "Did not perform" with a reason, from the keyboard.
      await main.getByRole('button', { name: 'Did not perform' }).focus()
      await page.keyboard.press('Enter')
      await main.getByRole('group', { name: '“Did not perform” reason' }).getByRole('button', { name: 'Absent' }).click()
      await expect(main.getByText('Did not perform: Absent')).toBeVisible()
      await next.click()
      await expect(main.getByText('saved 2 of 2')).toBeVisible()

      await main.getByRole('button', { name: 'Finish test' }).click()
      const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
      await expect(dialog.getByText('Every player has saved data.')).toBeVisible()
      await dialog.getByRole('button', { name: 'Finish test' }).click()
      await expect(page.getByRole('main').getByRole('heading', { level: 1, name: /^Test finished: Sprint 10 m · start wysoki/ })).toBeVisible()
      const summary = page.getByRole('main').getByRole('definition')
      await expect(summary).toHaveText(['1', '1', '0'])
      await expect(page.getByRole('main').getByText('Players in the test: 2.')).toBeVisible()
      await expect(page.getByRole('main').getByRole('link', { name: 'View results' })).toHaveAttribute('href', `/backend/tests/${sprint.id}`)

      const results = await call('GET', `/api/athletes/test-results?sessionId=${sessionId}`)
      const items = results.body!.items as Array<{ value: number | null; state: string; reasonCode?: string | null }>
      expect(items).toHaveLength(2)
      expect(items.find((item) => item.state === 'recorded')?.value).toBe(2.05)
      expect(items.find((item) => item.state === 'not_performed')).toMatchObject({ value: null, reasonCode: 'absent' })
    } finally {
      await page.context().setOffline(false).catch(() => undefined)
      await deleteOrganizationIfExists(request, admin, organizationId)
    }
  })

  test('test set shows the open test, fits 1024 px in light and dark mode; an unrun test is empty', async ({ page, request }) => {
    const admin = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let organizationId: string | null = null
    try {
      organizationId = await createOrganizationFixture(request, admin, { name: `QA test pages ${stamp}` })
      const { call, definitions, teamId } = await createClubWithTeam(request, admin, organizationId, stamp)
      const sprint = definitions.find((definition) => definition.templateKey === 'sprint_10m')!
      const jump = definitions.find((definition) => definition.templateKey === 'cmj')!
      const started = await call('POST', '/api/athletes/test-sessions', { testDefinitionId: sprint.id, teamId, testedOn: '2025-03-03' })
      expect(started.status).toBe(201)
      const sessionId = String(started.body!.id)

      await page.setViewportSize({ width: 1024, height: 768 })
      await login(page, 'admin')
      await selectOrganization(page, organizationId)

      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme })

        await page.goto('/backend/tests')
        const catalog = page.getByRole('main')
        await expect(catalog.getByRole('heading', { name: 'Test set', level: 1 })).toBeVisible()
        await expect(catalog.getByText('Active tests: 6.')).toBeVisible()
        await expect(catalog.getByRole('link', { name: 'Test in progress · Back to test: Sprint 10 m · start wysoki' }))
          .toHaveAttribute('href', `/backend/tests/field/${sessionId}`)
        await expect(catalog.getByRole('link', { name: `Start test: ${jump.name}` }))
          .toHaveAttribute('href', `/backend/tests/start?testDefinitionId=${jump.id}`)
        await expectNoHorizontalScroll(page)

        await page.goto(`/backend/tests/${jump.id}`)
        const view = page.getByRole('main')
        await expect(view.getByRole('heading', { name: jump.name, level: 1 })).toBeVisible()
        await expect(view.getByText('This test has not taken place yet')).toBeVisible()
        await expect(view.getByRole('link', { name: 'Start test' })).toHaveAttribute('href', `/backend/tests/start?testDefinitionId=${jump.id}`)
        await expectNoHorizontalScroll(page)
      }

      // "Start test" for the same team and test leads back into the open session.
      await page.goto(`/backend/tests/start?testDefinitionId=${sprint.id}`)
      const start = page.getByRole('main')
      await expect(start.getByRole('heading', { name: 'Start test', level: 1 })).toBeVisible()
      await start.getByRole('button', { name: 'Start test' }).last().click()
      await expect(page).toHaveURL(new RegExp(`/backend/tests/field/${sessionId}`))
      await expect(page.getByRole('main').getByText('saved 0 of 2')).toBeVisible()
    } finally {
      await deleteOrganizationIfExists(request, admin, organizationId)
    }
  })
})
