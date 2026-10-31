import { describe, expect, it } from '@jest/globals'
import type { AthletesTestResult } from '../../data/entities'
import { toTestResultView } from '../testResultView'

const row = {
  id: 'r-1',
  sessionId: 's-1',
  playerId: 'p-1',
  testDefinitionId: 'd-1',
  testedOn: '2026-10-28',
  value: null,
  state: 'not_performed',
  reasonCode: 'excused',
  isMakeup: false,
  countsInTeamAverage: true,
  correctedAt: null,
  updatedAt: new Date('2026-10-28T10:00:00Z'),
} as unknown as AthletesTestResult

describe('test result view (D109, R12)', () => {
  it('omits the reason key entirely for view-only callers', () => {
    const view = toTestResultView(row, { includeReason: false })
    expect('reasonCode' in view).toBe(false)
    expect(JSON.stringify(view)).not.toContain('excused')
  })

  it('returns the reason to callers who record tests', () => {
    expect(toTestResultView(row, { includeReason: true }).reasonCode).toBe('excused')
  })

  it('keeps a gap as a state with a null value, never 0, and parses numeric strings', () => {
    expect(toTestResultView(row, { includeReason: false })).toMatchObject({ value: null, state: 'not_performed' })
    const recorded = { ...row, value: '43.0000', state: 'recorded', reasonCode: null } as unknown as AthletesTestResult
    expect(toTestResultView(recorded, { includeReason: false }).value).toBe(43)
  })
})
