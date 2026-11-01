import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { AthletesTestSession } from '../../data/entities'
import { testSessionStartSchema } from '../../data/validators'
import type { TestSessionStartResult } from '../../commands/tests'
import '../../commands/tests'
import { createAthletesCrudOpenApi, createAthletesPagedListResponseSchema, toIsoTimestamp } from '../openapi'

const TEST_SESSION_ENTITY_ID = 'athletes:athletes_test_session'

/**
 * Test sessions of the caller's club. `GET` lists them with `status`, so the "Zestaw testów"
 * page can show "Test w trakcie · Wróć do testu" for an open one (REQ-006). `POST` is
 * "Rozpocznij test" (REQ-002): it returns the already open session of the same team and test
 * (`reused: true`) instead of creating a second one.
 */
const querySchema = z
  .object({
    id: z.string().uuid().optional(),
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    sortField: z.string().optional().default('testedOn'),
    sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
    status: z.enum(['open', 'finished']).optional(),
    testDefinitionId: z.string().uuid().optional(),
    teamId: z.string().uuid().optional(),
    playerId: z.string().uuid().optional(),
  })
  .passthrough()

type Query = z.infer<typeof querySchema>

type Row = {
  id: string
  test_definition_id: string
  kind: string
  team_id: string | null
  player_id: string | null
  tested_on: Date | string
  status: string
  finished_at: Date | string | null
  updated_at: Date | string | null
}

const testSessionListItemSchema = z.object({
  id: z.string().uuid(),
  testDefinitionId: z.string().uuid(),
  kind: z.enum(['team', 'individual']),
  teamId: z.string().uuid().nullable(),
  playerId: z.string().uuid().nullable(),
  testedOn: z.string(),
  status: z.enum(['open', 'finished']),
  finishedAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

const startResponseSchema = z.object({
  id: z.string().uuid(),
  reused: z.boolean(),
  status: z.enum(['open', 'finished']),
  testedOn: z.string(),
  updatedAt: z.string().nullable(),
})

function toIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value ?? '').slice(0, 10)
}

const crud = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['athletes.tests.view'] },
    POST: { requireAuth: true, requireFeatures: ['athletes.tests.record'] },
  },
  orm: {
    entity: AthletesTestSession,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: querySchema,
    entityId: TEST_SESSION_ENTITY_ID,
    fields: ['id', 'test_definition_id', 'kind', 'team_id', 'player_id', 'tested_on', 'status', 'finished_at', 'updated_at'],
    sortFieldMap: { testedOn: 'tested_on', updatedAt: 'updated_at', status: 'status' },
    buildFilters: async (q: Query) => {
      const filters: Record<string, unknown> = {}
      if (q.id) filters.id = q.id
      if (q.status) filters.status = q.status
      if (q.testDefinitionId) filters.test_definition_id = q.testDefinitionId
      if (q.teamId) filters.team_id = q.teamId
      if (q.playerId) filters.player_id = q.playerId
      return filters
    },
    transformItem: (item: Row) => ({
      id: String(item.id),
      testDefinitionId: String(item.test_definition_id),
      kind: item.kind === 'individual' ? 'individual' : 'team',
      teamId: item.team_id ? String(item.team_id) : null,
      playerId: item.player_id ? String(item.player_id) : null,
      testedOn: toIsoDate(item.tested_on),
      status: item.status === 'finished' ? 'finished' : 'open',
      finishedAt: toIsoTimestamp(item.finished_at),
      updatedAt: toIsoTimestamp(item.updated_at),
    }),
  },
  actions: {
    create: {
      commandId: 'athletes.test_sessions.start',
      schema: testSessionStartSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => {
        const { session, reused } = result as TestSessionStartResult
        return {
          id: String(session.id),
          reused,
          status: session.status,
          testedOn: toIsoDate(session.testedOn),
          updatedAt: toIsoTimestamp(session.updatedAt),
        }
      },
      status: 201,
    },
  },
})

export const metadata = crud.metadata
export const GET = crud.GET
export const POST = crud.POST

export const openApi = createAthletesCrudOpenApi({
  resourceName: 'Test session',
  pluralName: 'Test sessions',
  querySchema,
  listResponseSchema: createAthletesPagedListResponseSchema(testSessionListItemSchema),
  create: {
    schema: testSessionStartSchema,
    responseSchema: startResponseSchema,
    description:
      'Starts a test for a team (or one player) on a date that is not in the future and not before the player joined. An open session of the same team and test is returned with `reused: true` instead of a second one.',
  },
})
