import { z } from 'zod'
import type { FilterQuery } from '@mikro-orm/postgresql'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { resolveClubRequestContext } from '../../../lib/requestContext'
import { athletesErrorSchema, athletesTag } from '../../openapi'

const logger = createLogger('athletes').child({ component: 'invite-status' })

/**
 * The installed `/api/auth/users` list does not say whether an invitee has set a
 * password yet; "Zaproszenie oczekuje" needs exactly that bit. Returns only a boolean
 * per user of the caller's own club — never the hash or any other credential field.
 */
const querySchema = z.object({
  ids: z
    .string()
    .transform((value) => value.split(',').map((id) => id.trim()).filter(Boolean))
    .pipe(z.array(z.string().uuid()).min(1).max(100)),
})

const responseSchema = z.object({
  items: z.array(z.object({ id: z.string().uuid(), pending: z.boolean() })),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['auth.users.list'] },
}

export async function GET(request: Request) {
  try {
    const { em, scope } = await resolveClubRequestContext(request)
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
    if (!parsed.success) return Response.json({ error: 'Invalid ids' }, { status: 400 })
    const users = await em.find(
      User,
      {
        id: { $in: parsed.data.ids },
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      } as FilterQuery<User>,
      { fields: ['id', 'passwordHash'] },
    )
    return Response.json({ items: users.map((user) => ({ id: String(user.id), pending: !user.passwordHash })) })
  } catch (err) {
    if (isCrudHttpError(err)) return Response.json(err.body, { status: err.status })
    logger.error('Failed to resolve invite status', { err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: athletesTag,
  summary: 'Pending-invitation status of club accounts',
  methods: {
    GET: {
      summary: 'Which club accounts have not set a password yet',
      tags: [athletesTag],
      query: querySchema,
      responses: [{ status: 200, description: 'Status per user', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid ids', schema: athletesErrorSchema },
        { status: 403, description: 'Missing feature or club context', schema: athletesErrorSchema },
      ],
    },
  },
}
