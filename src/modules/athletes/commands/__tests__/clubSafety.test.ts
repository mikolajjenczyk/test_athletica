import { describe, expect, it, jest } from '@jest/globals'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands'
import { ATHLETES_ERRORS, playerCommands, teamCommands } from '../club'
import '../clubDelete'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async () => ({ id: 'org-a', name: 'KS Orły' })),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const CLUB_A = '22222222-2222-4222-8222-222222222222'
const TEAM = '44444444-4444-4444-8444-444444444444'
const ACTOR = '66666666-6666-4666-8666-666666666666'

type AnyFn = (...args: unknown[]) => unknown

function makeCtx(em: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const commandBus = { execute: jest.fn<AnyFn>(async () => ({ result: {} })) }
  const dataEngine = {
    createOrmEntity: jest.fn<AnyFn>(),
    deleteOrmEntity: jest.fn<AnyFn>(),
    updateOrmEntity: jest.fn<AnyFn>(),
    markOrmEntityChange: jest.fn<AnyFn>(),
  }
  const forkable = { ...em, fork: () => forkable }
  const services: Record<string, unknown> = { em: forkable, dataEngine, commandBus, ...extra }
  const ctx = {
    container: { resolve: (name: string) => services[name] },
    auth: { sub: ACTOR, tenantId: TENANT, orgId: CLUB_A },
    organizationScope: null,
    selectedOrganizationId: CLUB_A,
    organizationIds: [CLUB_A],
  } as unknown as CommandRuntimeContext
  return { ctx, dataEngine, commandBus }
}

function uniqueViolation(constraint: string) {
  return Object.assign(new Error('duplicate key'), { code: '23505', constraint })
}

describe('club soft delete', () => {
  const handler = () => commandRegistry.get('athletes.club.soft_delete') as CommandHandler<Record<string, unknown>, unknown>

  it('rejects a name that does not match the club', async () => {
    const { ctx } = makeCtx({ transactional: jest.fn(), find: jest.fn() })
    await expect(handler().execute({ confirmationName: 'Inny klub' }, ctx)).rejects.toMatchObject({
      status: 400,
      body: { error: 'athletes.errors.clubNameMismatch' },
    })
  })

  it('deactivates only accounts of the same club, never the actor, and de-indexes every record', async () => {
    const find = jest.fn<AnyFn>(async (_entity: unknown, filter: unknown) =>
      'isConfirmed' in (filter as Record<string, unknown>) ? [{ id: 'u-1' }, { id: 'u-2' }] : [{ id: 'row-1' }])
    const tem = { nativeUpdate: jest.fn<AnyFn>(async () => 1) }
    const transactional = jest.fn<AnyFn>(async (fn: unknown) => (fn as (em: unknown) => Promise<void>)(tem))
    const { ctx, commandBus, dataEngine } = makeCtx({ find, transactional }, { eventBus: { emitEvent: jest.fn() } })
    await Promise.resolve(handler().execute({ confirmationName: 'KS Orły' }, ctx)).catch(() => undefined)
    const userCall = find.mock.calls.find((call) => 'isConfirmed' in ((call as unknown[])[1] as Record<string, unknown>))
    const userFilter = (userCall as unknown[] | undefined)?.[1] as Record<string, unknown>
    expect(userFilter).toMatchObject({ tenantId: TENANT, organizationId: CLUB_A, id: { $ne: ACTOR } })
    expect(tem.nativeUpdate).toHaveBeenCalledTimes(3)
    expect(commandBus.execute).toHaveBeenCalledTimes(2)
    expect(commandBus.execute.mock.calls[0][0]).toBe('auth.users.update')
    // player, position and team rows each queue a "deleted" side effect (events + query index)
    expect(dataEngine.markOrmEntityChange).toHaveBeenCalledTimes(3)
    expect(dataEngine.markOrmEntityChange.mock.calls[0][0]).toMatchObject({ action: 'deleted' })
  })
})

describe('undo safety', () => {
  it('blocks undoing a team creation while players still use the team', async () => {
    const em = {
      findOne: jest.fn<AnyFn>(async () => ({ id: TEAM, tenantId: TENANT, organizationId: CLUB_A })),
      count: jest.fn<AnyFn>(async () => 3),
    }
    const { ctx, dataEngine } = makeCtx(em)
    await expect(
      teamCommands.createCommand.undo!({
        input: {},
        ctx,
        logEntry: { snapshotAfter: { id: TEAM, tenantId: TENANT, organizationId: CLUB_A }, resourceId: TEAM },
      } as never),
    ).rejects.toMatchObject({ status: 409, body: { error: ATHLETES_ERRORS.teamHasPlayers } })
    expect(dataEngine.deleteOrmEntity).not.toHaveBeenCalled()
  })

  it('blocks restoring a player whose team was deleted since', async () => {
    const { ctx, dataEngine } = makeCtx({ findOne: jest.fn<AnyFn>(async () => null) })
    const snapshot = {
      id: 'p-1', teamId: TEAM, firstName: 'Anna', lastName: 'Nowak', birthDate: '2010-05-01',
      positionId: null, joinedAt: '2024-09-01', isActive: true, tenantId: TENANT, organizationId: CLUB_A,
    }
    await expect(
      playerCommands.deleteCommand.undo!({ input: {}, ctx, logEntry: { snapshotBefore: snapshot } } as never),
    ).rejects.toMatchObject({ status: 409, body: { error: ATHLETES_ERRORS.restoreReferenceMissing } })
    expect(dataEngine.updateOrmEntity).not.toHaveBeenCalled()
  })
})

describe('database uniqueness race', () => {
  it('maps a one-active-team index violation to 409 instead of 500', async () => {
    const { ctx, dataEngine } = makeCtx({ findOne: jest.fn<AnyFn>(async () => null) })
    dataEngine.createOrmEntity.mockImplementation(async () => {
      throw uniqueViolation('athletes_teams_one_active_uq')
    })
    await expect(teamCommands.createCommand.execute({ name: 'U17' }, ctx)).rejects.toMatchObject({
      status: 409,
      body: { error: ATHLETES_ERRORS.secondActiveTeam },
    })
  })
})
