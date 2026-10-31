import { z } from 'zod'
import type { FilterQuery } from '@mikro-orm/postgresql'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { AthletesTestResult, AthletesTestSession } from '../../data/entities'
import { callerHasClubFeatures, resolveClubRequestContext } from '../../lib/requestContext'
import { testResultViewSchema, toTestResultView } from '../../lib/testResultView'
import { athletesErrorSchema, athletesTag } from '../openapi'

const logger = createLogger('athletes').child({ component: 'test-results-route' })

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const querySchema = z.object({
  definitionId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  playerId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['athletes.tests.view'] },
}

const responseSchema = z.object({ items: z.array(testResultViewSchema) })

/**
 * Test results of the caller's club, newest first. Reasons for "Nie wykonał" are returned
 * only to callers with `athletes.tests.record` (D109); for view-only callers the
 * `reasonCode` key is omitted.
 */
export async function GET(request: Request) {
  const query = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!query.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  try {
    const context = await resolveClubRequestContext(request)
    const { em, scope } = context
    const q = query.data
    const where: Record<string, unknown> = { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }
    if (q.definitionId) where.testDefinitionId = q.definitionId
    if (q.playerId) where.playerId = q.playerId
    if (q.from || q.to) where.testedOn = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) }
    if (q.sessionId) where.sessionId = q.sessionId
    if (q.teamId) {
      const sessions = await em.find(
        AthletesTestSession,
        { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null, teamId: q.teamId } as FilterQuery<AthletesTestSession>,
        { fields: ['id'] },
      )
      const ids = sessions.map((row) => row.id).filter((id) => !q.sessionId || id === q.sessionId)
      if (ids.length === 0) return Response.json({ items: [] })
      where.sessionId = { $in: ids }
    }
    const rows = await em.find(AthletesTestResult, where as FilterQuery<AthletesTestResult>, {
      orderBy: { testedOn: 'desc', createdAt: 'desc' },
      limit: q.limit,
    })
    const includeReason = await callerHasClubFeatures(context, ['athletes.tests.record'])
    return Response.json({ items: rows.map((row) => toTestResultView(row, { includeReason })) })
  } catch (err) {
    if (isCrudHttpError(err)) return Response.json(err.body, { status: err.status })
    logger.error('Failed to load test results', { err })
    return Response.json({ error: 'Failed to load test results' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: athletesTag,
  summary: 'Test results of the caller\'s club',
  methods: {
    GET: {
      summary: 'List test results',
      description:
        'Filters: `definitionId`, `teamId`, `playerId`, `sessionId`, `from`/`to` (test date, inclusive). Gaps are states with a null value, never 0. `reasonCode` is present only for callers with `athletes.tests.record`.',
      tags: [athletesTag],
      query: querySchema,
      responses: [{ status: 200, description: 'Results', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid query', schema: athletesErrorSchema },
        { status: 403, description: 'Missing feature or club context', schema: athletesErrorSchema },
      ],
    },
  },
}
