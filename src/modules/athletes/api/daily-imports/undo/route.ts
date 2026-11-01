import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { dailyImportUndoSchema } from '../../../data/validators'
import type { DailyImportUndoResult } from '../../../commands/dailyImports'
import '../../../commands/dailyImports'
import { resolveClubRequestContext } from '../../../lib/requestContext'
import { athletesErrorSchema, athletesTag, toIsoTimestamp } from '../../openapi'

const logger = createLogger('athletes').child({ component: 'daily-import-undo-route' })

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['athletes.daily.import'] },
}

const responseSchema = z.object({
  ok: z.literal(true),
  importId: z.string().uuid(),
  undoneAt: z.string().nullable(),
})

/** "Cofnij import" (REQ-014): undoes the latest import of its kind and team only. */
export async function POST(request: Request) {
  try {
    const { container, scope, userId, commandContext } = await resolveClubRequestContext(request)
    const parsed = dailyImportUndoSchema.safeParse(await readJsonSafe(request))
    if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })

    const guard = await runRouteMutationGuards({
      container,
      req: request,
      auth: { tenantId: scope.tenantId, organizationId: scope.organizationId, userId },
      input: {
        resourceKind: 'athletes.daily_import',
        resourceId: parsed.data.importId,
        operation: 'custom',
        mutationPayload: parsed.data,
      },
    })
    if (!guard.ok) return guard.response
    const input = guard.modifiedPayload
      ? dailyImportUndoSchema.safeParse({ ...parsed.data, ...guard.modifiedPayload })
      : parsed
    if (!input.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })

    const commandBus = container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<Record<string, unknown>, DailyImportUndoResult>('athletes.daily_import.undo', {
      input: input.data,
      ctx: commandContext,
    })
    await guard.runAfterSuccess()
    return Response.json({ ok: true, importId: String(result.record.id), undoneAt: toIsoTimestamp(result.record.undoneAt) })
  } catch (err) {
    if (isCrudHttpError(err)) return Response.json(err.body, { status: err.status })
    logger.error('Daily import undo failed', { err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: athletesTag,
  summary: 'Undo the latest daily-data import',
  methods: {
    POST: {
      summary: 'Undo a daily-data import',
      description:
        'Restores the previous values of rows the import corrected and soft-deletes rows it added, then marks the import undone and emits `athletes.daily_import.undone` (`{ importId, kind, teamId }`). Only the latest not-undone import of the same kind and team can be undone: an older one is a 409 `athletes.dailyImport.errors.notLatestImport`; data changed after the import is a 409 `athletes.dailyImport.errors.changedSinceImport`; an already undone import is a 409 `athletes.dailyImport.errors.alreadyUndone`.',
      tags: [athletesTag],
      requestBody: { contentType: 'application/json', schema: dailyImportUndoSchema },
      responses: [{ status: 200, description: 'Import undone', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid payload', schema: athletesErrorSchema },
        { status: 403, description: 'Missing feature or club context', schema: athletesErrorSchema },
        { status: 404, description: 'Import not found in the club', schema: athletesErrorSchema },
        { status: 409, description: 'Not the latest import, already undone, or data changed since', schema: athletesErrorSchema },
      ],
    },
  },
}
