import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { AthletesTestDefinition } from '../data/entities'
import type { ClubScope } from './scope'
import { TEST_TEMPLATE, type TestTemplateEntry } from './testTemplate'

/**
 * Copies the Apzumi test template into one club (spec E02, REQ-001). Idempotent by
 * `(tenant, organization, template_key)`: definitions the club already has — including
 * soft-deleted ones — are never overwritten or re-created, and a concurrent copy is
 * absorbed by the unique constraint (`ON CONFLICT DO NOTHING`).
 *
 * Returns the number of template keys that were missing before the insert.
 */
export async function ensureClubTestDefinitions(
  em: EntityManager,
  scope: ClubScope,
  template: readonly TestTemplateEntry[] = TEST_TEMPLATE,
): Promise<number> {
  if (!scope.tenantId || !scope.organizationId) return 0
  const existing = await em.find(
    AthletesTestDefinition,
    { tenantId: scope.tenantId, organizationId: scope.organizationId } as FilterQuery<AthletesTestDefinition>,
    { fields: ['id', 'templateKey'], filters: false },
  )
  const known = new Set(existing.map((row) => row.templateKey))
  const missing = template.filter((entry) => !known.has(entry.templateKey))
  if (missing.length === 0) return 0
  const now = new Date()
  await em
    .createQueryBuilder(AthletesTestDefinition)
    .insert(
      missing.map((entry) => ({
        templateKey: entry.templateKey,
        name: entry.name,
        variant: entry.variant,
        unit: entry.unit,
        direction: entry.direction,
        attempts: entry.attempts,
        countingRule: 'best' as const,
        clearChangeThreshold: entry.clearChangeThreshold,
        thresholdSource: entry.thresholdSource,
        repeatEveryWeeks: entry.repeatEveryWeeks,
        sortOrder: entry.sortOrder,
        isActive: entry.isActive,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflict(['tenantId', 'organizationId', 'templateKey'])
    .ignore()
    .execute()
  return missing.length
}
