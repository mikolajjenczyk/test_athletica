import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { AthletesPlayer } from '../../data/entities'
import { playerCreateSchema, playerUpdateSchema } from '../../data/validators'
import { PLAYER_ENTITY_ID } from '../../commands/club'
import {
  athletesCreatedSchema,
  athletesDeleteSchema,
  athletesOkSchema,
  createAthletesCrudOpenApi,
  createAthletesPagedListResponseSchema,
  toIsoTimestamp,
} from '../openapi'

/**
 * Names and birth date are encrypted at rest; the query engine decrypts them per row.
 * They are never sorted or filtered in the database — the club's single team is small
 * (D206), so the UI sorts and searches names client-side.
 */
const querySchema = z
  .object({
    id: z.string().uuid().optional(),
    ids: z.string().optional(),
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(100),
    sortField: z.string().optional().default('joinedAt'),
    sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
    teamId: z.string().uuid().optional(),
    positionId: z.string().uuid().optional(),
    isActive: z.enum(['true', 'false']).optional(),
  })
  .passthrough()

type Query = z.infer<typeof querySchema>

type Row = {
  id: string
  team_id: string
  first_name: string
  last_name: string
  birth_date: string
  position_id: string | null
  joined_at: Date | string
  is_active: boolean
  updated_at: Date | string | null
}

const playerListItemSchema = z.object({
  id: z.string().uuid(),
  teamId: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  birthDate: z.string(),
  positionId: z.string().uuid().nullable(),
  joinedAt: z.string(),
  isActive: z.boolean(),
  updatedAt: z.string().nullable(),
})

function toIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value ?? '').slice(0, 10)
}

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['athletes.players.view'] },
    POST: { requireAuth: true, requireFeatures: ['athletes.players.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['athletes.players.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['athletes.players.manage'] },
  },
  orm: {
    entity: AthletesPlayer,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: PLAYER_ENTITY_ID },
  list: {
    schema: querySchema,
    entityId: PLAYER_ENTITY_ID,
    fields: ['id', 'team_id', 'first_name', 'last_name', 'birth_date', 'position_id', 'joined_at', 'is_active', 'updated_at'],
    sortFieldMap: { joinedAt: 'joined_at', updatedAt: 'updated_at', isActive: 'is_active' },
    buildFilters: async (q: Query) => {
      const filters: Record<string, unknown> = {}
      if (q.id) filters.id = q.id
      if (q.ids) {
        const ids = q.ids.split(',').map((value) => value.trim()).filter((value) => value.length > 0)
        if (ids.length > 0) filters.id = { $in: ids }
      }
      if (q.teamId) filters.team_id = q.teamId
      if (q.positionId) filters.position_id = q.positionId
      if (q.isActive) filters.is_active = q.isActive === 'true'
      return filters
    },
    transformItem: (item: Row) => ({
      id: String(item.id),
      teamId: String(item.team_id),
      firstName: String(item.first_name ?? ''),
      lastName: String(item.last_name ?? ''),
      birthDate: toIsoDate(item.birth_date),
      positionId: item.position_id ? String(item.position_id) : null,
      joinedAt: toIsoDate(item.joined_at),
      isActive: Boolean(item.is_active),
      updatedAt: toIsoTimestamp(item.updated_at),
    }),
  },
  actions: {
    create: {
      commandId: 'athletes.players.create',
      schema: playerCreateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String(result.id) }),
      status: 201,
    },
    update: {
      commandId: 'athletes.players.update',
      schema: playerUpdateSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'athletes.players.delete',
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = createAthletesCrudOpenApi({
  resourceName: 'Player',
  pluralName: 'Players',
  querySchema,
  listResponseSchema: createAthletesPagedListResponseSchema(playerListItemSchema),
  create: { schema: playerCreateSchema, responseSchema: athletesCreatedSchema, description: 'Adds a player to a team of the caller\'s club. Names and birth date are encrypted at rest.' },
  update: { schema: playerUpdateSchema, responseSchema: athletesOkSchema, description: 'Updates a player. A stale version returns 409.' },
  del: { schema: athletesDeleteSchema, responseSchema: athletesOkSchema, description: 'Soft-deletes a player.' },
})
