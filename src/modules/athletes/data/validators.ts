import { z } from 'zod'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'athletes.validation.date')

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

const notInFuture = (value: string) => value <= todayIso()

export const teamCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  isActive: z.boolean().optional(),
})

export const teamUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  isActive: z.boolean().optional(),
})

export const positionCreateSchema = z.object({
  name: z.string().trim().min(1).max(40),
  sortOrder: z.coerce.number().int().min(0).optional(),
})

export const positionUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(40).optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
})

export const playerCreateSchema = z.object({
  teamId: z.string().uuid(),
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  birthDate: isoDate.refine((value) => value < todayIso(), 'athletes.validation.birthDatePast'),
  positionId: z.string().uuid().nullable().optional(),
  joinedAt: isoDate.refine(notInFuture, 'athletes.validation.joinedAtFuture'),
  isActive: z.boolean().optional(),
})

export const playerUpdateSchema = z.object({
  id: z.string().uuid(),
  teamId: z.string().uuid().optional(),
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().min(1).max(60).optional(),
  birthDate: isoDate.refine((value) => value < todayIso(), 'athletes.validation.birthDatePast').optional(),
  positionId: z.string().uuid().nullable().optional(),
  joinedAt: isoDate.refine(notInFuture, 'athletes.validation.joinedAtFuture').optional(),
  isActive: z.boolean().optional(),
})

export const clubDeleteRequestSchema = z.object({
  confirmationName: z.string().trim().min(1).max(200),
})

export type TeamCreateInput = z.infer<typeof teamCreateSchema>
export type TeamUpdateInput = z.infer<typeof teamUpdateSchema>
export type PositionCreateInput = z.infer<typeof positionCreateSchema>
export type PositionUpdateInput = z.infer<typeof positionUpdateSchema>
export type PlayerCreateInput = z.infer<typeof playerCreateSchema>
export type PlayerUpdateInput = z.infer<typeof playerUpdateSchema>

/** "Nie wykonał" reasons (Q-003): fixed codes, no health data (N17), no free text. */
export const TEST_REASON_CODES = ['absent', 'excused', 'other'] as const
/** Gap states a caller may set explicitly; `recorded` and `invalid_attempt` are derived from the trials. */
export const TEST_EXPLICIT_STATES = ['empty', 'not_performed', 'joined_later'] as const
export const TEST_MAX_ATTEMPTS = 5

export const testSessionStartSchema = z
  .object({
    testDefinitionId: z.string().uuid(),
    kind: z.enum(['team', 'individual']).default('team'),
    teamId: z.string().uuid().optional(),
    playerId: z.string().uuid().optional(),
    // Earlier dates are allowed; future ones are not (D307, D162).
    testedOn: isoDate.refine(notInFuture, 'athletes.validation.testedOnFuture'),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'team' && !value.teamId) {
      ctx.addIssue({ code: 'custom', path: ['teamId'], message: 'athletes.validation.testTeamRequired' })
    }
    if (value.kind === 'individual' && !value.playerId) {
      ctx.addIssue({ code: 'custom', path: ['playerId'], message: 'athletes.validation.testPlayerRequired' })
    }
  })

export const testTrialInputSchema = z
  .object({
    attemptNo: z.number().int().min(1).max(TEST_MAX_ATTEMPTS),
    // A measured value is always positive: a gap is a state, never 0 (R12).
    value: z.number().finite().positive().max(1_000_000).nullable().optional(),
    isInvalid: z.boolean().default(false),
  })
  .refine((trial) => !(trial.isInvalid && trial.value != null), {
    message: 'athletes.validation.invalidTrialWithValue',
    path: ['value'],
  })

export const testResultRecordSchema = z
  .object({
    sessionId: z.string().uuid(),
    playerId: z.string().uuid(),
    trials: z.array(testTrialInputSchema).max(TEST_MAX_ATTEMPTS).default([]),
    state: z.enum(TEST_EXPLICIT_STATES).optional(),
    reasonCode: z.enum(TEST_REASON_CODES).nullable().optional(),
    idempotencyKey: z.string().trim().min(8).max(200),
  })
  .superRefine((value, ctx) => {
    const attempts = value.trials.map((trial) => trial.attemptNo)
    if (new Set(attempts).size !== attempts.length) {
      ctx.addIssue({ code: 'custom', path: ['trials'], message: 'athletes.validation.duplicateAttempt' })
    }
    if (value.state === 'not_performed' && !value.reasonCode) {
      ctx.addIssue({ code: 'custom', path: ['reasonCode'], message: 'athletes.validation.reasonRequired' })
    }
    if (value.state !== 'not_performed' && value.reasonCode) {
      ctx.addIssue({ code: 'custom', path: ['reasonCode'], message: 'athletes.validation.reasonOnlyNotPerformed' })
    }
    if (value.state && value.trials.some((trial) => trial.value != null || trial.isInvalid)) {
      ctx.addIssue({ code: 'custom', path: ['state'], message: 'athletes.validation.gapStateWithTrials' })
    }
  })

export const testSessionFinishSchema = z.object({
  id: z.string().uuid(),
  updatedAt: z.string().optional(),
})

export type TestSessionStartInput = z.infer<typeof testSessionStartSchema>
export type TestTrialInput = z.infer<typeof testTrialInputSchema>
export type TestResultRecordInput = z.infer<typeof testResultRecordSchema>
export type TestSessionFinishInput = z.infer<typeof testSessionFinishSchema>
