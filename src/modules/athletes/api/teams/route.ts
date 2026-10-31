import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { AthletesTeam } from '../../data/entities'
import { teamCreateSchema, teamUpdateSchema } from '../../data/validators'
import { TEAM_ENTITY_ID } from '../../commands/club'
import {
  athletesDeleteSchema,
  athletesOkSchema,
  athletesCreatedSchema,
  createAthletesCrudOpenApi,
  createAthletesPagedListResponseSchema,
  toIsoTimestamp,
} from '../openapi'

const querySchema = z
  .object({
    id: z.string().uuid().optional(),
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    sortField: z.string().optional().default('name'),
    sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
    isActive: z.enum(['true', 'false']).optional(),
  })
  .passthrough()

type Query = z.infer<typeof querySchema>

type Row = { id: string; name: string; is_active: boolean; updated_at: Date | string | null }

const teamListItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isActive: z.boolean(),
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
    entity: AthletesTeam,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: TEAM_ENTITY_ID },
  list: {
    schema: querySchema,
    entityId: TEAM_ENTITY_ID,
    fields: ['id', 'name', 'is_active', 'updated_at'],
    sortFieldMap: { name: 'name', updatedAt: 'updated_at' },
    buildFilters: async (q: Query) => {
      const filters: Record<string, unknown> = {}
      if (q.id) filters.id = q.id
      if (q.isActive) filters.is_active = q.isActive === 'true'
      return filters
    },
    transformItem: (item: Row) => ({
      id: String(item.id),
      name: String(item.name),
      isActive: Boolean(item.is_active),
      updatedAt: toIsoTimestamp(item.updated_at),
    }),
  },
  actions: {
    create: {
      commandId: 'athletes.teams.create',
      schema: teamCreateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String(result.id) }),
      status: 201,
    },
    update: {
      commandId: 'athletes.teams.update',
      schema: teamUpdateSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'athletes.teams.delete',
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = createAthletesCrudOpenApi({
  resourceName: 'Team',
  pluralName: 'Teams',
  querySchema,
  listResponseSchema: createAthletesPagedListResponseSchema(teamListItemSchema),
  create: { schema: teamCreateSchema, responseSchema: athletesCreatedSchema, description: 'Creates the club team. A second active team is rejected with 409 (MVP: one team per club).' },
  update: { schema: teamUpdateSchema, responseSchema: athletesOkSchema, description: 'Updates the team. Send the expected version header; a stale version returns 409.' },
  del: { schema: athletesDeleteSchema, responseSchema: athletesOkSchema, description: 'Soft-deletes a team without players.' },
})
