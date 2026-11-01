import { createHash } from 'node:crypto'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { DAILY_FILE_ERRORS, DailyFileError, MAX_FILE_BYTES, parseDailyFile, type ParsedTable } from './dailyFileParser'

/**
 * Reading the multipart upload of the daily-data routes (`preview`, `commit`). The request body
 * is bounded before it is buffered: a declared or streamed size over the file limit plus form
 * overhead is a 413 without reading further; the file part itself must be ≤ 2 MB. The file is
 * parsed in memory and never stored — only its name and sha256 are kept on commit.
 */

const MULTIPART_OVERHEAD_BYTES = 64 * 1024
export const MAX_MULTIPART_BYTES = MAX_FILE_BYTES + MULTIPART_OVERHEAD_BYTES

export const DAILY_UPLOAD_ERRORS = {
  fileRequired: 'athletes.dailyImport.errors.fileRequired',
  invalidKind: 'athletes.dailyImport.errors.invalidKind',
  invalidAssignments: 'athletes.dailyImport.errors.invalidAssignments',
} as const

class UploadTooLargeError extends Error {}

function tooLarge(): CrudHttpError {
  return new CrudHttpError(413, { error: DAILY_FILE_ERRORS.tooLarge })
}

async function readBoundedFormData(request: Request): Promise<FormData> {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    throw new CrudHttpError(415, { error: DAILY_FILE_ERRORS.unsupportedType })
  }
  const declared = request.headers.get('content-length')
  if (declared) {
    const length = Number(declared)
    if (Number.isSafeInteger(length) && length > MAX_MULTIPART_BYTES) throw tooLarge()
  }
  if (!request.body) return request.formData()
  let consumed = 0
  const bounded = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        consumed += chunk.byteLength
        if (consumed > MAX_MULTIPART_BYTES) {
          controller.error(new UploadTooLargeError())
          return
        }
        controller.enqueue(chunk)
      },
    }),
  )
  try {
    return await new Response(bounded, { headers: { 'content-type': contentType } }).formData()
  } catch (err) {
    if (err instanceof UploadTooLargeError || consumed > MAX_MULTIPART_BYTES) throw tooLarge()
    throw new CrudHttpError(400, { error: DAILY_FILE_ERRORS.unreadable })
  }
}

export type DailyUpload = {
  fileName: string
  fileHash: string
  table: ParsedTable
  form: FormData
}

function isFileLike(value: FormDataEntryValue | null): value is File {
  return !!value && typeof value === 'object' && typeof (value as Blob).arrayBuffer === 'function'
}

/** Reads the form, checks `kind` (phase 1: `rpe`), and parses the file into a table. */
export async function readDailyUpload(request: Request): Promise<DailyUpload> {
  const form = await readBoundedFormData(request)
  const kind = String(form.get('kind') ?? 'rpe').trim()
  if (kind !== 'rpe') throw new CrudHttpError(400, { error: DAILY_UPLOAD_ERRORS.invalidKind })
  const file = form.get('file')
  if (!isFileLike(file)) throw new CrudHttpError(400, { error: DAILY_UPLOAD_ERRORS.fileRequired })
  if (file.size > MAX_FILE_BYTES) throw tooLarge()
  const fileName = (file.name || '').trim().slice(0, 255)
  const bytes = new Uint8Array(await file.arrayBuffer())
  try {
    const parsed = await parseDailyFile({ fileName, bytes })
    return {
      fileName,
      fileHash: createHash('sha256').update(bytes).digest('hex'),
      table: { headers: parsed.headers, rows: parsed.rows },
      form,
    }
  } catch (err) {
    if (err instanceof DailyFileError) throw new CrudHttpError(err.status, { error: err.code })
    throw err
  }
}

/** Optional `teamId` form field (empty → the club's only active team). */
export function readTeamId(form: FormData): string | null {
  const value = String(form.get('teamId') ?? '').trim()
  return value || null
}

/** `assignments` form field: a JSON object `{ "<name>": playerId | null }`; empty → `{}`. */
export function readAssignments(form: FormData): Record<string, string | null> {
  const raw = String(form.get('assignments') ?? '').trim()
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new CrudHttpError(400, { error: DAILY_UPLOAD_ERRORS.invalidAssignments })
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CrudHttpError(400, { error: DAILY_UPLOAD_ERRORS.invalidAssignments })
  }
  const out: Record<string, string | null> = {}
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value === null || value === '') out[name] = null
    else if (typeof value === 'string') out[name] = value
    else throw new CrudHttpError(400, { error: DAILY_UPLOAD_ERRORS.invalidAssignments })
  }
  return out
}
