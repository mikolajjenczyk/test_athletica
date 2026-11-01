import { describe, expect, it } from '@jest/globals'
import { deflateRawSync } from 'node:zlib'
import ExcelJS from 'exceljs'
import {
  DAILY_FILE_ERRORS,
  DailyFileError,
  MAX_DATA_ROWS,
  MAX_FILE_BYTES,
  detectDelimiter,
  inspectZipDirectory,
  normalizeXlsxCell,
  parseDailyFile,
} from '../dailyFileParser'

const utf8 = (text: string) => new TextEncoder().encode(text)

async function expectError(promise: Promise<unknown>, code: string, status: number) {
  await expect(promise).rejects.toBeInstanceOf(DailyFileError)
  await promise.catch((err: DailyFileError) => {
    expect(err.code).toBe(code)
    expect(err.status).toBe(status)
  })
}

async function buildXlsx(fill: (sheet: ExcelJS.Worksheet, workbook: ExcelJS.Workbook) => void): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('RPE')
  fill(sheet, workbook)
  const buffer = await workbook.xlsx.writeBuffer()
  return new Uint8Array(buffer as ArrayBuffer)
}

describe('dailyFileParser — CSV', () => {
  it('reads a semicolon CSV with a UTF-8 BOM, keeping file line numbers', async () => {
    const text = '﻿Zawodnik;Data;Sesja;RPE\nJan Kowalski;20.10.2026;1;7\n\nAnna Nowak;2026-10-20;1;\n'
    const table = await parseDailyFile({ fileName: 'rpe.csv', bytes: utf8(text) })
    expect(table.kind).toBe('csv')
    expect(table.headers).toEqual(['Zawodnik', 'Data', 'Sesja', 'RPE'])
    expect(table.rows).toEqual([
      { line: 2, cells: { Zawodnik: 'Jan Kowalski', Data: '20.10.2026', Sesja: '1', RPE: '7' } },
      { line: 4, cells: { Zawodnik: 'Anna Nowak', Data: '2026-10-20', Sesja: '1', RPE: null } },
    ])
  })

  it('auto-detects a comma delimiter and handles quoted fields with delimiters, quotes and line breaks', async () => {
    const text = 'Zawodnik,Uwagi,RPE\r\n"Kowalski, Jan","said ""ok""\nsecond line",6\r\nNowak Anna,,5\r\n'
    const table = await parseDailyFile({ fileName: 'RPE.CSV', bytes: utf8(text) })
    expect(table.rows[0]).toEqual({ line: 2, cells: { Zawodnik: 'Kowalski, Jan', Uwagi: 'said "ok"\nsecond line', RPE: '6' } })
    // The quoted line break moves the next record to physical line 4.
    expect(table.rows[1].line).toBe(4)
  })

  it('prefers the delimiter that dominates the header line outside quotes', () => {
    expect(detectDelimiter('a;b;"c,d,e"\n1,2')).toBe(';')
    expect(detectDelimiter('a,b,c\n1;2;3;4')).toBe(',')
  })

  it('falls back to Windows-1250 for non-UTF-8 Polish exports', async () => {
    // "Łukasz" in Windows-1250: Ł = 0xA3
    const bytes = new Uint8Array([...utf8('Zawodnik;RPE\n'), 0xa3, ...utf8('ukasz;5\n')])
    const table = await parseDailyFile({ fileName: 'rpe.csv', bytes })
    expect(table.rows[0].cells.Zawodnik).toBe('Łukasz')
  })

  it('rejects an unterminated quote as unreadable', async () => {
    await expectError(parseDailyFile({ fileName: 'rpe.csv', bytes: utf8('A;B\n"x;1\n') }), DAILY_FILE_ERRORS.unreadable, 400)
  })

  it('rejects more than the row cap (413) but accepts exactly the cap', async () => {
    const lines = Array.from({ length: MAX_DATA_ROWS }, (_, i) => `P${i};1`)
    const ok = await parseDailyFile({ fileName: 'rpe.csv', bytes: utf8(`A;B\n${lines.join('\n')}\n`) })
    expect(ok.rows).toHaveLength(MAX_DATA_ROWS)
    await expectError(
      parseDailyFile({ fileName: 'rpe.csv', bytes: utf8(`A;B\n${lines.join('\n')}\nX;1\nY;2\n`) }),
      DAILY_FILE_ERRORS.tooManyRows,
      413,
    )
  })
})

