import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { testSessionFinishSchema } from '../../../data/validators'
import type { TestSessionFinishResult } from '../../../commands/tests'
import '../../../commands/tests'
import { resolveClubRequestContext } from '../../../lib/requestContext'
import { athletesErrorSchema, athletesTag, toIsoTimestamp } from '../../openapi'

const logger = createLogger('athletes').child({ component: 'test-session-finish-route' })

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['athletes.tests.record'] },
}

const summarySchema = z.object({
  recorded: z.number().int(),
  notPerformed: z.number().int(),
  empty: z.number().int(),
  invalidAttempt: z.number().int(),
  joinedLater: z.number().int(),
  playersTotal: z.number().int(),
})

const responseSchema = z.object({
  ok: z.literal(true),
  id: z.string().uuid(),
  status: z.literal('finished'),
  finishedAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  alreadyFinished: z.boolean(),
  summary: summarySchema,
})

/** "Zakończ test" (REQ-006, D202): finishes the session and returns its summary. Idempotent. */
export async function POST(request: Request) {
  try {
    const { container, scope, userId, commandContext } = await resolveClubRequestContext(request)
    const parsed = testSessionFinishSchema.safeParse(await readJsonSafe(request))
    if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })

    const guard = await runRouteMutationGuards({
      container,
      req: request,
      auth: { tenantId: scope.tenantId, organizationId: scope.organizationId, userId },
      input: {
        resourceKind: 'athletes.test_session',
        resourceId: parsed.data.id,
        operation: 'custom',
        mutationPayload: parsed.data,
      },
    })
    if (!guard.ok) return guard.response
    const input = guard.modifiedPayload
      ? testSessionFinishSchema.safeParse({ ...parsed.data, ...guard.modifiedPayload })
      : parsed
    if (!input.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })

    const commandBus = container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<Record<string, unknown>, TestSessionFinishResult>('athletes.test_sessions.finish', {
      input: input.data,
      ctx: commandContext,
    })
    await guard.runAfterSuccess()
    return Response.json({
      ok: true,
      id: result.session.id,
      status: 'finished',
      finishedAt: toIsoTimestamp(result.session.finishedAt),
      updatedAt: toIsoTimestamp(result.session.updatedAt),
      alreadyFinished: result.alreadyFinished,
      summary: result.summary,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return Response.json(err.body, { status: err.status })
    logger.error('Finishing a test session failed', { err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: athletesTag,
  summary: 'Finish a test session',
  methods: {
    POST: {
      summary: 'Finish a test session and return its summary',
      description:
        'Marks the session finished and returns counts of recorded results, "did not perform", invalid attempts, joined later and empty fields (players without a result count as empty). Repeating the call returns the same summary with `alreadyFinished: true`. Send `updatedAt` (or the optimistic-lock header) to detect a stale session (409).',
      tags: [athletesTag],
      requestBody: { contentType: 'application/json', schema: testSessionFinishSchema },
      responses: [{ status: 200, description: 'Session finished', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid payload', schema: athletesErrorSchema },
        { status: 403, description: 'Missing feature or club context', schema: athletesErrorSchema },
        { status: 404, description: 'Session not found in the club', schema: athletesErrorSchema },
        { status: 409, description: 'Stale version', schema: athletesErrorSchema },
      ],
    },
  },
}
