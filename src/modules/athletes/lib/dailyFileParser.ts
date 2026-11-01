/**
 * Generic tabular parser for the shared import preview (spec E01 phase 1, owner; E02 phase 2
 * reuses it). Reads `.xlsx` (first worksheet, cell VALUES only) and `.csv` (`;` or `,`
 * auto-detected, UTF-8 with an optional BOM, quoted fields) into header-keyed rows.
 *
 * Safety (spec "Abuse and failure modes"):
 * - the file size is checked before anything is parsed (≤ 2 MB);
 * - the type is detected by extension AND magic bytes (xlsx = PK zip);
 * - an `.xlsx` whose zip directory declares more than {@link MAX_XLSX_UNCOMPRESSED_BYTES}
 *   uncompressed (or too many entries) is rejected before it is inflated (zip bomb);
 * - formulas are never evaluated — the cached result stored in the file is used;
 * - more than {@link MAX_DATA_ROWS} data rows reject the whole file.
 *
 * Errors are {@link DailyFileError} with a translatable `code` and an HTTP status.
 */

import { inflateRawSync } from 'node:zlib'

export const MAX_FILE_BYTES = 2 * 1024 * 1024
export const MAX_DATA_ROWS = 5000
export const MAX_XLSX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024
export const MAX_XLSX_ENTRIES = 2000
export const MAX_COLUMNS = 100

export const DAILY_FILE_ERRORS = {
  empty: 'athletes.dailyImport.errors.fileEmpty',
  tooLarge: 'athletes.dailyImport.errors.fileTooLarge',
  tooManyRows: 'athletes.dailyImport.errors.tooManyRows',
  unsupportedType: 'athletes.dailyImport.errors.unsupportedType',
  unreadable: 'athletes.dailyImport.errors.fileUnreadable',
  noHeader: 'athletes.dailyImport.errors.noHeader',
  tooManyColumns: 'athletes.dailyImport.errors.tooManyColumns',
} as const

export type DailyFileErrorCode = typeof DAILY_FILE_ERRORS[keyof typeof DAILY_FILE_ERRORS]

export class DailyFileError extends Error {
  constructor(public readonly code: DailyFileErrorCode, public readonly status: number) {
    super(code)
    this.name = 'DailyFileError'
  }
}

export type DailyFileKind = 'xlsx' | 'csv'
export type ParsedCell = string | number | null
export type ParsedRow = { line: number; cells: Record<string, ParsedCell> }
export type ParsedTable = { headers: string[]; rows: ParsedRow[] }

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0]

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false
  return magic.every((value, index) => bytes[index] === value)
}

function extensionOf(fileName: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim())
  return match ? match[1].toLowerCase() : ''
}

/** Extension and content must agree; anything else (e.g. legacy `.xls`, a renamed zip) is 415. */
export function detectDailyFileKind(fileName: string, bytes: Uint8Array): DailyFileKind {
  const ext = extensionOf(fileName)
  const isZip = startsWith(bytes, ZIP_MAGIC)
  if (ext === 'xlsx') {
    if (!isZip) throw new DailyFileError(DAILY_FILE_ERRORS.unsupportedType, 415)
    return 'xlsx'
  }
  if (ext === 'csv') {
    if (isZip || startsWith(bytes, OLE_MAGIC)) throw new DailyFileError(DAILY_FILE_ERRORS.unsupportedType, 415)
    // A text file carries no NUL bytes; a binary renamed to .csv does.
    const probe = bytes.subarray(0, Math.min(bytes.length, 4096))
    if (probe.includes(0)) throw new DailyFileError(DAILY_FILE_ERRORS.unsupportedType, 415)
    return 'csv'
  }
  throw new DailyFileError(DAILY_FILE_ERRORS.unsupportedType, 415)
}

// ---------------------------------------------------------------------------
// Header helpers
// ---------------------------------------------------------------------------

