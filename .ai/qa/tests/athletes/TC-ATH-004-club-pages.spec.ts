import { expect, test, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'

/**
 * TEST-006 / TEST-011 (spec 2026-10-28-e06-cele-zalecenia-klub): "Hide names" hides every
 * name on the athletes screens and survives a reload; the club pages render their empty
 * states, fit 1024 px without horizontal scrolling in light and dark mode, the toggle works
 * from the keyboard, and club data deletion stays disabled until the exact club name is typed.
 */

async function selectOrganization(page: Page, organizationId: string): Promise<void> {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
  await page.context().addCookies([{ name: 'om_selected_org', value: organizationId, url: baseUrl, sameSite: 'Lax' }])
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
}

test.describe('TC-ATH-004 club pages', () => {
  test('hide names covers players and accounts and persists across reloads', async ({ page, request }) => {
    const admin = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const clubName = `QA club pages ${stamp}`
    let organizationId: string | null = null
    try {
      organizationId = await createOrganizationFixture(request, admin, { name: clubName })
      const team = await apiRequestWithSelectedOrg(request, 'POST', '/api/athletes/teams', {
        token: admin,
        selectedOrgId: organizationId,
        data: { name: `QA U15 ${stamp}` },
      })
      expect(team.status()).toBe(201)
      const teamId = ((await team.json()) as { id: string }).id
      const lastName = `Zielinska${stamp}`
      const player = await apiRequestWithSelectedOrg(request, 'POST', '/api/athletes/players', {
        token: admin,
        selectedOrgId: organizationId,
        data: { teamId, firstName: 'Marta', lastName, birthDate: '2012-04-04', joinedAt: '2025-01-10' },
      })
      expect(player.status()).toBe(201)

      await login(page, 'admin')
      await selectOrganization(page, organizationId)
      await page.goto('/backend/players')
      const main = page.getByRole('main')
      await expect(main.getByText(`Marta ${lastName}`)).toBeVisible()

      const toggle = main.getByRole('switch', { name: 'Hide names' })
      await toggle.focus()
      await page.keyboard.press('Space')
      await expect(toggle).toHaveAttribute('aria-checked', 'true')
      await expect(main.getByText(lastName)).toHaveCount(0)
      await expect(main.getByText('M. Z.')).toBeVisible()

      await page.reload()
      await expect(page.getByRole('main').getByRole('switch', { name: 'Hide names' })).toHaveAttribute('aria-checked', 'true')
      await expect(page.getByRole('main').getByText(lastName)).toHaveCount(0)

      await page.goto('/backend/accounts')
      const accountsToggle = page.getByRole('main').getByRole('switch', { name: 'Hide names' })
      await expect(accountsToggle).toHaveAttribute('aria-checked', 'true')
      await accountsToggle.click()
      await expect(accountsToggle).toHaveAttribute('aria-checked', 'false')

      await page.goto('/backend/players')
      await expect(page.getByRole('main').getByText(`Marta ${lastName}`)).toBeVisible()
    } finally {
      await deleteOrganizationIfExists(request, admin, organizationId)
    }
  })

  test('club pages render empty states, fit 1024 px in light and dark mode, and guard deletion', async ({ page, request }) => {
    const admin = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const clubName = `QA empty club ${stamp}`
    let organizationId: string | null = null
    try {
      organizationId = await createOrganizationFixture(request, admin, { name: clubName })
      await page.setViewportSize({ width: 1024, height: 768 })
      await login(page, 'admin')
      await selectOrganization(page, organizationId)

      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme })

        await page.goto('/backend/club')
        const club = page.getByRole('main')
        await expect(club.getByRole('heading', { name: 'Club profile', level: 1 })).toBeVisible()
        await expect(club.getByRole('button', { name: 'Create team' })).toBeVisible()
        await expect(club.getByText('The club has no positions yet. Add the first one with “Add position”.')).toBeVisible()
        await expectNoHorizontalScroll(page)

        await page.goto('/backend/players')
        const players = page.getByRole('main')
        await expect(players.getByText('The club has no team yet')).toBeVisible()
        await expect(players.getByRole('link', { name: 'Go to club profile' })).toHaveAttribute('href', '/backend/club')
        await expectNoHorizontalScroll(page)

        await page.goto('/backend/accounts')
        await expect(page.getByRole('main').getByRole('heading', { name: 'Account status', level: 1 })).toBeVisible()
        await expect(page.getByRole('main').getByRole('button', { name: 'Invite' })).toBeVisible()
        await expectNoHorizontalScroll(page)
      }

      await page.goto('/backend/accounts/delete-club')
      const deletion = page.getByRole('main')
      const submit = deletion.getByRole('button', { name: 'Delete club data' })
      await expect(deletion.getByText(`To confirm, type the exact club name: ${clubName}`)).toBeVisible()
      await expect(submit).toBeDisabled()
      await deletion.getByRole('textbox', { name: 'Club name' }).fill(`${clubName} x`)
      await expect(submit).toBeDisabled()
      await deletion.getByRole('textbox', { name: 'Club name' }).fill(clubName)
      await expect(submit).toBeEnabled()
    } finally {
      await deleteOrganizationIfExists(request, admin, organizationId)
    }
  })
})
