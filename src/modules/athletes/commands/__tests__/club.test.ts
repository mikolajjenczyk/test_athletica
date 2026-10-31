import { describe, expect, it, jest } from '@jest/globals'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { ensureClubScope, resolveUndoScope } from '../../lib/scope'
import { playerCreateSchema, playerUpdateSchema } from '../../data/validators'
import { formatDisplayName, formatPersonName } from '../../components/PersonName'
import { ATHLETES_ERRORS, playerCommands, positionCommands, teamCommands } from '../club'

const TENANT = '11111111-1111-4111-8111-111111111111'
const CLUB_A = '22222222-2222-4222-8222-222222222222'
const CLUB_B = '33333333-3333-4333-8333-333333333333'
const TEAM = '44444444-4444-4444-8444-444444444444'

type EmMock = {
  findOne: jest.Mock<(...args: unknown[]) => Promise<unknown>>
  count: jest.Mock<(...args: unknown[]) => Promise<number>>
  fork: () => EmMock
}

function makeCtx(options: { organizationId?: string | null; em?: Partial<EmMock> } = {}) {
  const em: EmMock = {
    findOne: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(null),
    count: jest.fn<(...args: unknown[]) => Promise<number>>().mockResolvedValue(0),
    fork: () => em,
    ...options.em,
  }
  const dataEngine = {
    createOrmEntity: jest.fn(),
    deleteOrmEntity: jest.fn(),
    updateOrmEntity: jest.fn(),
  }
  const organizationId = options.organizationId === undefined ? CLUB_A : options.organizationId
  const ctx = {
    container: { resolve: (name: string) => (name === 'em' ? em : dataEngine) },
    auth: { sub: 'user-1', tenantId: TENANT, orgId: organizationId },
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: organizationId ? [organizationId] : null,
  } as unknown as CommandRuntimeContext
  return { ctx, em, dataEngine }
}

describe('club scope', () => {
  it('fails closed with 403 when the request has no club', () => {
    const { ctx } = makeCtx({ organizationId: null })
    expect(() => ensureClubScope(ctx)).toThrow(expect.objectContaining({ status: 403 }))
  })

  it('returns the trusted tenant and club', () => {
    const { ctx } = makeCtx()
    expect(ensureClubScope(ctx)).toEqual({ tenantId: TENANT, organizationId: CLUB_A })
  })

  it('refuses to undo a snapshot of another club', () => {
    const { ctx } = makeCtx()
    expect(() => resolveUndoScope(ctx, { tenantId: TENANT, organizationId: CLUB_B })).toThrow(
      expect.objectContaining({ status: 403 }),
    )
  })
})

describe('team commands', () => {
  it('rejects a second active team with 409 (MVP: one team per club)', async () => {
    const { ctx, dataEngine } = makeCtx({
      em: { findOne: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ id: TEAM }) },
    })
    await expect(teamCommands.createCommand.execute({ name: 'U17' }, ctx)).rejects.toMatchObject({
      status: 409,
      body: { error: ATHLETES_ERRORS.secondActiveTeam },
    })
    expect(dataEngine.createOrmEntity).not.toHaveBeenCalled()
  })

  it('looks up the active team only inside the caller club', async () => {
    const { ctx, em } = makeCtx({
      em: { findOne: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ id: TEAM }) },
    })
    await expect(teamCommands.createCommand.execute({ name: 'U17' }, ctx)).rejects.toBeTruthy()
    expect(em.findOne.mock.calls[0][1]).toMatchObject({ tenantId: TENANT, organizationId: CLUB_A, deletedAt: null })
  })
})

describe('position commands', () => {
  it('rejects deleting a position assigned to players with 409', async () => {
    const { ctx, dataEngine } = makeCtx({
      em: {
        findOne: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ id: 'pos-1', tenantId: TENANT, organizationId: CLUB_A }),
        count: jest.fn<(...args: unknown[]) => Promise<number>>().mockResolvedValue(2),
      },
    })
    await expect(positionCommands.deleteCommand.execute({ body: { id: '55555555-5555-4555-8555-555555555555' } }, ctx)).rejects.toMatchObject({
      status: 409,
      body: { error: ATHLETES_ERRORS.positionInUse },
    })
    expect(dataEngine.deleteOrmEntity).not.toHaveBeenCalled()
  })
})

describe('player commands', () => {
  const player = {
    teamId: TEAM,
    firstName: 'Anna',
    lastName: 'Nowak',
    birthDate: '2010-05-01',
    joinedAt: '2024-09-01',
  }

  it('rejects a team that is not in the caller club with 400', async () => {
    const { ctx, dataEngine } = makeCtx()
    await expect(playerCommands.createCommand.execute(player, ctx)).rejects.toMatchObject({
      status: 400,
      body: { error: ATHLETES_ERRORS.teamNotInClub },
    })
    expect(dataEngine.createOrmEntity).not.toHaveBeenCalled()
  })

  it('validates dates: joined date not in the future, birth date in the past', () => {
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
    expect(playerCreateSchema.safeParse(player).success).toBe(true)
    expect(playerCreateSchema.safeParse({ ...player, joinedAt: future }).success).toBe(false)
    expect(playerCreateSchema.safeParse({ ...player, birthDate: future }).success).toBe(false)
    expect(playerUpdateSchema.safeParse({ id: TEAM, positionId: null }).success).toBe(true)
  })

  it('never carries tenant or club in the request schema', () => {
    const parsed = playerCreateSchema.parse({ ...player, tenantId: 'x', organizationId: CLUB_B })
    expect(parsed).not.toHaveProperty('organizationId')
    expect(parsed).not.toHaveProperty('tenantId')
  })
})

describe('hide names', () => {
  it('renders initials only when hidden', () => {
    expect(formatPersonName('Anna', 'Nowak', false)).toBe('Anna Nowak')
    expect(formatPersonName('Anna', 'Nowak', true)).toBe('A. N.')
    expect(formatDisplayName('Jan Maria Kowalski', true)).toBe('J. K.')
    expect(formatDisplayName('', true)).toBe('')
  })
})