/** Unique, trimmed header keys; empty headers become `__col<N>` (never mapped). */
function buildHeaders(raw: unknown[]): string[] {
  const seen = new Map<string, number>()
  return raw.map((value, index) => {
    const base = cellToText(value).trim() || `__col${index + 1}`
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return count === 0 ? base : `${base} (${count + 1})`
  })
}

function cellToText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return toIsoDateString(value) ?? ''
  return ''
}

/**
 * Excel stores wall-clock date/times; exceljs exposes them as UTC Dates. A whole day becomes
 * `YYYY-MM-DD`, a date with a time `YYYY-MM-DDTHH:mm:ss` (no zone — it is the sheet's wall time).
 */
function toIsoDateString(value: Date): string | null {
  if (Number.isNaN(value.getTime())) return null
  const iso = value.toISOString()
  return iso.slice(11, 19) === '00:00:00' ? iso.slice(0, 10) : iso.slice(0, 19)
}

function isEmptyRow(cells: Record<string, ParsedCell>): boolean {
  return Object.values(cells).every((value) => value === null || (typeof value === 'string' && value.trim() === ''))
}

function finalize(headerRaw: unknown[] | null, dataRows: Array<{ line: number; values: ParsedCell[] }>): ParsedTable {
  if (!headerRaw || headerRaw.every((value) => cellToText(value).trim() === '')) {
    throw new DailyFileError(DAILY_FILE_ERRORS.noHeader, 400)
  }
  if (headerRaw.length > MAX_COLUMNS) throw new DailyFileError(DAILY_FILE_ERRORS.tooManyColumns, 400)
  const headers = buildHeaders(headerRaw)
  const rows: ParsedRow[] = []
  for (const row of dataRows) {
    const cells: Record<string, ParsedCell> = {}
    headers.forEach((header, index) => {
      const value = row.values[index]
      cells[header] = value === undefined ? null : value
    })
    if (isEmptyRow(cells)) continue
    rows.push({ line: row.line, cells })
    if (rows.length > MAX_DATA_ROWS) throw new DailyFileError(DAILY_FILE_ERRORS.tooManyRows, 413)
  }
  return { headers: headers.filter((header) => !header.startsWith('__col')), rows }
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** UTF-8 (BOM stripped); a file that is not valid UTF-8 falls back to Windows-1250 (Polish Excel). */
export function decodeText(bytes: Uint8Array): string {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    try {
      text = new TextDecoder('windows-1250').decode(bytes)
    } catch {
      throw new DailyFileError(DAILY_FILE_ERRORS.unreadable, 400)
    }
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** `;` or `,` — whichever occurs more often outside quotes in the first line. */
export function detectDelimiter(text: string): ';' | ',' {
  let semicolons = 0
  let commas = 0
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (char === '"') quoted = !quoted
    else if (!quoted && (char === '\n' || char === '\r')) break
    else if (!quoted && char === ';') semicolons += 1
    else if (!quoted && char === ',') commas += 1
  }
  return semicolons >= commas && semicolons > 0 ? ';' : ','
}

/**
 * RFC 4180-style records: quoted fields may hold the delimiter, `""` and line breaks. Each
 * record keeps the physical line it starts on (header = line 1). Stops once the row cap is
 * exceeded so a huge file is not tokenized to the end.
 */
export function parseCsv(text: string): ParsedTable {
  const delimiter = detectDelimiter(text)
  const records: Array<{ line: number; values: string[] }> = []
  let field = ''
  let record: string[] = []
  let quoted = false
  let line = 1
  let recordLine = 1
  let fieldStarted = false
  let nonEmptyRecords = 0

  const endRecord = () => {
    record.push(field)
    if (record.some((value) => value.trim() !== '')) nonEmptyRecords += 1
    records.push({ line: recordLine, values: record })
    record = []
    field = ''
    fieldStarted = false
  }

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        if (char === '\n') line += 1
        field += char
      }
      continue
    }
    if (char === '"' && !fieldStarted) {
      quoted = true
      fieldStarted = true
    } else if (char === delimiter) {
      record.push(field)
      field = ''
      fieldStarted = false
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      endRecord()
      line += 1
      recordLine = line
      // The header plus more than MAX_DATA_ROWS non-empty rows: stop tokenizing.
      if (nonEmptyRecords > MAX_DATA_ROWS + 1) throw new DailyFileError(DAILY_FILE_ERRORS.tooManyRows, 413)
    } else {
      field += char
      fieldStarted = true
    }
  }
  if (quoted) throw new DailyFileError(DAILY_FILE_ERRORS.unreadable, 400)
  if (field !== '' || record.length > 0) endRecord()

  const firstNonEmpty = records.findIndex((r) => r.values.some((value) => value.trim() !== ''))
  if (firstNonEmpty < 0) throw new DailyFileError(DAILY_FILE_ERRORS.noHeader, 400)
  const header = records[firstNonEmpty]
  const data = records.slice(firstNonEmpty + 1).map((r) => ({
    line: r.line,
    values: r.values.map((value) => (value.trim() === '' ? null : value.trim())),
  }))
  return finalize(header.values, data)
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

