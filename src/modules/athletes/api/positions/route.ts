import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { AthletesPosition } from '../../data/entities'
import { positionCreateSchema, positionUpdateSchema } from '../../data/validators'
import { POSITION_ENTITY_ID } from '../../commands/club'
import {
  athletesCreatedSchema,
  athletesDeleteSchema,
  athletesOkSchema,
  createAthletesCrudOpenApi,
  createAthletesPagedListResponseSchema,
  toIsoTimestamp,
} from '../openapi'

const querySchema = z
  .object({
    id: z.string().uuid().optional(),
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(100),
    sortField: z.string().optional().default('sortOrder'),
    sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
  })
  .passthrough()

type Query = z.infer<typeof querySchema>

type Row = { id: string; name: string; sort_order: number; updated_at: Date | string | null }

const positionListItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  sortOrder: z.number(),
  updatedAt: z.string().nullable(),
})

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['athletes.players.view'] },
    POST: { requireAuth: true, requireFeatures: ['athletes.club.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['athletes.club.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['athletes.club.manage'] },
  },
  orm: {
    entity: AthletesPosition,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: POSITION_ENTITY_ID },
  list: {
    schema: querySchema,
    entityId: POSITION_ENTITY_ID,
    fields: ['id', 'name', 'sort_order', 'updated_at'],
    sortFieldMap: { name: 'name', sortOrder: 'sort_order', updatedAt: 'updated_at' },
    buildFilters: async (q: Query) => (q.id ? { id: q.id } : {}),
    transformItem: (item: Row) => ({
      id: String(item.id),
      name: String(item.name),
      sortOrder: Number(item.sort_order ?? 0),
      updatedAt: toIsoTimestamp(item.updated_at),
    }),
  },
  actions: {
    create: {
      commandId: 'athletes.positions.create',
      schema: positionCreateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String(result.id) }),
      status: 201,
    },
    update: {
      commandId: 'athletes.positions.update',
      schema: positionUpdateSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'athletes.positions.delete',
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = createAthletesCrudOpenApi({
  resourceName: 'Position',
  pluralName: 'Positions',
  querySchema,
  listResponseSchema: createAthletesPagedListResponseSchema(positionListItemSchema),
  create: { schema: positionCreateSchema, responseSchema: athletesCreatedSchema, description: 'Adds a position to the club dictionary.' },
  update: { schema: positionUpdateSchema, responseSchema: athletesOkSchema, description: 'Renames or reorders a position. A stale version returns 409.' },
  del: { schema: athletesDeleteSchema, responseSchema: athletesOkSchema, description: 'Soft-deletes a position. A position used by a player returns 409.' },
})
