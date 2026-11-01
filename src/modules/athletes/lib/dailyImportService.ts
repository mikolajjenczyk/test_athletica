import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import { CrudHttpError, badRequest } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AthletesPlayer, AthletesTeam, AthletesTrainingSession } from '../data/entities'
import type { ParsedTable } from './dailyFileParser'
import {
  DAILY_IMPORT_ERRORS,
  buildRpePlan,
  mapRpeHeaders,
  resolveAssignments,
  validateRpeRow,
  type ExistingSession,
  type RosterPlayer,
  type RpeImportPlan,
  type RpeRowValues,
} from './dailyImport'
import type { ClubScope } from './scope'

/**
 * Database side of the RPE import (spec E01 phase 1): team and roster resolution in the
 * caller's club, the stored sessions the file touches, and one {@link buildRpePlan} call. Used
 * by the stateless `preview` route and — inside its transaction, after locking the team — by
 * the `athletes.daily_import.commit` command, so both see the same plan.
 */

export const DAILY_TEAM_ERRORS = {
  teamNotInClub: 'athletes.errors.teamNotInClub',
  teamRequired: 'athletes.dailyImport.errors.teamRequired',
} as const

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function toIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value ?? '').slice(0, 10)
}

function scoped<E>(scope: ClubScope, where: Record<string, unknown>): FilterQuery<E> {
  return { ...where, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null } as FilterQuery<E>
}

/**
 * The team of the import: the given one (it must be in the caller's club), otherwise the club's
 * only active team (MVP: one team per club, D206). With `lock` the team row is locked for the
 * rest of the transaction, which serializes imports and undo of one team.
 */
export async function resolveImportTeam(
  em: EntityManager,
  scope: ClubScope,
  teamId: string | null | undefined,
  options: { lock?: boolean } = {},
): Promise<AthletesTeam> {
  const lockOptions = options.lock ? { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true } : {}
  if (teamId) {
    const team = await em.findOne(AthletesTeam, scoped<AthletesTeam>(scope, { id: teamId }), lockOptions)
    if (!team) throw badRequest(DAILY_TEAM_ERRORS.teamNotInClub)
    return team
  }
  const teams = await em.find(AthletesTeam, scoped<AthletesTeam>(scope, { isActive: true }), { fields: ['id'] })
  if (teams.length === 0) throw badRequest(DAILY_TEAM_ERRORS.teamNotInClub)
  if (teams.length > 1) throw badRequest(DAILY_TEAM_ERRORS.teamRequired)
  const team = await em.findOne(AthletesTeam, scoped<AthletesTeam>(scope, { id: teams[0].id }), lockOptions)
  if (!team) throw badRequest(DAILY_TEAM_ERRORS.teamNotInClub)
  return team
}

/** The team's players (active and inactive), names decrypted in memory only for matching. */
export async function loadTeamRoster(em: EntityManager, scope: ClubScope, teamId: string): Promise<RosterPlayer[]> {
  const rows = await findWithDecryption(
    em,
    AthletesPlayer,
    scoped<AthletesPlayer>(scope, { teamId }),
    undefined,
    scope,
  )
  return rows.map((row) => ({
    id: String(row.id),
    firstName: row.firstName ?? '',
    lastName: row.lastName ?? '',
    joinedAt: toIsoDate(row.joinedAt),
    isActive: row.isActive !== false,
  }))
}

export async function loadExistingSessions(
  em: EntityManager,
  scope: ClubScope,
  playerIds: string[],
  from: string,
  to: string,
  options: { lock?: boolean } = {},
): Promise<{ rows: AthletesTrainingSession[]; existing: ExistingSession[] }> {
  if (playerIds.length === 0) return { rows: [], existing: [] }
  const rows = await em.find(
    AthletesTrainingSession,
    scoped<AthletesTrainingSession>(scope, { playerId: { $in: playerIds }, sessionDate: { $gte: from, $lte: to } }),
    options.lock ? { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true } : {},
  )
  return {
    rows,
    existing: rows.map((row) => ({
      id: String(row.id),
      playerId: row.playerId,
      sessionDate: toIsoDate(row.sessionDate),
      sessionNo: row.sessionNo,
      kind: row.kind ?? null,
      minutes: row.minutes ?? null,
      rpe: row.rpe ?? null,
    })),
  }
}

export type PrepareRpeImportInput = {
  table: ParsedTable
  teamId?: string | null
  assignments?: Record<string, string | null | undefined> | null
  today?: string
  /** Inside the commit transaction: lock the team and the touched sessions. */
  lock?: boolean
}

export type PreparedRpeImport = {
  team: AthletesTeam
  roster: RosterPlayer[]
  plan: RpeImportPlan
  sessionRows: AthletesTrainingSession[]
}

/**
 * Full preview/commit plan. Missing required columns → 400 with the column ids; an invalid
 * assignment → 400 with the issue code and the name/player it concerns.
 */
export async function prepareRpeImport(
  em: EntityManager,
  scope: ClubScope,
  input: PrepareRpeImportInput,
): Promise<PreparedRpeImport> {
  const mapped = mapRpeHeaders(input.table.headers)
  if (!mapped.ok) {
    throw new CrudHttpError(400, { error: DAILY_IMPORT_ERRORS.missingColumns, columns: mapped.missingColumns })
  }
  const today = input.today ?? todayIso()
  const team = await resolveImportTeam(em, scope, input.teamId ?? null, { lock: input.lock })
  const roster = await loadTeamRoster(em, scope, String(team.id))

  const validRows: RpeRowValues[] = []
  for (const row of input.table.rows) {
    const result = validateRpeRow(row, mapped.mapping, today)
    if (result.ok) validRows.push(result.row)
  }
  const resolved = resolveAssignments(input.assignments ?? null, validRows, roster)
  if (!resolved.ok) {
    throw new CrudHttpError(400, {
      error: resolved.issue.code,
      name: resolved.issue.name,
      ...(resolved.issue.playerId ? { playerId: resolved.issue.playerId } : {}),
    })
  }

  const dates = validRows.map((row) => row.sessionDate).sort()
  const { rows: sessionRows, existing } = dates.length
    ? await loadExistingSessions(em, scope, roster.map((player) => player.id), dates[0], dates[dates.length - 1], { lock: input.lock })
    : { rows: [], existing: [] }

  const plan = buildRpePlan({
    table: input.table,
    mapping: mapped.mapping,
    ignoredColumns: mapped.ignoredColumns,
    roster,
    existing,
    assignments: resolved.byName,
    today,
  })
  return { team, roster, plan, sessionRows }
}
