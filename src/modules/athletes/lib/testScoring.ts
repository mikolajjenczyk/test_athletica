import type { TestDirection, TestReasonCode, TestResultState } from '../data/entities'

/**
 * Pure scoring rules for E02 results, shared by the record command and the read service.
 *
 * - R02: the result is the best VALID trial (max for `higher_better`, min for `lower_better`).
 * - R12: a gap is a state (`empty`, `invalid_attempt`, `not_performed`, `joined_later`),
 *   its value is always null — never 0.
 * - D372: "sprawdź" when the best trial differs by more than 10% from the player's previous
 *   result in this test or from another valid trial in the same session. Only a marker.
 */
export type TrialLike = { attemptNo: number; value?: number | string | null; isInvalid?: boolean | null }

export const CHECK_FLAG_RATIO = 0.1

export function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function validTrialValues(trials: readonly TrialLike[]): number[] {
  const values: number[] = []
  for (const trial of trials) {
    if (trial.isInvalid) continue
    const value = toNumberOrNull(trial.value)
    if (value !== null && value > 0) values.push(value)
  }
  return values
}

export function pickBestTrial(direction: TestDirection, trials: readonly TrialLike[]): number | null {
  const values = validTrialValues(trials)
  if (values.length === 0) return null
  return direction === 'lower_better' ? Math.min(...values) : Math.max(...values)
}

export type DerivedResult = { state: TestResultState; value: number | null; reasonCode: TestReasonCode | null }

export function deriveResult(input: {
  direction: TestDirection
  trials: readonly TrialLike[]
  state?: 'empty' | 'not_performed' | 'joined_later'
  reasonCode?: TestReasonCode | null
}): DerivedResult {
  if (input.state) {
    return {
      state: input.state,
      value: null,
      reasonCode: input.state === 'not_performed' ? input.reasonCode ?? null : null,
    }
  }
  const best = pickBestTrial(input.direction, input.trials)
  if (best !== null) return { state: 'recorded', value: best, reasonCode: null }
  if (input.trials.some((trial) => trial.isInvalid)) return { state: 'invalid_attempt', value: null, reasonCode: null }
  return { state: 'empty', value: null, reasonCode: null }
}

function differsMoreThan(a: number, b: number, ratio = CHECK_FLAG_RATIO): boolean {
  if (b === 0) return a !== 0
  return Math.abs(a - b) / Math.abs(b) > ratio
}

/**
 * "sprawdź" (D372) for one result: compares the best trial with the previous result of the
 * player in the same test and with every other valid trial of the same session.
 */
export function computeCheckFlag(input: {
  value: number | null
  previousValue: number | null
  trials: readonly TrialLike[]
}): boolean {
  if (input.value === null) return false
  if (input.previousValue !== null && differsMoreThan(input.value, input.previousValue)) return true
  const values = validTrialValues(input.trials)
  let skippedBest = false
  for (const other of values) {
    if (!skippedBest && other === input.value) {
      skippedBest = true
      continue
    }
    if (differsMoreThan(input.value, other)) return true
  }
  return false
}