/**
 * Sums the uncompressed sizes the zip central directory declares and then proves them: every
 * entry is inflated with an output cap equal to its declared size, so a bomb that lies in its
 * directory is stopped after at most the declared bytes (the total of which is capped) instead
 * of being fully inflated by the spreadsheet library first.
 */
export function inspectZipDirectory(bytes: Uint8Array): { entries: number; uncompressedBytes: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const minEocd = 22
  if (bytes.length < minEocd) throw new DailyFileError(DAILY_FILE_ERRORS.unreadable, 400)
  let eocd = -1
  const searchStart = Math.max(0, bytes.length - minEocd - 0xffff)
  for (let i = bytes.length - minEocd; i >= searchStart; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new DailyFileError(DAILY_FILE_ERRORS.unreadable, 400)
  const entries = view.getUint16(eocd + 10, true)
  const directoryOffset = view.getUint32(eocd + 16, true)
  if (entries === 0xffff || directoryOffset === 0xffffffff) {
    // ZIP64 is never needed for a ≤ 2 MB spreadsheet.
    throw new DailyFileError(DAILY_FILE_ERRORS.unreadable, 400)
  }
  if (entries > MAX_XLSX_ENTRIES) throw new DailyFileError(DAILY_FILE_ERRORS.tooLarge, 413)
  let offset = directoryOffset
  let total = 0
  const declared: Array<{ method: number; compressed: number; uncompressed: number; localOffset: number }> = []
  for (let n = 0; n < entries; n += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) {
      throw new DailyFileError(DAILY_FILE_ERRORS.unreadable, 400)
    }
    const uncompressed = view.getUint32(offset + 24, true)
    if (uncompressed === 0xffffffff) throw new DailyFileError(DAILY_FILE_ERRORS.tooLarge, 413)
    total += uncompressed
    if (total > MAX_XLSX_UNCOMPRESSED_BYTES) throw new DailyFileError(DAILY_FILE_ERRORS.tooLarge, 413)
    declared.push({
      method: view.getUint16(offset + 10, true),
      compressed: view.getUint32(offset + 20, true),
      uncompressed,
      localOffset: view.getUint32(offset + 42, true),
    })
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    offset += 46 + nameLength + extraLength + commentLength
  }
  for (const entry of declared) verifyZipEntrySize(bytes, view, entry)
  return { entries, uncompressedBytes: total }
}

