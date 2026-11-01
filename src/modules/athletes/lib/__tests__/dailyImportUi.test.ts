import { describe, expect, it } from '@jest/globals'
import {
  SKIP_ASSIGNMENT,
  availablePlayersFor,
  dailyImportErrorKey,
  defaultSessionRange,
  describeRpe,
  formatLoad,
  formatMinutes,
  missingColumnKeys,
  parseDailyImportKind,
  pruneAssignments,
  serializeAssignments,
  sessionRangeError,
  unassignedNames,
} from '../dailyImportUi'

const players = [
  { id: 'p1', firstName: 'Jan', lastName: 'Kowalski', matchedByName: true },
  { id: 'p2', firstName: 'Anna', lastName: 'Nowak', matchedByName: false },
  { id: 'p3', firstName: 'Piotr', lastName: 'Wiśniewski', matchedByName: false },
]

describe('dailyImportUi — name assignment (REQ-002)', () => {
  it('offers only players not matched by name and not chosen for another name', () => {
    expect(availablePlayersFor('Kowalsky J.', players, {}).map((p) => p.id)).toEqual(['p2', 'p3'])
    const assignments = { 'Kowalsky J.': 'p2', 'Nowk A.': null }
    expect(availablePlayersFor('Nowk A.', players, assignments).map((p) => p.id)).toEqual(['p3'])
    // The name's own choice stays in its list.
    expect(availablePlayersFor('Kowalsky J.', players, assignments).map((p) => p.id)).toEqual(['p2', 'p3'])
  })

  it('serializes only chosen players; nothing chosen omits the field', () => {
    expect(serializeAssignments({})).toBe('')
    expect(serializeAssignments({ a: null })).toBe('')
    expect(JSON.parse(serializeAssignments({ a: 'p2', b: null }))).toEqual({ a: 'p2' })
    expect(SKIP_ASSIGNMENT).not.toBe('')
  })

  it('counts unassigned names and the rows that will be rejected', () => {
    const unknown = [{ name: 'a', rowCount: 3 }, { name: 'b', rowCount: 4 }]
    expect(unassignedNames(unknown, { a: 'p2' })).toEqual({ names: [{ name: 'b', rowCount: 4 }], rowCount: 4 })
    expect(unassignedNames(unknown, {}).rowCount).toBe(7)
  })

  it('prunes names no longer unknown, matched players and duplicates', () => {
    const pruned = pruneAssignments({ a: 'p2', b: 'p2', c: 'p3', gone: 'p3', d: 'p1' }, [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }], players)
    expect(pruned).toEqual({ a: 'p2', b: null, c: 'p3', d: null })
  })
})

describe('dailyImportUi — display', () => {
  it('never shows a missing RPE as 0 and dashes a missing load', () => {
    expect(describeRpe(null)).toEqual({ text: null, missingKey: 'athletes.daily.rpeMissing' })
    expect(describeRpe(0)).toEqual({ text: '0', missingKey: null })
    expect(formatLoad(null)).toBe('—')
    expect(formatLoad(420)).toBe('420')
    expect(formatMinutes(undefined)).toBe('—')
    expect(formatMinutes(60)).toBe('60')
  })

  it('accepts rpe (and a missing kind) only', () => {
    expect(parseDailyImportKind('rpe')).toBe('rpe')
    expect(parseDailyImportKind(null)).toBe('rpe')
    expect(parseDailyImportKind('wellbeing')).toBeNull()
  })

  it('defaults to the last 7 days and validates the range', () => {
    expect(defaultSessionRange(new Date(2026, 9, 31, 10))).toEqual({ from: '2026-10-25', to: '2026-10-31' })
    expect(defaultSessionRange(new Date(2026, 2, 3))).toEqual({ from: '2026-02-25', to: '2026-03-03' })
    expect(sessionRangeError({ from: '2026-10-25', to: '2026-10-31' })).toBeNull()
    expect(sessionRangeError({ from: '2026-11-01', to: '2026-10-31' })).toBe('athletes.daily.filters.fromAfterTo')
    expect(sessionRangeError({ from: '2026-02-30', to: '2026-03-01' })).toBe('athletes.daily.filters.invalidDate')
    expect(sessionRangeError({ from: '', to: '2026-03-01' })).toBe('athletes.daily.filters.invalidDate')
  })
})

describe('dailyImportUi — errors', () => {
  it('prefers the domain key and falls back by status', () => {
    expect(dailyImportErrorKey({ error: 'athletes.dailyImport.errors.notLatestImport', status: 409 }, 'x')).toBe('athletes.dailyImport.errors.notLatestImport')
    expect(dailyImportErrorKey(new Error('athletes.dailyImport.errors.fileUnreadable'), 'x')).toBe('athletes.dailyImport.errors.fileUnreadable')
    expect(dailyImportErrorKey({ error: 'Invalid payload', status: 400 }, 'fallback')).toBe('fallback')
    expect(dailyImportErrorKey({ status: 413 }, 'x')).toBe('athletes.dailyImport.errors.fileTooLarge')
    expect(dailyImportErrorKey({ status: 415 }, 'x')).toBe('athletes.dailyImport.errors.unsupportedType')
    expect(dailyImportErrorKey({ status: 403 }, 'x')).toBe('athletes.daily.errors.forbidden')
  })

  it('maps missing columns to their header labels', () => {
    expect(missingColumnKeys({ columns: ['rpe', 'date', 'bad key'] })).toEqual(['athletes.dailyImport.columns.rpe', 'athletes.dailyImport.columns.date'])
    expect(missingColumnKeys(null)).toEqual([])
  })
})
