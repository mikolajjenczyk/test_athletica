import { z } from 'zod'
import type { AthletesDailyImport, AthletesTrainingSession } from '../data/entities'
import { buildPlayerNameIndex } from './nameMatching'
import { computeLoad, type RosterPlayer, type RpeImportPlan } from './dailyImport'

/**
 * Wire shapes of the daily-data routes (spec E01 phase 1), shared by the routes' OpenAPI docs
 * and the UI. Gaps are explicit: `rpe: null` with `rpeMissing: true` is "Brak RPE", and `load`
 * is null whenever RPE or minutes is missing — never 0 for a gap (R12).
 */

const sessionValuesSchema = z.object({
  kind: z.string().nullable(),
  minutes: z.number().int().nullable(),
  rpe: z.number().int().nullable(),
})

export const dailyImportRejectedSchema = z.object({ line: z.number().int(), reason: z.string() })

export const rpePreviewResponseSchema = z.object({
  kind: z.literal('rpe'),
  fileName: z.string(),
  teamId: z.string().uuid(),
  period: z.object({ from: z.string(), to: z.string() }).nullable(),
  counts: z.object({
    rows: z.number().int(),
    saved: z.number().int(),
    corrected: z.number().int(),
    unchanged: z.number().int(),
    rejected: z.number().int(),
    missing: z.number().int(),
    assignedNames: z.number().int(),
  }),
  rows: z.array(
    z.object({
      line: z.number().int(),
      name: z.string(),
      playerId: z.string().uuid(),
      sessionDate: z.string(),
      sessionNo: z.number().int(),
      kind: z.string().nullable(),
      minutes: z.number().int().nullable(),
      rpe: z.number().int().nullable(),
      load: z.number().int().nullable(),
      rpeMissing: z.boolean(),
      noMinutes: z.boolean(),
      status: z.enum(['new', 'corrected', 'unchanged']),
      assigned: z.boolean(),
      previous: sessionValuesSchema.nullable(),
    }),
  ),
  missing: z.array(z.object({ playerId: z.string().uuid(), sessionDate: z.string(), sessionNo: z.number().int(), hasRow: z.boolean() })),
  corrections: z.array(
    z.object({
      line: z.number().int(),
      playerId: z.string().uuid(),
      sessionDate: z.string(),
      sessionNo: z.number().int(),
      before: sessionValuesSchema,
      after: sessionValuesSchema,
    }),
  ),
  rejected: z.array(dailyImportRejectedSchema),
  unknownNames: z.array(z.object({ name: z.string(), rowCount: z.number().int() })),
  ignoredColumns: z.array(z.string()),
  players: z.array(
    z.object({
      id: z.string().uuid(),
      firstName: z.string(),
      lastName: z.string(),
      matchedByName: z.boolean(),
    }),
  ),
})

export type RpePreviewResponse = z.infer<typeof rpePreviewResponseSchema>

/**
 * The preview answer. `players` lists the team's active players with `matchedByName` so the name
 * assignment panel offers only players not yet matched in this import (REQ-002).
 */
export function toRpePreviewResponse(input: {
  fileName: string
  teamId: string
  plan: RpeImportPlan
  roster: RosterPlayer[]
}): RpePreviewResponse {
  const { plan, roster } = input
  const index = buildPlayerNameIndex(roster.filter((player) => player.isActive))
  const matched = new Set(plan.rows.filter((row) => !row.assigned && index.match(row.name)).map((row) => row.playerId))
  return {
    kind: 'rpe',
    fileName: input.fileName,
    teamId: input.teamId,
    period: plan.period,
    counts: {
      rows: plan.rows.length,
      saved: plan.counts.saved,
      corrected: plan.counts.corrected,
      unchanged: plan.counts.unchanged,
      rejected: plan.counts.rejected,
      missing: plan.missing.length,
      assignedNames: plan.counts.assignedNames,
    },
    rows: plan.rows.map((row) => ({
      line: row.line,
      name: row.name,
      playerId: row.playerId,
      sessionDate: row.sessionDate,
      sessionNo: row.sessionNo,
      kind: row.kind,
      minutes: row.minutes,
      rpe: row.rpe,
      load: row.load,
      rpeMissing: row.rpe === null,
      noMinutes: row.noMinutes,
      status: row.status,
      assigned: row.assigned,
      previous: row.previous,
    })),
    missing: plan.missing,
    corrections: plan.corrections,
    rejected: plan.rejected,
    unknownNames: plan.unknownNames,
    ignoredColumns: plan.ignoredColumns,
    players: roster
      .filter((player) => player.isActive)
      .map((player) => ({ id: player.id, firstName: player.firstName, lastName: player.lastName, matchedByName: matched.has(player.id) })),
  }
}

