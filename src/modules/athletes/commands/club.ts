import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { badRequest, conflict } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { AthletesPlayer, AthletesPosition, AthletesTeam } from '../data/entities'
import {
  playerCreateSchema,
  playerUpdateSchema,
  positionCreateSchema,
  positionUpdateSchema,
  teamCreateSchema,
  teamUpdateSchema,
  type PlayerCreateInput,
  type PlayerUpdateInput,
  type PositionCreateInput,
  type PositionUpdateInput,
  type TeamCreateInput,
  type TeamUpdateInput,
} from '../data/validators'
import { registerScopedCrudCommands } from '../lib/crudCommands'
import type { ClubScope } from '../lib/scope'

export const TEAM_ENTITY_ID = 'athletes:athletes_team'
export const POSITION_ENTITY_ID = 'athletes:athletes_position'
export const PLAYER_ENTITY_ID = 'athletes:athletes_player'

/** Stable machine codes the UI maps to localized messages. */
export const ATHLETES_ERRORS = {
  secondActiveTeam: 'athletes.errors.secondActiveTeam',
  duplicateTeamName: 'athletes.errors.duplicateTeamName',
  duplicatePositionName: 'athletes.errors.duplicatePositionName',
  positionInUse: 'athletes.errors.positionInUse',
  teamHasPlayers: 'athletes.errors.teamHasPlayers',
  teamNotInClub: 'athletes.errors.teamNotInClub',
  positionNotInClub: 'athletes.errors.positionNotInClub',
} as const

function em(ctx: CommandRuntimeContext): EntityManager {
  return ctx.container.resolve('em') as EntityManager
}

function scoped<E>(scope: ClubScope, where: Record<string, unknown>): FilterQuery<E> {
  return { ...where, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null } as FilterQuery<E>
}

async function assertSingleActiveTeam(ctx: CommandRuntimeContext, scope: ClubScope, exceptId?: string) {
  const other = await em(ctx).findOne(AthletesTeam, scoped<AthletesTeam>(scope, {
    isActive: true,
    ...(exceptId ? { id: { $ne: exceptId } } : {}),
  }))
  if (other) throw conflict(ATHLETES_ERRORS.secondActiveTeam)
}

async function assertUniqueName<E extends AthletesTeam | AthletesPosition>(
  ctx: CommandRuntimeContext,
  entity: typeof AthletesTeam | typeof AthletesPosition,
  scope: ClubScope,
  name: string,
  code: string,
  exceptId?: string,
) {
  const other = await em(ctx).findOne(entity as typeof AthletesTeam, scoped<E>(scope, {
    name,
    ...(exceptId ? { id: { $ne: exceptId } } : {}),
  }) as FilterQuery<AthletesTeam>)
  if (other) throw conflict(code)
}

async function assertTeamInClub(ctx: CommandRuntimeContext, scope: ClubScope, teamId: string) {
  const team = await em(ctx).findOne(AthletesTeam, scoped<AthletesTeam>(scope, { id: teamId }))
  if (!team) throw badRequest(ATHLETES_ERRORS.teamNotInClub)
}

async function assertPositionInClub(ctx: CommandRuntimeContext, scope: ClubScope, positionId: string | null | undefined) {
  if (!positionId) return
  const position = await em(ctx).findOne(AthletesPosition, scoped<AthletesPosition>(scope, { id: positionId }))
  if (!position) throw badRequest(ATHLETES_ERRORS.positionNotInClub)
}

type TeamSnapshot = { id: string; name: string; isActive: boolean; tenantId: string | null; organizationId: string | null }

export const teamCommands = registerScopedCrudCommands<AthletesTeam, TeamSnapshot, TeamCreateInput, TeamUpdateInput>({
  entityClass: AthletesTeam,
  entity: 'team',
  plural: 'teams',
  entityId: TEAM_ENTITY_ID,
  createSchema: teamCreateSchema,
  updateSchema: teamUpdateSchema,
  serialize: (row) => ({
    id: String(row.id),
    name: row.name,
    isActive: !!row.isActive,
    tenantId: row.tenantId ?? null,
    organizationId: row.organizationId ?? null,
  }),
  buildCreateData: async (input, scope, ctx) => {
    const isActive = input.isActive ?? true
    if (isActive) await assertSingleActiveTeam(ctx, scope)
    await assertUniqueName(ctx, AthletesTeam, scope, input.name, ATHLETES_ERRORS.duplicateTeamName)
    return { name: input.name, isActive }
  },
  applyUpdate: async (row, input, scope, ctx) => {
    if (input.name !== undefined) {
      await assertUniqueName(ctx, AthletesTeam, scope, input.name, ATHLETES_ERRORS.duplicateTeamName, row.id)
      row.name = input.name
    }
    if (input.isActive !== undefined) {
      if (input.isActive && !row.isActive) await assertSingleActiveTeam(ctx, scope, row.id)
      row.isActive = input.isActive
    }
  },
  restore: (row, snapshot) => {
    row.name = snapshot.name
    row.isActive = snapshot.isActive
  },
  assertDeletable: async (row, scope, ctx) => {
    const players = await em(ctx).count(AthletesPlayer, scoped<AthletesPlayer>(scope, { teamId: row.id }))
    if (players > 0) throw conflict(ATHLETES_ERRORS.teamHasPlayers)
  },
  changeKeys: ['name', 'isActive'],
  labels: {
    create: ['athletes.audit.teams.create', 'Create team'],
    update: ['athletes.audit.teams.update', 'Update team'],
    delete: ['athletes.audit.teams.delete', 'Delete team'],
  },
})

