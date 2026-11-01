import { describe, expect, it } from '@jest/globals'
import type { ParsedTable } from '../dailyFileParser'
import {
  DAILY_IMPORT_ERRORS,
  DAILY_IMPORT_REASONS,
  buildRpePlan,
  computeLoad,
  mapRpeHeaders,
  parseInteger,
  parseSessionDate,
  resolveAssignments,
  validateRpeRow,
  type ExistingSession,
  type RosterPlayer,
  type RpeHeaderMapping,
} from '../dailyImport'
import { buildPlayerNameIndex, normalizePersonName } from '../nameMatching'

const TODAY = '2026-10-31'
const JAN = 'p-jan'
const ANNA = 'p-anna'
const LUKASZ = 'p-lukasz'
const OLD = 'p-old'
const LATE = 'p-late'

const roster: RosterPlayer[] = [
  { id: JAN, firstName: 'Jan', lastName: 'Kowalski', joinedAt: '2025-09-01', isActive: true },
  { id: ANNA, firstName: 'Anna', lastName: 'Nowak', joinedAt: '2025-09-01', isActive: true },
  { id: LUKASZ, firstName: 'Łukasz', lastName: 'Żółć', joinedAt: '2025-09-01', isActive: true },
  { id: OLD, firstName: 'Piotr', lastName: 'Stary', joinedAt: '2025-09-01', isActive: false },
  { id: LATE, firstName: 'Ola', lastName: 'Późna', joinedAt: '2026-10-21', isActive: true },
]

const HEADERS = ['Zawodnik', 'data', 'nr sesji', 'rodzaj', 'minuty', 'RPE 0–10', 'obciążenie', 'uwagi']

function table(rows: Array<[string, string | number | null, string | number | null, string | null, string | number | null, string | number | null]>): ParsedTable {
  return {
    headers: HEADERS,
    rows: rows.map((r, i) => ({
      line: i + 2,
      cells: { Zawodnik: r[0], data: r[1], 'nr sesji': r[2], rodzaj: r[3], minuty: r[4], 'RPE 0–10': r[5], 'obciążenie': '999', uwagi: 'free text' },
    })),
  }
}

function mapping(): RpeHeaderMapping {
  const result = mapRpeHeaders(HEADERS)
  if (!result.ok) throw new Error('mapping failed')
  return result.mapping
}

function plan(t: ParsedTable, existing: ExistingSession[] = [], assignments = new Map<string, string>()) {
  const mapped = mapRpeHeaders(t.headers)
  if (!mapped.ok) throw new Error('mapping failed')
  return buildRpePlan({ table: t, mapping: mapped.mapping, ignoredColumns: mapped.ignoredColumns, roster, existing, assignments, today: TODAY })
}

describe('name matching', () => {
  it('normalizes case, diacritics (incl. ł), punctuation and whitespace', () => {
    expect(normalizePersonName('  ŁUKASZ   Żółć-')).toBe('lukasz zolc')
    expect(normalizePersonName('Kowalski, Jan')).toBe('kowalski jan')
  })

  it('matches either name order and never an ambiguous name', () => {
    const index = buildPlayerNameIndex([
      ...roster,
      { id: 'twin-a', firstName: 'Adam', lastName: 'Bliźniak', joinedAt: '2025-01-01', isActive: true },
      { id: 'twin-b', firstName: 'adam', lastName: 'Blizniak', joinedAt: '2025-01-01', isActive: true },
    ])
    expect(index.match('kowalski jan')).toBe(JAN)
    expect(index.match('Lukasz Zolc')).toBe(LUKASZ)
    expect(index.match('Adam Bliźniak')).toBeNull()
    expect(index.match('Kowalsky J.')).toBeNull()
  })
})

