import { describe, expect, it } from '@jest/globals'
import {
  applyKeypadKey,
  buildRecordBody,
  buildRoster,
  countSaved,
  createIdempotencyKey,
  decimalSeparator,
  emptyFieldEntry,
  isFieldEntryEmpty,
  nextPlayerWithMissing,
  parseTrialValue,
  reasonLabelKey,
  recordFingerprint,
  resultStateLabelKey,
  sanitizeTrialText,
  type RosterPlayer,
} from '../testUi'

function player(id: string, overrides: Partial<RosterPlayer> = {}): RosterPlayer {
  return { id, teamId: 't1', firstName: id, lastName: id, joinedAt: '2026-01-01', isActive: true, ...overrides }
}

describe('Tryb boisko — entry', () => {
  it('starts with one empty field per attempt', () => {
    const entry = emptyFieldEntry(3)
    expect(entry.values).toEqual(['', '', ''])
    expect(entry.invalid).toEqual([false, false, false])
    expect(isFieldEntryEmpty(entry)).toBe(true)
    expect(emptyFieldEntry(0).values).toHaveLength(1)
  })

  it('parses comma and dot decimals and rejects 0 (a gap is never 0)', () => {
    expect(parseTrialValue('41,5')).toBe(41.5)
    expect(parseTrialValue('41.5')).toBe(41.5)
    expect(parseTrialValue('0')).toBeNull()
    expect(parseTrialValue('')).toBeNull()
    expect(parseTrialValue('4,')).toBeNull()
    expect(parseTrialValue('abc')).toBeNull()
  })

  it('keypad appends digits, one separator, and deletes', () => {
    expect(applyKeypadKey('4', '1', ',')).toBe('41')
    expect(applyKeypadKey('41', 'separator', ',')).toBe('41,')
    expect(applyKeypadKey('41,', 'separator', ',')).toBe('41,')
    expect(applyKeypadKey('', 'separator', '.')).toBe('0.')
    expect(applyKeypadKey('41,5', 'backspace', ',')).toBe('41,')
    expect(applyKeypadKey('1234567', '8', ',')).toBe('1234567')
    expect(applyKeypadKey('1', 'x', ',')).toBe('1')
  })

  it('sanitizes typed text to the locale separator', () => {
    expect(sanitizeTrialText('4a1.5.3', ',')).toBe('41,53')
  })

  it('builds one record body per player', () => {
    const entry = emptyFieldEntry(3)
    expect(buildRecordBody(entry)).toEqual({ kind: 'empty' })

    entry.values = ['41,5', '', '43']
    entry.invalid = [false, true, false]
    expect(buildRecordBody(entry)).toEqual({
      kind: 'ok',
      body: { trials: [{ attemptNo: 1, value: 41.5 }, { attemptNo: 2, isInvalid: true }, { attemptNo: 3, value: 43 }] },
    })

    expect(buildRecordBody({ values: ['0', ''], invalid: [false, false], reason: null })).toEqual({ kind: 'invalidValue', attemptNo: 1 })
    expect(buildRecordBody({ values: ['', ''], invalid: [false, false], reason: 'absent' })).toEqual({
      kind: 'ok',
      body: { trials: [], state: 'not_performed', reasonCode: 'absent' },
    })
  })

  it('fingerprints the same entry identically so a retry reuses the key', () => {
    const body = { trials: [{ attemptNo: 1, value: 41.5 }] }
    expect(recordFingerprint('p1', body)).toBe(recordFingerprint('p1', { trials: [{ attemptNo: 1, value: 41.5 }] }))
    expect(recordFingerprint('p1', body)).not.toBe(recordFingerprint('p2', body))
    expect(recordFingerprint('p1', body)).not.toBe(recordFingerprint('p1', { trials: [{ attemptNo: 1, value: 42 }] }))
  })

  it('creates idempotency keys the API accepts (8–200 chars)', () => {
    expect(createIdempotencyKey(() => 'abc-123')).toBe('field-abc-123')
    const fallback = createIdempotencyKey(undefined)
    expect(fallback.length).toBeGreaterThanOrEqual(8)
    expect(fallback.length).toBeLessThanOrEqual(200)
  })
})

describe('Tryb boisko — roster and "Dalej"', () => {
  it('takes active team players who joined by the test date, sorted by surname', () => {
    const roster = buildRoster([
      player('b', { lastName: 'Zielińska' }),
      player('a', { lastName: 'Adamska' }),
      player('late', { joinedAt: '2026-11-01' }),
      player('inactive', { isActive: false }),
      player('other', { teamId: 't2' }),
    ], { kind: 'team', teamId: 't1', playerId: null, testedOn: '2026-10-28' })
    expect(roster.map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('takes only the chosen player for an individual test', () => {
    const roster = buildRoster([player('a'), player('b')], { kind: 'individual', teamId: null, playerId: 'b', testedOn: '2026-10-28' })
    expect(roster.map((item) => item.id)).toEqual(['b'])
  })

  it('moves to the next player with missing data, wrapping around', () => {
    const ids = ['a', 'b', 'c', 'd']
    expect(nextPlayerWithMissing(ids, new Set(['b']), 'a')).toBe('c')
    expect(nextPlayerWithMissing(ids, new Set(['d']), 'c')).toBe('a')
    expect(nextPlayerWithMissing(ids, new Set(['a', 'b', 'c', 'd']), 'a')).toBeNull()
    expect(nextPlayerWithMissing(ids, new Set(['a', 'b', 'd']), 'c')).toBeNull()
    expect(nextPlayerWithMissing(ids, new Set(), null)).toBe('a')
    expect(nextPlayerWithMissing([], new Set(), null)).toBeNull()
  })

  it('counts only roster players as saved', () => {
    expect(countSaved(['a', 'b'], new Set(['a', 'x']))).toBe(1)
  })

  it('knows the decimal separator of the locale', () => {
    expect(decimalSeparator('pl')).toBe(',')
    expect(decimalSeparator('en')).toBe('.')
  })
})

describe('result states (REQ-010)', () => {
  it('maps every gap to text and never to a number', () => {
    expect(resultStateLabelKey('recorded')).toBeNull()
    expect(resultStateLabelKey('empty')).toBe('athletes.tests.state.empty')
    expect(resultStateLabelKey('invalid_attempt')).toBe('athletes.tests.state.invalidAttempt')
    expect(resultStateLabelKey('not_performed')).toBe('athletes.tests.state.notPerformed')
    expect(resultStateLabelKey('joined_later')).toBe('athletes.tests.state.joinedLater')
    expect(reasonLabelKey('excused')).toBe('athletes.tests.reason.excused')
  })
})
