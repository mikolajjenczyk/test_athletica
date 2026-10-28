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