describe('mapRpeHeaders', () => {
  it('maps prototype headers and ignores free-text and load columns', () => {
    const result = mapRpeHeaders(HEADERS)
    expect(result).toEqual({
      ok: true,
      mapping: { player: 'Zawodnik', date: 'data', sessionNo: 'nr sesji', kind: 'rodzaj', minutes: 'minuty', rpe: 'RPE 0–10' },
      ignoredColumns: ['obciążenie', 'uwagi'],
    })
  })

  it('accepts synonyms case/diacritic-insensitively, with separate first and last name', () => {
    const result = mapRpeHeaders(['NAZWISKO', 'Imię', 'Dzień', 'Nr', 'Sesja', 'Czas (min)', 'rpe (0-10)', 'Ból', 'Kontakt?'])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.mapping).toEqual({ firstName: 'Imię', lastName: 'NAZWISKO', date: 'Dzień', sessionNo: 'Sesja', minutes: 'Czas (min)', rpe: 'rpe (0-10)' })
    expect(result.ignoredColumns).toEqual(['Nr', 'Ból', 'Kontakt?'])
  })

  it('names every missing required column', () => {
    expect(mapRpeHeaders(['Imię', 'Data', 'Uwagi'])).toEqual({ ok: false, missingColumns: ['lastName', 'sessionNo', 'minutes', 'rpe'] })
    expect(mapRpeHeaders(['RPE'])).toEqual({ ok: false, missingColumns: ['player', 'date', 'sessionNo', 'minutes'] })
  })
})

describe('cell parsing', () => {
  it('parses ISO, Polish and Excel-serial dates and rejects impossible ones', () => {
    expect(parseSessionDate('2026-10-20')).toBe('2026-10-20')
    expect(parseSessionDate('2026-10-20T07:40:00')).toBe('2026-10-20')
    expect(parseSessionDate('5.10.2026')).toBe('2026-10-05')
    expect(parseSessionDate('05/10/2026')).toBe('2026-10-05')
    expect(parseSessionDate(46315)).toBe('2026-10-20')
    expect(parseSessionDate('31.09.2026')).toBeNull()
    expect(parseSessionDate('wczoraj')).toBeNull()
  })

  it('parses integers and rejects fractions and text', () => {
    expect(parseInteger('7')).toBe(7)
    expect(parseInteger('7,0')).toBe(7)
    expect(parseInteger(8)).toBe(8)
    expect(parseInteger(null)).toBeNull()
    expect(parseInteger(' ')).toBeNull()
    expect(parseInteger('6,5')).toBeNaN()
    expect(parseInteger('ciężko')).toBeNaN()
  })

  it('computes load only from complete sessions', () => {
    expect(computeLoad(7, 60)).toBe(420)
    expect(computeLoad(0, 60)).toBe(0)
    expect(computeLoad(null, 60)).toBeNull()
    expect(computeLoad(7, null)).toBeNull()
  })
})

describe('validateRpeRow', () => {
  const m = mapping()
  const row = (cells: Record<string, string | number | null>) => ({ line: 5, cells: { Zawodnik: 'Jan Kowalski', data: '20.10.2026', 'nr sesji': '1', rodzaj: 'trening', minuty: '60', 'RPE 0–10': '7', ...cells } })

  it('keeps an empty RPE as "Brak RPE" (null), never 0', () => {
    const result = validateRpeRow(row({ 'RPE 0–10': null }), m, TODAY)
    expect(result.ok && result.row.rpe).toBeNull()
    const zero = validateRpeRow(row({ 'RPE 0–10': '0' }), m, TODAY)
    expect(zero.ok && zero.row.rpe).toBe(0)
  })

  it.each([
    [{ Zawodnik: '' }, DAILY_IMPORT_REASONS.nameMissing],
    [{ data: null }, DAILY_IMPORT_REASONS.dateMissing],
    [{ data: '31.09.2026' }, DAILY_IMPORT_REASONS.dateInvalid],
    [{ data: '01.11.2026' }, DAILY_IMPORT_REASONS.dateInFuture],
    [{ 'nr sesji': '4' }, DAILY_IMPORT_REASONS.sessionNoInvalid],
    [{ 'nr sesji': null }, DAILY_IMPORT_REASONS.sessionNoInvalid],
    [{ minuty: '0' }, DAILY_IMPORT_REASONS.minutesInvalid],
    [{ minuty: '301' }, DAILY_IMPORT_REASONS.minutesInvalid],
    [{ 'RPE 0–10': '12' }, DAILY_IMPORT_REASONS.rpeInvalid],
    [{ 'RPE 0–10': '6,5' }, DAILY_IMPORT_REASONS.rpeInvalid],
    [{ 'RPE 0–10': 'ciężko' }, DAILY_IMPORT_REASONS.rpeInvalid],
  ])('rejects %j with its reason', (cells, reason) => {
    expect(validateRpeRow(row(cells), m, TODAY)).toEqual({ ok: false, line: 5, reason })
  })

  it('keeps a row with RPE but no minutes (load stays empty)', () => {
    const result = validateRpeRow(row({ minuty: null }), m, TODAY)
    expect(result.ok && result.row.minutes).toBeNull()
  })
})

