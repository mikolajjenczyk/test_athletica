import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { AthletesTestDefinition } from '../../data/entities'
import { createAthletesCrudOpenApi, createAthletesPagedListResponseSchema, toIsoTimestamp } from '../openapi'

const TEST_DEFINITION_ENTITY_ID = 'athletes:athletes_test_definition'

/**
 * The club's test catalog (REQ-001). READ-ONLY in the MVP (Q-006): no POST/PUT/DELETE
 * handlers are exported, so writes answer 405. The "clear change" threshold and its source
 * belong to Apzumi (D99) and only change through a template sync.
 */
const querySchema = z
  .object({
    id: z.string().uuid().optional(),
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    sortField: z.string().optional().default('sortOrder'),
    sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
    activeOnly: z.enum(['true', 'false']).optional(),
  })
  .passthrough()

type Query = z.infer<typeof querySchema>

type Row = {
  id: string
  template_key: string
  name: string
  variant: string | null
  unit: string
  direction: string
  attempts: number
  counting_rule: string
  clear_change_threshold: string | number | null
  threshold_source: string | null
  repeat_every_weeks: number
  sort_order: number
  is_active: boolean
  updated_at: Date | string | null
}

const testDefinitionListItemSchema = z.object({
  id: z.string().uuid(),
  templateKey: z.string(),
  name: z.string(),
  variant: z.string().nullable(),
  unit: z.string(),
  direction: z.enum(['higher_better', 'lower_better']),
  attempts: z.number().int(),
  countingRule: z.literal('best'),
  clearChangeThreshold: z.number().nullable(),
  thresholdSource: z.string().nullable(),
  repeatEveryWeeks: z.number().int(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  updatedAt: z.string().nullable(),
})

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const crud = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['athletes.tests.view'] },
  },
  orm: {
    entity: AthletesTestDefinition,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: querySchema,
    entityId: TEST_DEFINITION_ENTITY_ID,
    fields: [
      'id', 'template_key', 'name', 'variant', 'unit', 'direction', 'attempts', 'counting_rule',
      'clear_change_threshold', 'threshold_source', 'repeat_every_weeks', 'sort_order', 'is_active', 'updated_at',
    ],
    sortFieldMap: { sortOrder: 'sort_order', name: 'name', updatedAt: 'updated_at' },
    buildFilters: async (q: Query) => {
      const filters: Record<string, unknown> = {}
      if (q.id) filters.id = q.id
      if (q.activeOnly === 'true') filters.is_active = true
      return filters
    },
    transformItem: (item: Row) => ({
      id: String(item.id),
      templateKey: String(item.template_key),
      name: String(item.name),
      variant: item.variant ? String(item.variant) : null,
      unit: String(item.unit),
      direction: item.direction === 'lower_better' ? 'lower_better' : 'higher_better',
      attempts: Number(item.attempts),
      countingRule: 'best',
      clearChangeThreshold: toNumberOrNull(item.clear_change_threshold),
      thresholdSource: item.threshold_source ? String(item.threshold_source) : null,
      repeatEveryWeeks: Number(item.repeat_every_weeks),
      sortOrder: Number(item.sort_order),
      isActive: Boolean(item.is_active),
      updatedAt: toIsoTimestamp(item.updated_at),
    }),
  },
})

export const metadata = crud.metadata
export const GET = crud.GET

export const openApi = createAthletesCrudOpenApi({
  resourceName: 'Test definition',
  pluralName: 'Test definitions',
  querySchema,
  listResponseSchema: createAthletesPagedListResponseSchema(testDefinitionListItemSchema),
})
