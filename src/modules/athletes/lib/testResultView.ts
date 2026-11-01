import { z } from 'zod'
import type { AthletesTestResult, TestReasonCode, TestResultState } from '../data/entities'
import { toNumberOrNull } from './testScoring'

/**
 * Public shape of one test result (API + `athletesTestResultsService`). `reasonCode` is only
 * present for callers with `athletes.tests.record` (D109) — for everyone else the key is
 * omitted, not nulled, so a view-only response never hints that a reason exists.
 */
export type TestResultView = {
  id: string
  sessionId: string
  playerId: string
  testDefinitionId: string
  testedOn: string
  value: number | null
  state: TestResultState
  reasonCode?: TestReasonCode | null
  isMakeup: boolean
  countsInTeamAverage: boolean
  correctedAt: string | null
  updatedAt: string | null
}

export const testResultViewSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  playerId: z.string().uuid(),
  testDefinitionId: z.string().uuid(),
  testedOn: z.string(),
  value: z.number().nullable(),
  state: z.enum(['recorded', 'empty', 'invalid_attempt', 'not_performed', 'joined_later']),
  reasonCode: z.enum(['absent', 'excused', 'other']).nullable().optional(),
  isMakeup: z.boolean(),
  countsInTeamAverage: z.boolean(),
  correctedAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

function toIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value ?? '').slice(0, 10)
}

function toIso(value: Date | null | undefined): string | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null
}

export function toTestResultView(row: AthletesTestResult, options: { includeReason: boolean }): TestResultView {
  const view: TestResultView = {
    id: String(row.id),
    sessionId: row.sessionId,
    playerId: row.playerId,
    testDefinitionId: row.testDefinitionId,
    testedOn: toIsoDate(row.testedOn),
    value: toNumberOrNull(row.value),
    state: row.state,
    isMakeup: !!row.isMakeup,
    countsInTeamAverage: !!row.countsInTeamAverage,
    correctedAt: toIso(row.correctedAt),
    updatedAt: toIso(row.updatedAt),
  }
  if (options.includeReason) view.reasonCode = row.reasonCode ?? null
  return view
}