describe('buildRpePlan', () => {
  it('classifies new, corrected and unchanged rows, lists rejections and "Brak RPE"', () => {
    const t = table([
      ['Jan Kowalski', '20.10.2026', 1, 'trening', 60, 7], // line 2: unchanged
      ['Kowalski Jan', '20.10.2026', 2, 'siłownia', 45, 6], // line 3: corrected
      ['anna nowak', '20.10.2026', 1, 'trening', 60, null], // line 4: new, Brak RPE
      ['Lukasz Zolc', '20.10.2026', 1, 'trening', 60, 12], // line 5: rejected RPE
      ['Jan Kowalski', '20.10.2026', 1, 'trening', 70, 8], // line 6: duplicate key
    ])
    const existing: ExistingSession[] = [
      { id: 's1', playerId: JAN, sessionDate: '2026-10-20', sessionNo: 1, kind: 'trening', minutes: 60, rpe: 7 },
      { id: 's2', playerId: JAN, sessionDate: '2026-10-20', sessionNo: 2, kind: 'siłownia', minutes: 45, rpe: 5 },
    ]
    const result = plan(t, existing)
    expect(result.period).toEqual({ from: '2026-10-20', to: '2026-10-20' })
    expect(result.rows.map((r) => [r.line, r.status])).toEqual([[2, 'unchanged'], [3, 'corrected'], [4, 'new']])
    expect(result.rows.find((r) => r.line === 4)?.load).toBeNull()
    expect(result.rows.find((r) => r.line === 2)?.load).toBe(420)
    expect(result.corrections).toEqual([
      { line: 3, playerId: JAN, sessionDate: '2026-10-20', sessionNo: 2, before: { kind: 'siłownia', minutes: 45, rpe: 5 }, after: { kind: 'siłownia', minutes: 45, rpe: 6 } },
    ])
    expect(result.rejected).toEqual([
      { line: 5, reason: DAILY_IMPORT_REASONS.rpeInvalid },
      { line: 6, reason: DAILY_IMPORT_REASONS.duplicateRow },
    ])
    // Rejected rows carry the line and reason only — no names, no values.
    for (const entry of result.rejected) expect(Object.keys(entry).sort()).toEqual(['line', 'reason'])
    // Team sessions: 20.10 #1 and #2. Anna has #1 without RPE and no row for #2; Łukasz has none;
    // the inactive player and the one who joined later are never missing.
    expect(result.missing).toEqual([
      { playerId: ANNA, sessionDate: '2026-10-20', sessionNo: 1, hasRow: true },
      { playerId: LUKASZ, sessionDate: '2026-10-20', sessionNo: 1, hasRow: false },
      { playerId: ANNA, sessionDate: '2026-10-20', sessionNo: 2, hasRow: false },
      { playerId: LUKASZ, sessionDate: '2026-10-20', sessionNo: 2, hasRow: false },
    ])
    expect(result.counts).toEqual({ saved: 1, corrected: 1, unchanged: 1, rejected: 2, assignedNames: 0 })
  })

  it('re-importing the same file is all unchanged', () => {
    const t = table([['Jan Kowalski', '20.10.2026', 1, 'trening', 60, null]])
    const first = plan(t)
    const existing: ExistingSession[] = first.rows.map((r, i) => ({ id: `s${i}`, playerId: r.playerId, sessionDate: r.sessionDate, sessionNo: r.sessionNo, kind: r.kind, minutes: r.minutes, rpe: r.rpe }))
    const second = plan(t, existing)
    expect(second.counts).toEqual({ saved: 0, corrected: 0, unchanged: 1, rejected: 0, assignedNames: 0 })
  })

  it('lists unknown names with their row count and rejects their rows until assigned', () => {
    const t = table([
      ['Kowalsky J.', '20.10.2026', 1, 'trening', 60, 7],
      ['Kowalsky J.', '21.10.2026', 1, 'trening', 60, 6],
      ['Piotr Stary', '21.10.2026', 1, 'trening', 60, 6],
    ])
    const unassigned = plan(t)
    expect(unassigned.unknownNames).toEqual([{ name: 'Kowalsky J.', rowCount: 2 }, { name: 'Piotr Stary', rowCount: 1 }])
    expect(unassigned.rejected.map((r) => r.reason)).toEqual(Array(3).fill(DAILY_IMPORT_REASONS.nameNotAssigned))

    const rows = t.rows.map((r) => {
      const v = validateRpeRow(r, mapping(), TODAY)
      if (!v.ok) throw new Error('invalid')
      return v.row
    })
    const resolved = resolveAssignments({ 'kowalsky j': ANNA, 'Piotr Stary': '' }, rows, roster)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    const assigned = plan(t, [], resolved.byName)
    expect(assigned.rows.map((r) => [r.line, r.playerId, r.assigned])).toEqual([[2, ANNA, true], [3, ANNA, true]])
    expect(assigned.rejected).toEqual([{ line: 4, reason: DAILY_IMPORT_REASONS.nameNotAssigned }])
    expect(assigned.counts.assignedNames).toBe(1)
  })

  it('rejects a session dated before the player joined', () => {
    const t = table([['Ola Późna', '20.10.2026', 1, 'trening', 60, 7]])
    expect(plan(t).rejected).toEqual([{ line: 2, reason: DAILY_IMPORT_REASONS.dateBeforeJoined }])
  })
})