/** Inflates one entry with its declared size as the hard output cap (stored = no inflation). */
function verifyZipEntrySize(
  bytes: Uint8Array,
  view: DataView,
  entry: { method: number; compressed: number; uncompressed: number; localOffset: number },
): void {
  const local = entry.localOffset
  if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) {
    throw new DailyFileError(DAILY_FILE_ERRORS.unreadable, 400)
  }
  const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
  const end = start + entry.compressed
  if (end > bytes.length) throw new DailyFileError(DAILY_FILE_ERRORS.unreadable, 400)
  if (entry.method === 0) {
    if (entry.compressed !== entry.uncompressed) throw new DailyFileError(DAILY_FILE_ERRORS.unreadable, 400)
    return
  }
  if (entry.method !== 8) throw new DailyFileError(DAILY_FILE_ERRORS.unreadable, 400)
  let inflated: Buffer
  try {
    inflated = inflateRawSync(bytes.subarray(start, end), { maxOutputLength: Math.max(1, entry.uncompressed) })
  } catch (err) {
    // More output than the directory declared: a lying zip bomb.
    if ((err as { code?: string } | null)?.code === 'ERR_BUFFER_TOO_LARGE') throw new DailyFileError(DAILY_FILE_ERRORS.tooLarge, 413)
    throw new DailyFileError(DAILY_FILE_ERRORS.unreadable, 400)
  }
  if (inflated.byteLength !== entry.uncompressed) throw new DailyFileError(DAILY_FILE_ERRORS.unreadable, 400)
}

type FormulaLike = { formula?: string; sharedFormula?: string; result?: unknown }

/** One stored cell value as plain data: cached formula result, rich text as text, dates as ISO. */
export function normalizeXlsxCell(value: unknown): ParsedCell {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim()
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (value instanceof Date) return toIsoDateString(value)
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if ('formula' in record || 'sharedFormula' in record) {
      // Never evaluated: only the result Excel cached when the file was saved.
      return normalizeXlsxCell((record as FormulaLike).result ?? null)
    }
    if (Array.isArray(record.richText)) {
      const text = (record.richText as Array<{ text?: unknown }>).map((part) => (typeof part.text === 'string' ? part.text : '')).join('')
      return text.trim() === '' ? null : text.trim()
    }
    if (typeof record.text === 'string') return record.text.trim() === '' ? null : record.text.trim()
    if ('error' in record) return null
  }
  return null
}

export async function parseXlsx(bytes: Uint8Array): Promise<ParsedTable> {
  inspectZipDirectory(bytes)
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  try {
    // `Buffer` in the exceljs typings is its own ArrayBuffer-like declaration.
    await workbook.xlsx.load(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) as unknown as ArrayBuffer)
  } catch {
    throw new DailyFileError(DAILY_FILE_ERRORS.unreadable, 400)
  }
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new DailyFileError(DAILY_FILE_ERRORS.noHeader, 400)

  let header: unknown[] | null = null
  const data: Array<{ line: number; values: ParsedCell[] }> = []
  let nonEmpty = 0
  const rowCount = sheet.rowCount
  for (let lineNo = 1; lineNo <= rowCount; lineNo += 1) {
    const row = sheet.getRow(lineNo)
    if (!row.hasValues) continue
    const width = Math.min(row.cellCount, MAX_COLUMNS + 1)
    const values: ParsedCell[] = []
    for (let col = 1; col <= width; col += 1) values.push(normalizeXlsxCell(row.getCell(col).value))
    if (!header) {
      header = values.map((value) => (value === null ? '' : value))
      continue
    }
    if (values.every((value) => value === null)) continue
    data.push({ line: lineNo, values })
    nonEmpty += 1
    if (nonEmpty > MAX_DATA_ROWS) throw new DailyFileError(DAILY_FILE_ERRORS.tooManyRows, 413)
  }
  return finalize(header, data)
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export type DailyFileInput = { fileName: string; bytes: Uint8Array }

export async function parseDailyFile(input: DailyFileInput): Promise<ParsedTable & { kind: DailyFileKind }> {
  if (input.bytes.byteLength > MAX_FILE_BYTES) throw new DailyFileError(DAILY_FILE_ERRORS.tooLarge, 413)
  if (input.bytes.byteLength === 0) throw new DailyFileError(DAILY_FILE_ERRORS.empty, 400)
  const kind = detectDailyFileKind(input.fileName, input.bytes)
  const table = kind === 'xlsx' ? await parseXlsx(input.bytes) : parseCsv(decodeText(input.bytes))
  return { ...table, kind }
}
