import { z } from 'zod'
import type { FilterQuery } from '@mikro-orm/postgresql'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { AthletesDailyImport } from '../../data/entities'
import { resolveClubRequestContext } from '../../lib/requestContext'
import { dailyImportListItemSchema, toDailyImportListItem } from '../../lib/dailyImportView'
import { athletesErrorSchema, athletesTag, createAthletesPagedListResponseSchema } from '../openapi'

const logger = createLogger('athletes').child({ component: 'daily-imports-route' })

const querySchema = z.object({
  kind: z.enum(['rpe', 'wellbeing']).optional(),
  teamId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['athletes.daily.view'] },
}

/**
 * Import history of the caller's club (REQ-014), newest first: who (user id), when, which file,
 * period and counters. `canUndo` marks the one import per kind and team that "Cofnij" may undo.
 */
export async function GET(request: Request) {
  const query = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!query.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  try {
    const { em, scope } = await resolveClubRequestContext(request)
    const base: Record<string, unknown> = { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }
    if (query.data.kind) base.kind = query.data.kind
    if (query.data.teamId) base.teamId = query.data.teamId
    const { page, pageSize } = query.data
    const [rows, total] = await em.findAndCount(AthletesDailyImport, base as FilterQuery<AthletesDailyImport>, {
      orderBy: { createdAt: 'desc', id: 'desc' },
      limit: pageSize,
      offset: (page - 1) * pageSize,
      // The restore list is internal to undo.
      exclude: ['undoState'],
    })

    const latestByPair = new Map<string, string | null>()
    for (const row of rows) {
      const pair = `${row.kind}|${row.teamId}`
      if (latestByPair.has(pair)) continue
      const latest = await em.findOne(
        AthletesDailyImport,
        { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null, kind: row.kind, teamId: row.teamId, undoneAt: null } as FilterQuery<AthletesDailyImport>,
        { orderBy: { createdAt: 'desc', id: 'desc' }, fields: ['id'] },
      )
      latestByPair.set(pair, latest ? String(latest.id) : null)
    }

    return Response.json({
      items: rows.map((row) => toDailyImportListItem(row, latestByPair.get(`${row.kind}|${row.teamId}`) === String(row.id))),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (err) {
    if (isCrudHttpError(err)) return Response.json(err.body, { status: err.status })
    logger.error('Failed to load daily imports', { err })
    return Response.json({ error: 'Failed to load daily imports' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: athletesTag,
  summary: 'Daily-data import history',
  methods: {
    GET: {
      summary: 'List daily-data imports',
      description:
        'Imports of the caller\'s club, newest first, with file name, period, counters and name-free rejected rows (`{ line, reason }`). Filters: `kind`, `teamId`. `canUndo` is true only for the latest not-undone import of its kind and team.',
      tags: [athletesTag],
      query: querySchema,
      responses: [{ status: 200, description: 'Imports', schema: createAthletesPagedListResponseSchema(dailyImportListItemSchema) }],
      errors: [
        { status: 400, description: 'Invalid query', schema: athletesErrorSchema },
        { status: 403, description: 'Missing feature or club context', schema: athletesErrorSchema },
      ],
    },
  },
}