type PositionSnapshot = { id: string; name: string; sortOrder: number; tenantId: string | null; organizationId: string | null }

export const positionCommands = registerScopedCrudCommands<AthletesPosition, PositionSnapshot, PositionCreateInput, PositionUpdateInput>({
  entityClass: AthletesPosition,
  entity: 'position',
  plural: 'positions',
  entityId: POSITION_ENTITY_ID,
  createSchema: positionCreateSchema,
  updateSchema: positionUpdateSchema,
  serialize: (row) => ({
    id: String(row.id),
    name: row.name,
    sortOrder: row.sortOrder ?? 0,
    tenantId: row.tenantId ?? null,
    organizationId: row.organizationId ?? null,
  }),
  buildCreateData: async (input, scope, ctx) => {
    await assertUniqueName(ctx, AthletesPosition, scope, input.name, ATHLETES_ERRORS.duplicatePositionName)
    return { name: input.name, sortOrder: input.sortOrder ?? 0 }
  },
  applyUpdate: async (row, input, scope, ctx) => {
    if (input.name !== undefined) {
      await assertUniqueName(ctx, AthletesPosition, scope, input.name, ATHLETES_ERRORS.duplicatePositionName, row.id)
      row.name = input.name
    }
    if (input.sortOrder !== undefined) row.sortOrder = input.sortOrder
  },
  restore: (row, snapshot) => {
    row.name = snapshot.name
    row.sortOrder = snapshot.sortOrder
  },
  assertDeletable: async (row, scope, ctx) => {
    const used = await em(ctx).count(AthletesPlayer, scoped<AthletesPlayer>(scope, { positionId: row.id }))
    if (used > 0) throw conflict(ATHLETES_ERRORS.positionInUse)
  },
  changeKeys: ['name', 'sortOrder'],
  labels: {
    create: ['athletes.audit.positions.create', 'Create position'],
    update: ['athletes.audit.positions.update', 'Update position'],
    delete: ['athletes.audit.positions.delete', 'Delete position'],
  },
})

type PlayerSnapshot = {
  id: string
  teamId: string
  firstName: string
  lastName: string
  birthDate: string
  positionId: string | null
  joinedAt: string
  isActive: boolean
  tenantId: string | null
  organizationId: string | null
}

function toIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value ?? '').slice(0, 10)
}

export const playerCommands = registerScopedCrudCommands<AthletesPlayer, PlayerSnapshot, PlayerCreateInput, PlayerUpdateInput>({
  entityClass: AthletesPlayer,
  entity: 'player',
  plural: 'players',
  entityId: PLAYER_ENTITY_ID,
  createSchema: playerCreateSchema,
  updateSchema: playerUpdateSchema,
  serialize: (row) => ({
    id: String(row.id),
    teamId: row.teamId,
    firstName: row.firstName,
    lastName: row.lastName,
    birthDate: row.birthDate,
    positionId: row.positionId ?? null,
    joinedAt: toIsoDate(row.joinedAt),
    isActive: !!row.isActive,
    tenantId: row.tenantId ?? null,
    organizationId: row.organizationId ?? null,
  }),
  buildCreateData: async (input, scope, ctx) => {
    await assertTeamInClub(ctx, scope, input.teamId)
    await assertPositionInClub(ctx, scope, input.positionId)
    return {
      teamId: input.teamId,
      firstName: input.firstName,
      lastName: input.lastName,
      birthDate: input.birthDate,
      positionId: input.positionId ?? null,
      joinedAt: input.joinedAt,
      isActive: input.isActive ?? true,
    }
  },
  applyUpdate: async (row, input, scope, ctx) => {
    if (input.teamId !== undefined) {
      await assertTeamInClub(ctx, scope, input.teamId)
      row.teamId = input.teamId
    }
    if (input.positionId !== undefined) {
      await assertPositionInClub(ctx, scope, input.positionId)
      row.positionId = input.positionId
    }
    if (input.firstName !== undefined) row.firstName = input.firstName
    if (input.lastName !== undefined) row.lastName = input.lastName
    if (input.birthDate !== undefined) row.birthDate = input.birthDate
    if (input.joinedAt !== undefined) row.joinedAt = input.joinedAt
    if (input.isActive !== undefined) row.isActive = input.isActive
  },
  restore: (row, snapshot) => {
    row.teamId = snapshot.teamId
    row.firstName = snapshot.firstName
    row.lastName = snapshot.lastName
    row.birthDate = snapshot.birthDate
    row.positionId = snapshot.positionId
    row.joinedAt = snapshot.joinedAt
    row.isActive = snapshot.isActive
  },
  changeKeys: ['teamId', 'firstName', 'lastName', 'birthDate', 'positionId', 'joinedAt', 'isActive'],
  labels: {
    create: ['athletes.audit.players.create', 'Create player'],
    update: ['athletes.audit.players.update', 'Update player'],
    delete: ['athletes.audit.players.delete', 'Delete player'],
  },
})
