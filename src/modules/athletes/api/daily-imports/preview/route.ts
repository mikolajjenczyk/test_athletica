import { z } from 'zod'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveClubRequestContext } from '../../../lib/requestContext'
import { prepareRpeImport } from '../../../lib/dailyImportService'
import { readAssignments, readDailyUpload, readTeamId } from '../../../lib/dailyImportUpload'
import { rpePreviewResponseSchema, toRpePreviewResponse } from '../../../lib/dailyImportView'
import { athletesErrorSchema, athletesTag } from '../../openapi'

const logger = createLogger('athletes').child({ component: 'daily-import-preview-route' })

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['athletes.daily.import'] },
}

/**
 * "Wgraj plik RPE" → podgląd (REQ-001, REQ-002): parses the uploaded file and answers what a
 * commit would do — rows with load, "Brak RPE" per player and team session, corrections (old →
 * new), rejected rows (line + reason) and names without a match. Writes nothing; the file is not
 * stored. Sending `assignments` re-computes the preview with the coach's choices.
 */
export async function POST(request: Request) {
  try {
    const { em, scope } = await resolveClubRequestContext(request)
    const upload = await readDailyUpload(request)
    const { team, roster, plan } = await prepareRpeImport(em, scope, {
      table: upload.table,
      teamId: readTeamId(upload.form),
      assignments: readAssignments(upload.form),
    })
    return Response.json(toRpePreviewResponse({ fileName: upload.fileName, teamId: String(team.id), plan, roster }))
  } catch (err) {
    if (isCrudHttpError(err)) return Response.json(err.body, { status: err.status })
    // Never log row content or names.
    logger.error('Daily import preview failed', { err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const requestSchema = z.object({
  file: z.any().describe('The RPE file (.xlsx or .csv, at most 2 MB and 5000 data rows)'),
  kind: z.literal('rpe').default('rpe'),
  teamId: z.string().uuid().optional().describe('Defaults to the club\'s only active team'),
  assignments: z.string().optional().describe('JSON object `{ "<name as in the file>": playerId | null }`'),
})

export const openApi: OpenApiRouteDoc = {
  tag: athletesTag,
  summary: 'Preview a daily-data (RPE) file',
  methods: {
    POST: {
      summary: 'Parse an RPE file and preview the import without saving',
      description:
        'Multipart upload. Columns are found by header (prototype names and synonyms, case/diacritic-insensitive): a name ("Zawodnik", or "Imię" + "Nazwisko"), "Data", "Nr sesji", "Minuty", "RPE"; "Rodzaj" is optional and other columns (e.g. "Uwagi") are ignored and never stored. An empty RPE is "Brak RPE" (null), never 0. `rejected` lists the file line and a reason key only. `unknownNames` are names the team roster cannot match unambiguously; their rows are rejected (`nameNotAssigned`) unless `assignments` maps them to a team player not yet matched in this file. Nothing is written.',
      tags: [athletesTag],
      requestBody: { contentType: 'multipart/form-data', schema: requestSchema },
      responses: [{ status: 200, description: 'Preview', schema: rpePreviewResponseSchema }],
      errors: [
        { status: 400, description: 'Unreadable file, no header, missing required columns (`columns`), invalid kind or assignment (`name`, `playerId`)', schema: athletesErrorSchema },
        { status: 403, description: 'Missing feature or club context', schema: athletesErrorSchema },
        { status: 413, description: 'File over 2 MB or more than 5000 data rows', schema: athletesErrorSchema },
        { status: 415, description: 'Not a multipart request, or not a real .xlsx/.csv file', schema: athletesErrorSchema },
      ],
    },
  },
}
