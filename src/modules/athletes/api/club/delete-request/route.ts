import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { clubDeleteRequestSchema } from '../../../data/validators'
import type { ClubSoftDeleteResult } from '../../../commands/clubDelete'
import '../../../commands/clubDelete'
import { resolveClubRequestContext } from '../../../lib/requestContext'
import { athletesErrorSchema, athletesTag } from '../../openapi'

const logger = createLogger('athletes').child({ component: 'club-delete-route' })

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['athletes.club.manage'] },
}

const responseSchema = z.object({
  ok: z.literal(true),
  deletedRecords: z.number(),
  deactivatedAccounts: z.number(),
  skippedAccounts: z.number(),
})

export async function POST(request: Request) {
  try {
    const { container, scope, userId, commandContext } = await resolveClubRequestContext(request)
    const parsed = clubDeleteRequestSchema.safeParse(await readJsonSafe(request))
    if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })

    const guard = await runRouteMutationGuards({
      container,
      req: request,
      auth: { tenantId: scope.tenantId, organizationId: scope.organizationId, userId },
      input: {
        resourceKind: 'athletes.club',
        resourceId: scope.organizationId,
        operation: 'delete',
        mutationPayload: parsed.data,
      },
    })
    if (!guard.ok) return guard.response
    const input = guard.modifiedPayload
      ? clubDeleteRequestSchema.safeParse({ ...parsed.data, ...guard.modifiedPayload })
      : parsed
    if (!input.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })

    const commandBus = container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<Record<string, unknown>, ClubSoftDeleteResult>('athletes.club.soft_delete', {
      input: input.data,
      ctx: commandContext,
    })
    await guard.runAfterSuccess()
    return Response.json(
      {
        ok: true,
        deletedRecords: result.deletedRecords,
        deactivatedAccounts: result.deactivatedAccounts,
        skippedAccounts: result.skippedAccounts,
      },
      { status: 202 },
    )
  } catch (err) {
    if (isCrudHttpError(err)) return Response.json(err.body, { status: err.status })
    logger.error('Club delete request failed', { err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: athletesTag,
  summary: 'Delete club data (coarse, reversible by the operator)',
  methods: {
    POST: {
      summary: 'Request deletion of the caller\'s club data',
      description:
        'Requires typing the exact club name. Soft-deletes every athletes record of the club and deactivates every other club account. Permanent purge is an operator task.',
      tags: [athletesTag],
      requestBody: { contentType: 'application/json', schema: clubDeleteRequestSchema },
      responses: [{ status: 202, description: 'Club data deleted', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid payload or club name mismatch', schema: athletesErrorSchema },
        { status: 403, description: 'Missing feature or club context', schema: athletesErrorSchema },
      ],
    },
  },
}
