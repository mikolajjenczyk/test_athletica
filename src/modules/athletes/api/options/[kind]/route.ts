import { z } from 'zod'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { AthletesPlayer, AthletesPosition, AthletesTeam } from '../../../data/entities'
import { athletesErrorSchema, athletesTag, optionsResponseSchema } from '../../openapi'

const logger = createLogger('athletes').child({ component: 'options' })

const kindSchema = z.enum(['teams', 'positions', 'players'])
const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['athletes.players.view'] },
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

export async function GET(request: Request, ctx: { params?: { kind?: string } }) {
  const kind = kindSchema.safeParse(ctx.params?.kind)
  if (!kind.success) return json({ error: 'Unknown option source' }, 404)
  const query = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!query.success) return json({ error: 'Invalid query' }, 400)

  const auth = await getAuthFromCookies()
  // Fail closed: no club in context means no options, never "all clubs" (D33).
  if (!auth?.tenantId || !auth.orgId) return json({ error: 'Club context is required' }, 403)
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }
  const where = { ...scope, deletedAt: null }
  const needle = query.data.q?.toLocaleLowerCase() ?? ''

  try {
    const { resolve } = await createRequestContainer()
    const em = resolve<EntityManager>('em')
    let items: Array<{ value: string; label: string }>
    if (kind.data === 'teams') {
      const rows = await em.find(AthletesTeam, where as FilterQuery<AthletesTeam>, { orderBy: { name: 'asc' } })
      items = rows.map((row) => ({ value: row.id, label: row.name }))
    } else if (kind.data === 'positions') {
      const rows = await em.find(AthletesPosition, where as FilterQuery<AthletesPosition>, { orderBy: { sortOrder: 'asc', name: 'asc' } })
      items = rows.map((row) => ({ value: row.id, label: row.name }))
    } else {
      // Encrypted names: decrypt, then sort and filter in memory (one small team).
      const rows = await findWithDecryption(em, AthletesPlayer, { ...where, isActive: true } as FilterQuery<AthletesPlayer>, undefined, scope)
      items = rows
        .map((row) => ({ value: row.id, label: `${row.firstName} ${row.lastName}`.trim() }))
        .sort((a, b) => a.label.localeCompare(b.label))
    }
    if (needle) items = items.filter((item) => item.label.toLocaleLowerCase().includes(needle))
    return json({ items: items.slice(0, query.data.limit) })
  } catch (err) {
    logger.error('Failed to load athletes options', { err, kind: kind.data })
    return json({ error: 'Failed to load options' }, 500)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: athletesTag,
  summary: 'Club-scoped option sources for teams, positions and players',
  methods: {
    GET: {
      summary: 'List options',
      description: 'Returns `{ value, label }` options of the caller\'s club. `kind` is `teams`, `positions` or `players`.',
      tags: [athletesTag],
      query: querySchema,
      responses: [{ status: 200, description: 'Options', schema: optionsResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid query', schema: athletesErrorSchema },
        { status: 403, description: 'No club in context', schema: athletesErrorSchema },
        { status: 404, description: 'Unknown option source', schema: athletesErrorSchema },
      ],
    },
  },
}
