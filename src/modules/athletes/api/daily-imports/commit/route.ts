import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { dailyImportCommitSchema } from '../../../data/validators'
import type { DailyImportCommitResult } from '../../../commands/dailyImports'
import '../../../commands/dailyImports'
import { resolveClubRequestContext } from '../../../lib/requestContext'
import { readAssignments, readDailyUpload, readTeamId } from '../../../lib/dailyImportUpload'
import { dailyImportCommitResponseSchema, toCommitResponse } from '../../../lib/dailyImportView'
import { athletesErrorSchema, athletesTag } from '../../openapi'

const logger = createLogger('athletes').child({ component: 'daily-import-commit-route' })

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['athletes.daily.import'] },
}

/**
 * "Zapisz" (REQ-002, REQ-003): the same file again with the coach's name assignments; the
 * command re-validates everything against the current data in one transaction.
 */
export async function POST(request: Request) {
  try {
    const { container, scope, userId, commandContext } = await resolveClubRequestContext(request)
    const upload = await readDailyUpload(request)
    const parsed = dailyImportCommitSchema.safeParse({
      kind: 'rpe',
      teamId: readTeamId(upload.form),
      fileName: upload.fileName || 'import',
      fileHash: upload.fileHash,
      table: upload.table,
      assignments: readAssignments(upload.form),
    })
    if (!parsed.success) {
      return Response.json(
        { error: 'Invalid payload', issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })) },
        { status: 400 },
      )
    }

    // The guard sees the import metadata, never the file's rows or names.
    const guard = await runRouteMutationGuards({
      container,
      req: request,
      auth: { tenantId: scope.tenantId, organizationId: scope.organizationId, userId },
      input: {
        resourceKind: 'athletes.daily_import',
        resourceId: null,
        operation: 'create',
        mutationPayload: { kind: parsed.data.kind, teamId: parsed.data.teamId ?? null, fileName: parsed.data.fileName, fileHash: parsed.data.fileHash },
      },
    })
    if (!guard.ok) return guard.response
    // A guard may rewrite the metadata it saw (never the rows); the result is validated again.
    const input = guard.modifiedPayload
      ? dailyImportCommitSchema.safeParse({ ...parsed.data, ...guard.modifiedPayload, table: parsed.data.table, assignments: parsed.data.assignments })
      : parsed
    if (!input.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })

    const commandBus = container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<Record<string, unknown>, DailyImportCommitResult>('athletes.daily_import.commit', {
      input: input.data,
      ctx: commandContext,
    })
    await guard.runAfterSuccess()
    return Response.json(toCommitResponse(result.record), { status: 201 })
  } catch (err) {
    if (isCrudHttpError(err)) return Response.json(err.body, { status: err.status })
    logger.error('Daily import commit failed', { err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const requestSchema = z.object({
  file: z.any().describe('The same RPE file as in the preview (.xlsx or .csv, at most 2 MB)'),
  kind: z.literal('rpe').default('rpe'),
  teamId: z.string().uuid().optional(),
  assignments: z.string().optional().describe('JSON object `{ "<name as in the file>": playerId | null }`; null or "" = skip'),
})

export const openApi: OpenApiRouteDoc = {
  tag: athletesTag,
  summary: 'Commit a daily-data (RPE) file',
  methods: {
    POST: {
      summary: 'Save an RPE file with name assignments',
      description:
        'Saves every valid row in one transaction, keyed by (player, date, session number): a new key is inserted, a different value is a correction (`previousMinutes`/`previousRpe`/`correctedAt` keep the old value), an identical one is left unchanged — committing the same file again reports everything as unchanged. An assignment must name an unknown name of the file and a team player who is active, not matched by name in this file and assigned only once; otherwise 400 (`assignmentUnknownName`, `assignmentPlayerNotInTeam`, `assignmentPlayerInactive`, `assignmentPlayerAlreadyMatched`, `assignmentPlayerDuplicate`). Rows of unassigned names are rejected. Emits `athletes.daily_import.committed` after the commit with `{ importId, kind, teamId, periodFrom, periodTo, saved, corrected, unchanged, rejected }`.',
      tags: [athletesTag],
      requestBody: { contentType: 'multipart/form-data', schema: requestSchema },
      responses: [{ status: 201, description: 'Import saved', schema: dailyImportCommitResponseSchema }],
      errors: [
        { status: 400, description: 'Unreadable file, missing columns, no valid row, or an invalid assignment', schema: athletesErrorSchema },
        { status: 403, description: 'Missing feature or club context', schema: athletesErrorSchema },
        { status: 409, description: 'Another import of the same team committed at the same time', schema: athletesErrorSchema },
        { status: 413, description: 'File over 2 MB or more than 5000 data rows', schema: athletesErrorSchema },
        { status: 415, description: 'Not a multipart request, or not a real .xlsx/.csv file', schema: athletesErrorSchema },
      ],
    },
  },
}
