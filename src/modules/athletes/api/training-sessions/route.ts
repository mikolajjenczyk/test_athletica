import { z } from 'zod'
import type { FilterQuery } from '@mikro-orm/postgresql'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { AthletesPlayer, AthletesTrainingSession } from '../../data/entities'
import { resolveClubRequestContext } from '../../lib/requestContext'
import { toTrainingSessionView, trainingSessionViewSchema } from '../../lib/dailyImportView'
import { athletesErrorSchema, athletesTag, createAthletesPagedListResponseSchema } from '../openapi'

const logger = createLogger('athletes').child({ component: 'training-sessions-route' })

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const querySchema = z.object({
  teamId: z.string().uuid().optional(),
  playerId: z.string().uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(200),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['athletes.daily.view'] },
}

/**
 * Training sessions (RPE) of the caller's club (REQ-003, REQ-004), newest first. `load` = RPE ×
 * minutes is computed here, never stored; a session without RPE has `rpe: null`,
 * `rpeMissing: true` and `load: null` ("Brak RPE", never 0). Two sessions of one day stay two rows.
 */
export async function GET(request: Request) {
  const query = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!query.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  try {
    const { em, scope } = await resolveClubRequestContext(request)
    const { teamId, playerId, from, to, page, pageSize } = query.data
    const where: Record<string, unknown> = { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }

    if (teamId) {
      // Team players in the caller's club only; a team of another club yields nothing.
      const players = await em.find(
        AthletesPlayer,
        { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null, teamId } as FilterQuery<AthletesPlayer>,
        { fields: ['id'] },
      )
      const ids = players.map((row) => String(row.id)).filter((id) => !playerId || id === playerId)
      if (ids.length === 0) return Response.json({ items: [], total: 0, page, pageSize, totalPages: 1 })
      where.playerId = { $in: ids }
    } else if (playerId) {
      where.playerId = playerId
    }
    if (from || to) where.sessionDate = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) }

    const [rows, total] = await em.findAndCount(AthletesTrainingSession, where as FilterQuery<AthletesTrainingSession>, {
      orderBy: { sessionDate: 'desc', sessionNo: 'asc', playerId: 'asc' },
      limit: pageSize,
      offset: (page - 1) * pageSize,
    })
    return Response.json({
      items: rows.map(toTrainingSessionView),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (err) {
    if (isCrudHttpError(err)) return Response.json(err.body, { status: err.status })
    logger.error('Failed to load training sessions', { err })
    return Response.json({ error: 'Failed to load training sessions' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: athletesTag,
  summary: 'Training sessions (RPE) of the caller\'s club',
  methods: {
    GET: {
      summary: 'List training sessions',
      description:
        'Filters: `teamId`, `playerId`, `from`/`to` (session date, inclusive). `load` = RPE × minutes (AU), computed at read time and null when RPE or minutes is missing; `rpeMissing` marks "Brak RPE" (never 0). `previousMinutes`/`previousRpe`/`correctedAt` show the last correction.',
      tags: [athletesTag],
      query: querySchema,
      responses: [{ status: 200, description: 'Sessions', schema: createAthletesPagedListResponseSchema(trainingSessionViewSchema) }],
      errors: [
        { status: 400, description: 'Invalid query', schema: athletesErrorSchema },
        { status: 403, description: 'Missing feature or club context', schema: athletesErrorSchema },
      ],
    },
  },
}