export const dailyImportCommitResponseSchema = z.object({
  importId: z.string().uuid(),
  teamId: z.string().uuid(),
  periodFrom: z.string(),
  periodTo: z.string(),
  saved: z.number().int(),
  corrected: z.number().int(),
  unchanged: z.number().int(),
  rejected: z.number().int(),
  assignedNames: z.number().int(),
  rejectedRows: z.array(dailyImportRejectedSchema),
})

function toIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value ?? '').slice(0, 10)
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function toCommitResponse(record: AthletesDailyImport): z.infer<typeof dailyImportCommitResponseSchema> {
  return {
    importId: String(record.id),
    teamId: record.teamId,
    periodFrom: toIsoDate(record.periodFrom),
    periodTo: toIsoDate(record.periodTo),
    saved: record.saved,
    corrected: record.corrected,
    unchanged: record.unchanged,
    rejected: record.rejected,
    assignedNames: record.assignedNames,
    rejectedRows: (record.rejectedRows ?? []).map(({ line, reason }) => ({ line, reason })),
  }
}

export const dailyImportListItemSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['rpe', 'wellbeing']),
  teamId: z.string().uuid(),
  fileName: z.string(),
  periodFrom: z.string(),
  periodTo: z.string(),
  saved: z.number().int(),
  corrected: z.number().int(),
  unchanged: z.number().int(),
  rejected: z.number().int(),
  assignedNames: z.number().int(),
  rejectedRows: z.array(dailyImportRejectedSchema),
  importedByUserId: z.string().uuid().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  undoneAt: z.string().nullable(),
  /** True only for the latest not-undone import of its kind and team (REQ-014). */
  canUndo: z.boolean(),
})

export type DailyImportListItem = z.infer<typeof dailyImportListItemSchema>

export function toDailyImportListItem(record: AthletesDailyImport, canUndo: boolean): DailyImportListItem {
  return {
    id: String(record.id),
    kind: record.kind,
    teamId: record.teamId,
    fileName: record.fileName,
    periodFrom: toIsoDate(record.periodFrom),
    periodTo: toIsoDate(record.periodTo),
    saved: record.saved,
    corrected: record.corrected,
    unchanged: record.unchanged,
    rejected: record.rejected,
    assignedNames: record.assignedNames,
    rejectedRows: (record.rejectedRows ?? []).map(({ line, reason }) => ({ line, reason })),
    importedByUserId: record.importedByUserId ?? null,
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt),
    undoneAt: toIso(record.undoneAt),
    canUndo,
  }
}

export const trainingSessionViewSchema = z.object({
  id: z.string().uuid(),
  playerId: z.string().uuid(),
  sessionDate: z.string(),
  sessionNo: z.number().int(),
  kind: z.string().nullable(),
  minutes: z.number().int().nullable(),
  rpe: z.number().int().nullable(),
  /** RPE × minutes (AU), computed at read time; null when either is missing. */
  load: z.number().int().nullable(),
  /** "Brak RPE" — never shown as 0. */
  rpeMissing: z.boolean(),
  previousMinutes: z.number().int().nullable(),
  previousRpe: z.number().int().nullable(),
  correctedAt: z.string().nullable(),
  importId: z.string().uuid(),
  updatedAt: z.string().nullable(),
})

export type TrainingSessionView = z.infer<typeof trainingSessionViewSchema>

export function toTrainingSessionView(row: AthletesTrainingSession): TrainingSessionView {
  const rpe = row.rpe ?? null
  const minutes = row.minutes ?? null
  return {
    id: String(row.id),
    playerId: row.playerId,
    sessionDate: toIsoDate(row.sessionDate),
    sessionNo: row.sessionNo,
    kind: row.kind ?? null,
    minutes,
    rpe,
    load: computeLoad(rpe, minutes),
    rpeMissing: rpe === null,
    previousMinutes: row.previousMinutes ?? null,
    previousRpe: row.previousRpe ?? null,
    correctedAt: toIso(row.correctedAt),
    importId: row.importId,
    updatedAt: toIso(row.updatedAt),
  }
}
