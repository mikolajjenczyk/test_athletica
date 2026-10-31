import { describe, expect, it } from '@jest/globals'
import { computeCheckFlag, deriveResult, pickBestTrial } from '../testScoring'

describe('best trial (R02)', () => {
  const trials = [
    { attemptNo: 1, value: 1.92 },
    { attemptNo: 2, value: 1.85 },
    { attemptNo: 3, value: 1.5, isInvalid: true },
  ]

  it('takes the highest valid value when higher is better', () => {
    expect(pickBestTrial('higher_better', trials)).toBe(1.92)
  })

  it('takes the lowest valid value when lower is better, ignoring invalid attempts', () => {
    expect(pickBestTrial('lower_better', trials)).toBe(1.85)
  })

  it('reads numeric strings from the database', () => {
    expect(pickBestTrial('higher_better', [{ attemptNo: 1, value: '41.5000' }, { attemptNo: 2, value: '43.0000' }])).toBe(43)
  })
})

describe('gap states (R12)', () => {
  it('all attempts invalid → invalid_attempt with a null value', () => {
    expect(deriveResult({ direction: 'higher_better', trials: [{ attemptNo: 1, isInvalid: true }] }))
      .toEqual({ state: 'invalid_attempt', value: null, reasonCode: null })
  })

  it('nothing entered → empty with a null value, never 0', () => {
    expect(deriveResult({ direction: 'higher_better', trials: [] })).toEqual({ state: 'empty', value: null, reasonCode: null })
    expect(deriveResult({ direction: 'higher_better', trials: [{ attemptNo: 1, value: 0 }] }).value).toBeNull()
  })

  it('explicit "Nie wykonał" keeps its reason; other states drop it', () => {
    expect(deriveResult({ direction: 'lower_better', trials: [], state: 'not_performed', reasonCode: 'excused' }))
      .toEqual({ state: 'not_performed', value: null, reasonCode: 'excused' })
    expect(deriveResult({ direction: 'lower_better', trials: [], state: 'joined_later', reasonCode: 'other' }))
      .toEqual({ state: 'joined_later', value: null, reasonCode: null })
  })
})

describe('"sprawdź" (D372)', () => {
  it('flags a best trial more than 10% away from the previous result', () => {
    expect(computeCheckFlag({ value: 45, previousValue: 40, trials: [{ attemptNo: 1, value: 45 }] })).toBe(true)
    expect(computeCheckFlag({ value: 43, previousValue: 40, trials: [{ attemptNo: 1, value: 43 }] })).toBe(false)
  })

  it('flags a best trial more than 10% away from another valid trial of the session', () => {
    expect(computeCheckFlag({ value: 45, previousValue: null, trials: [{ attemptNo: 1, value: 45 }, { attemptNo: 2, value: 38 }] })).toBe(true)
    expect(computeCheckFlag({ value: 45, previousValue: null, trials: [{ attemptNo: 1, value: 45 }, { attemptNo: 2, value: 44 }] })).toBe(false)
  })

  it('never flags a gap', () => {
    expect(computeCheckFlag({ value: null, previousValue: 40, trials: [] })).toBe(false)
  })
})
