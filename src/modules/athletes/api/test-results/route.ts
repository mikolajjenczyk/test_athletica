import { z } from 'zod'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { callerHasClubFeatures, resolveClubRequestContext } from '../../lib/requestContext'
import { testResultViewSchema } from '../../lib/testResultView'
import { ATHLETES_TEST_RESULTS_SERVICE, type AthletesTestResultsService } from '../../lib/testResultsService'
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

const responseSchema = z.object({
  items: z.array(testResultViewSchema.extend({ checkFlag: z.boolean(), noPreviousMeasurement: z.boolean() })),
})

/**
 * Test results of the caller's club, newest first. Reasons for "Nie wykonał" are returned
 * only to callers with `athletes.tests.record` (D109); for view-only callers the
 * `reasonCode` key is omitted. Rows come from `athletesTestResultsService` with `checkFlag`
 * ("sprawdź", D372) and `noPreviousMeasurement` ("Brak wcześniejszego pomiaru").
 */
export async function GET(request: Request) {
  const query = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!query.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  try {
    const context = await resolveClubRequestContext(request)
    const service = context.container.resolve(ATHLETES_TEST_RESULTS_SERVICE) as AthletesTestResultsService
    const includeReason = await callerHasClubFeatures(context, ['athletes.tests.record'])
    const items = await service.listResults(context.scope, query.data, { includeReason })
    return Response.json({ items })
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
        'Filters: `definitionId`, `teamId`, `playerId`, `sessionId`, `from`/`to` (test date, inclusive). Gaps are states with a null value, never 0. `reasonCode` is present only for callers with `athletes.tests.record`. `checkFlag` marks a best trial more than 10% away from the previous result or another valid trial; `noPreviousMeasurement` marks the first recorded result of the player in the test.',
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
