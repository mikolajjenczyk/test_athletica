import { describe, expect, it } from '@jest/globals'
import {
  directionLabelKey,
  formatTestName,
  formatTestNumber,
  formatTestValue,
  openSessionsByDefinition,
  todayIsoDate,
  type TestSessionListItem,
} from '../testUi'

function session(overrides: Partial<TestSessionListItem>): TestSessionListItem {
  return {
    id: 's1',
    testDefinitionId: 'd1',
    kind: 'team',
    teamId: 't1',
    playerId: null,
    testedOn: '2026-10-28',
    status: 'open',
    finishedAt: null,
    updatedAt: null,
    ...overrides,
  }
}

describe('testUi — catalog helpers', () => {
  it('puts the Polish name first and the variant after a dot', () => {
    expect(formatTestName('Skok w dal', 'z miejsca')).toBe('Skok w dal · z miejsca')
    expect(formatTestName('Sprint 30 m', null)).toBe('Sprint 30 m')
    expect(formatTestName(' Sprint ', '  ')).toBe('Sprint')
  })

  it('maps the direction to words', () => {
    expect(directionLabelKey('higher_better')).toBe('athletes.tests.direction.higherBetter')
    expect(directionLabelKey('lower_better')).toBe('athletes.tests.direction.lowerBetter')
  })

  it('never turns a missing value into 0', () => {
    expect(formatTestNumber(null, 'pl')).toBeNull()
    expect(formatTestNumber(undefined, 'pl')).toBeNull()
    expect(formatTestNumber(Number.NaN, 'pl')).toBeNull()
    expect(formatTestValue(null, 'cm', 'pl')).toBeNull()
  })

  it('formats values in the locale with the unit', () => {
    expect(formatTestValue(41.5, 'cm', 'en')).toBe('41.5 cm')
    expect(formatTestValue(4.25, 's', 'pl')).toBe('4,25 s')
    expect(formatTestValue(3, '', 'en')).toBe('3')
  })

  it('keeps the latest open session per test', () => {
    const map = openSessionsByDefinition([
      session({ id: 'old', testedOn: '2026-10-01' }),
      session({ id: 'new', testedOn: '2026-10-20' }),
      session({ id: 'done', testedOn: '2026-10-30', status: 'finished' }),
      session({ id: 'other', testDefinitionId: 'd2' }),
    ])
    expect(map.get('d1')?.id).toBe('new')
    expect(map.get('d2')?.id).toBe('other')
    expect(map.size).toBe(2)
  })

  it('formats today as a local ISO date', () => {
    expect(todayIsoDate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05')
  })
})
