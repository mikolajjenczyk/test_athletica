import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { testResultRecordSchema } from '../../../data/validators'
import type { TestResultRecordResult } from '../../../commands/tests'
import '../../../commands/tests'
import { resolveClubRequestContext } from '../../../lib/requestContext'
import { testResultViewSchema, toTestResultView } from '../../../lib/testResultView'
import { athletesErrorSchema, athletesTag } from '../../openapi'

const logger = createLogger('athletes').child({ component: 'test-result-record-route' })

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['athletes.tests.record'] },
}

const responseSchema = z.object({
  ok: z.literal(true),
  replayed: z.boolean(),
  result: testResultViewSchema,
})

/**
 * "Dalej" in "Tryb boisko": one player's trials and result in one atomic command. A retry
 * with the same `idempotencyKey` answers 200 with the stored result and `replayed: true`.
 */
export async function POST(request: Request) {
  try {
    const { container, scope, userId, commandContext } = await resolveClubRequestContext(request)
    const parsed = testResultRecordSchema.safeParse(await readJsonSafe(request))
    if (!parsed.success) {
      return Response.json({ error: 'Invalid payload', issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })) }, { status: 400 })
    }

    const guard = await runRouteMutationGuards({
      container,
      req: request,
      auth: { tenantId: scope.tenantId, organizationId: scope.organizationId, userId },
      input: {
        resourceKind: 'athletes.test_result',
        resourceId: null,
        operation: 'create',
        mutationPayload: parsed.data,
      },
    })
    if (!guard.ok) return guard.response
    const input = guard.modifiedPayload
      ? testResultRecordSchema.safeParse({ ...parsed.data, ...guard.modifiedPayload })
      : parsed
    if (!input.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })

    const commandBus = container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<Record<string, unknown>, TestResultRecordResult>('athletes.test_results.record', {
      input: input.data,
      ctx: commandContext,
    })
    await guard.runAfterSuccess()
    // The caller holds `athletes.tests.record`, so the reason is part of its own answer.
    return Response.json(
      { ok: true, replayed: result.replayed, result: toTestResultView(result.result, { includeReason: true }) },
      { status: result.replayed ? 200 : 201 },
    )
  } catch (err) {
    if (isCrudHttpError(err)) return Response.json(err.body, { status: err.status })
    logger.error('Recording a test result failed', { err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: athletesTag,
  summary: 'Record one player\'s test trials',
  methods: {
    POST: {
      summary: 'Record one player\'s trials and result in one atomic write',
      description:
        'The result is the best valid trial (higher or lower is better per test). Gaps are states — `empty`, `invalid_attempt` (all trials invalid), `not_performed` (requires `reasonCode`: absent, excused, other) or `joined_later` — and never 0. The same `idempotencyKey` returns the stored result (`replayed: true`) without a second write; a key used for another player or session is a 409.',
      tags: [athletesTag],
      requestBody: { contentType: 'application/json', schema: testResultRecordSchema },
      responses: [
        { status: 201, description: 'Result recorded', schema: responseSchema },
        { status: 200, description: 'Same idempotency key: the stored result', schema: responseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid payload, attempt out of range, player not in the session, or test date before the player joined', schema: athletesErrorSchema },
        { status: 403, description: 'Missing feature or club context', schema: athletesErrorSchema },
        { status: 404, description: 'Session not found in the club', schema: athletesErrorSchema },
        { status: 409, description: 'Session finished, or idempotency key already used elsewhere', schema: athletesErrorSchema },
      ],
    },
  },
}