describe('resolveAssignments', () => {
  const rows = [
    { line: 2, name: 'Jan Kowalski', sessionDate: '2026-10-20', sessionNo: 1, kind: null, minutes: 60, rpe: 7 },
    { line: 3, name: 'Kowalsky J.', sessionDate: '2026-10-20', sessionNo: 1, kind: null, minutes: 60, rpe: 7 },
    { line: 4, name: 'Nowak A', sessionDate: '2026-10-20', sessionNo: 1, kind: null, minutes: 60, rpe: 7 },
  ]

  it.each([
    [{ 'Somebody Else': ANNA }, DAILY_IMPORT_ERRORS.assignmentUnknownName],
    [{ 'Kowalsky J.': 'p-other-club' }, DAILY_IMPORT_ERRORS.assignmentPlayerNotInTeam],
    [{ 'Kowalsky J.': OLD }, DAILY_IMPORT_ERRORS.assignmentPlayerInactive],
    [{ 'Kowalsky J.': JAN }, DAILY_IMPORT_ERRORS.assignmentPlayerAlreadyMatched],
    [{ 'Kowalsky J.': ANNA, 'Nowak A': ANNA }, DAILY_IMPORT_ERRORS.assignmentPlayerDuplicate],
    [{ 'Jan Kowalski': ANNA }, DAILY_IMPORT_ERRORS.assignmentUnknownName],
  ])('rejects %j', (assignments, code) => {
    const result = resolveAssignments(assignments, rows, roster)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issue.code).toBe(code)
  })

  it('accepts distinct unmatched players and ignores "pomiń" (empty) entries', () => {
    const result = resolveAssignments({ 'Kowalsky J.': ANNA, 'Nowak A': null }, rows, roster)
    expect(result.ok && Array.from(result.byName.entries())).toEqual([['kowalsky j', ANNA]])
  })
})