describe('dailyFileParser — type, size and magic bytes', () => {
  it('rejects a file over 2 MB before parsing (413)', async () => {
    await expectError(parseDailyFile({ fileName: 'rpe.csv', bytes: new Uint8Array(MAX_FILE_BYTES + 1) }), DAILY_FILE_ERRORS.tooLarge, 413)
  })

  it('rejects an empty file', async () => {
    await expectError(parseDailyFile({ fileName: 'rpe.csv', bytes: new Uint8Array(0) }), DAILY_FILE_ERRORS.empty, 400)
  })

  it('rejects mismatched extension and content (415)', async () => {
    await expectError(parseDailyFile({ fileName: 'rpe.xlsx', bytes: utf8('A;B\n1;2') }), DAILY_FILE_ERRORS.unsupportedType, 415)
    await expectError(parseDailyFile({ fileName: 'rpe.csv', bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2]) }), DAILY_FILE_ERRORS.unsupportedType, 415)
    await expectError(parseDailyFile({ fileName: 'rpe.xls', bytes: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]) }), DAILY_FILE_ERRORS.unsupportedType, 415)
    await expectError(parseDailyFile({ fileName: 'rpe.csv', bytes: new Uint8Array([65, 0, 66]) }), DAILY_FILE_ERRORS.unsupportedType, 415)
  })

  it('rejects a zip whose directory declares a huge uncompressed size (zip bomb)', () => {
    // Minimal zip: one central-directory entry claiming 1 GB, then the end-of-directory record.
    const name = utf8('xl/worksheets/sheet1.xml')
    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint32(24, 1024 * 1024 * 1024, true)
    cv.setUint16(28, name.length, true)
    central.set(name, 46)
    const eocd = new Uint8Array(22)
    const ev = new DataView(eocd.buffer)
    ev.setUint32(0, 0x06054b50, true)
    ev.setUint16(8, 1, true)
    ev.setUint16(10, 1, true)
    ev.setUint32(12, central.length, true)
    ev.setUint32(16, 4, true)
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...central, ...eocd])
    expect(() => inspectZipDirectory(bytes)).toThrow(DailyFileError)
    try {
      inspectZipDirectory(bytes)
    } catch (err) {
      expect((err as DailyFileError).code).toBe(DAILY_FILE_ERRORS.tooLarge)
      expect((err as DailyFileError).status).toBe(413)
    }
  })

  it('rejects a zip bomb that lies about its uncompressed size in the directory, before inflating it fully', async () => {
    // 8 MB of zeros deflate to a few KB; the directory claims 100 bytes.
    const name = utf8('xl/worksheets/sheet1.xml')
    const data = deflateRawSync(Buffer.alloc(8 * 1024 * 1024))
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(8, 8, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(10, 8, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, 100, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, 0, true)
    central.set(name, 46)
    const directoryOffset = local.length + data.length
    const eocd = new Uint8Array(22)
    const ev = new DataView(eocd.buffer)
    ev.setUint32(0, 0x06054b50, true)
    ev.setUint16(8, 1, true)
    ev.setUint16(10, 1, true)
    ev.setUint32(12, central.length, true)
    ev.setUint32(16, directoryOffset, true)
    const bytes = new Uint8Array([...local, ...data, ...central, ...eocd])
    await expectError(parseDailyFile({ fileName: 'rpe.xlsx', bytes }), DAILY_FILE_ERRORS.tooLarge, 413)
  })

  it('accepts a real xlsx whose entries inflate to exactly their declared sizes', async () => {
    const bytes = await buildXlsx((sheet) => {
      sheet.addRow(['Zawodnik', 'Data', 'Nr sesji', 'Minuty', 'RPE'])
    })
    expect(inspectZipDirectory(bytes).entries).toBeGreaterThan(0)
  })

  it('rejects a corrupt xlsx as unreadable', async () => {
    await expectError(parseDailyFile({ fileName: 'rpe.xlsx', bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0]) }), DAILY_FILE_ERRORS.unreadable, 400)
  })
})

describe('dailyFileParser — XLSX', () => {
  it('reads the first worksheet values: cached formula results, rich text, dates', async () => {
    const bytes = await buildXlsx((sheet, workbook) => {
      sheet.addRow(['Zawodnik', 'Data', 'Sesja', 'Minuty', 'RPE', 'Obciążenie'])
      sheet.addRow([
        { richText: [{ text: 'Jan ' }, { text: 'Kowalski', font: { bold: true } }] },
        new Date(Date.UTC(2026, 9, 20)),
        1,
        60,
        7,
        // Never evaluated: the parser uses the cached result only.
        { formula: 'D2*E2', result: 420 },
      ])
      sheet.addRow([])
      sheet.addRow(['Anna Nowak', new Date(Date.UTC(2026, 9, 21, 7, 40)), 2, 45, null, { formula: 'D4*E4' }])
      workbook.addWorksheet('Other').addRow(['ignored'])
    })
    const table = await parseDailyFile({ fileName: 'rpe.xlsx', bytes })
    expect(table.kind).toBe('xlsx')
    expect(table.headers).toEqual(['Zawodnik', 'Data', 'Sesja', 'Minuty', 'RPE', 'Obciążenie'])
    expect(table.rows).toEqual([
      { line: 2, cells: { Zawodnik: 'Jan Kowalski', Data: '2026-10-20', Sesja: 1, Minuty: 60, RPE: 7, 'Obciążenie': 420 } },
      { line: 4, cells: { Zawodnik: 'Anna Nowak', Data: '2026-10-21T07:40:00', Sesja: 2, Minuty: 45, RPE: null, 'Obciążenie': null } },
    ])
  })

  it('rejects an xlsx with more data rows than the cap (413)', async () => {
    const bytes = await buildXlsx((sheet) => {
      sheet.addRow(['A', 'B'])
      for (let i = 0; i <= MAX_DATA_ROWS; i += 1) sheet.addRow([`P${i}`, 1])
    })
    await expectError(parseDailyFile({ fileName: 'rpe.xlsx', bytes }), DAILY_FILE_ERRORS.tooManyRows, 413)
  })

  it('normalizes single cell shapes', () => {
    expect(normalizeXlsxCell({ sharedFormula: 'A1', result: 5 })).toBe(5)
    expect(normalizeXlsxCell({ formula: 'A1', result: { error: '#DIV/0!' } })).toBeNull()
    expect(normalizeXlsxCell({ text: 'link', hyperlink: 'https://x' })).toBe('link')
    expect(normalizeXlsxCell('  ')).toBeNull()
    expect(normalizeXlsxCell(Number.NaN)).toBeNull()
  })
})
