import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'

/**
 * TEST-001 / TEST-002 (spec 2026-10-28-e02-testy-i-wyniki): a new club gets the 12 template
 * test definitions (6 active) exactly once, with the "clear change" threshold and its source
 * in the payload; the catalog is read-only in the MVP, so a write never changes it.
 */

type Definition = {
  id: string
  templateKey: string
  name: string
  unit: string
  direction: string
  attempts: number
  countingRule: string
  clearChangeThreshold: number | null
  thresholdSource: string | null
  repeatEveryWeeks: number
  isActive: boolean
  updatedAt: string | null
}

test.describe('TC-ATH-005 test catalog', () => {
  test('a new club gets the template catalog once and cannot change it', async ({ request }) => {
    const admin = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let organizationId: string | null = null
    try {
      organizationId = await createOrganizationFixture(request, admin, { name: `QA test catalog ${stamp}` })
      const selectedOrgId = organizationId

      const listDefinitions = async (query: string): Promise<Definition[]> => {
        const response = await apiRequestWithSelectedOrg(request, 'GET', `/api/athletes/test-definitions?${query}`, {
          token: admin,
          selectedOrgId,
        })
        expect(response.status()).toBe(200)
        return ((await response.json()) as { items: Definition[] }).items
      }

      // The copy runs from the persistent `directory.organization.created` subscriber.
      await expect.poll(async () => (await listDefinitions('pageSize=100')).length).toBe(12)
      const all = await listDefinitions('pageSize=100')
      expect(new Set(all.map((definition) => definition.templateKey)).size).toBe(12)
      expect(all.filter((definition) => definition.isActive)).toHaveLength(6)
      for (const definition of all) {
        expect(definition.countingRule).toBe('best')
        expect(['higher_better', 'lower_better']).toContain(definition.direction)
        expect(definition.attempts).toBeGreaterThan(0)
        expect(definition.repeatEveryWeeks).toBeGreaterThan(0)
        expect(definition).toHaveProperty('clearChangeThreshold')
        expect(definition).toHaveProperty('thresholdSource')
        // A threshold is never shown without the source it comes from.
        if (definition.clearChangeThreshold !== null) expect(definition.thresholdSource).toBeTruthy()
      }

      const active = await listDefinitions('activeOnly=true')
      expect(active).toHaveLength(6)
      expect(active.every((definition) => definition.isActive)).toBe(true)

      const options = await apiRequestWithSelectedOrg(request, 'GET', '/api/athletes/options/tests', { token: admin, selectedOrgId })
      expect(options.status()).toBe(200)
      const optionIds = ((await options.json()) as { items: Array<{ value: string; label: string }> }).items.map((item) => item.value)
      expect(new Set(optionIds)).toEqual(new Set(all.map((definition) => definition.id)))

      // Read-only in the MVP: the route exposes no write method, so every write is refused.
      const sprint = all.find((definition) => definition.templateKey === 'sprint_10m')
      expect(sprint).toBeTruthy()
      const writes = [
        { method: 'POST' as const, data: { templateKey: `qa_${stamp}`, name: `QA test ${stamp}`, unit: 'cm' } },
        { method: 'PUT' as const, data: { id: sprint!.id, clearChangeThreshold: 0.5, repeatEveryWeeks: 2 } },
        { method: 'DELETE' as const, data: { id: sprint!.id } },
      ]
      for (const write of writes) {
        const response = await apiRequestWithSelectedOrg(request, write.method, '/api/athletes/test-definitions', {
          token: admin,
          selectedOrgId,
          data: write.data,
        })
        expect(response.ok()).toBe(false)
        expect([403, 404, 405]).toContain(response.status())
      }

      const after = await listDefinitions('pageSize=100')
      expect(after).toHaveLength(12)
      const sprintAfter = after.find((definition) => definition.id === sprint!.id)
      expect(sprintAfter).toEqual(sprint)
    } finally {
      await deleteOrganizationIfExists(request, admin, organizationId)
    }
  })
})
