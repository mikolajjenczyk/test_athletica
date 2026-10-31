import { describe, expect, it, jest } from '@jest/globals'
import { ensureClubTestDefinitions } from '../testCatalog'
import { TEST_TEMPLATE } from '../testTemplate'
import handle, { metadata } from '../../subscribers/copy-test-template'

const TENANT = '11111111-1111-4111-8111-111111111111'
const CLUB_A = '22222222-2222-4222-8222-222222222222'

type AnyFn = (...args: unknown[]) => unknown

function makeEm(existingKeys: string[]) {
  const inserted: Array<Array<Record<string, unknown>>> = []
  const qb: Record<'insert' | 'onConflict' | 'ignore' | 'execute', jest.Mock<AnyFn>> = {
    insert: jest.fn<AnyFn>(),
    onConflict: jest.fn<AnyFn>(),
    ignore: jest.fn<AnyFn>(),
    execute: jest.fn<AnyFn>(async () => undefined),
  }
  qb.insert.mockImplementation((rows: unknown) => {
    inserted.push(rows as Array<Record<string, unknown>>)
    return qb
  })
  qb.onConflict.mockImplementation(() => qb)
  qb.ignore.mockImplementation(() => qb)
  const em = {
    find: jest.fn<AnyFn>(async () => existingKeys.map((templateKey, index) => ({ id: `d-${index}`, templateKey }))),
    createQueryBuilder: jest.fn<AnyFn>(() => qb),
  }
  const forkable = { ...em, fork: () => forkable }
  return { em: forkable, qb, inserted }
}

describe('test template', () => {
  it('has twelve definitions with stable unique keys, six active and empty thresholds (Q-005)', () => {
    expect(TEST_TEMPLATE).toHaveLength(12)
    expect(new Set(TEST_TEMPLATE.map((entry) => entry.templateKey)).size).toBe(12)
    expect(TEST_TEMPLATE.filter((entry) => entry.isActive).map((entry) => entry.sortOrder)).toEqual([1, 2, 3, 4, 5, 6])
    for (const entry of TEST_TEMPLATE) {
      expect(entry.clearChangeThreshold).toBeNull()
      expect(entry.attempts).toBeGreaterThanOrEqual(1)
      expect(entry.attempts).toBeLessThanOrEqual(5)
      expect(entry.repeatEveryWeeks).toBe(6)
    }
  })
})

describe('template copy', () => {
  it('copies all twelve definitions into an empty club, scoped to that club', async () => {
    const { em, qb, inserted } = makeEm([])
    const copied = await ensureClubTestDefinitions(em as never, { tenantId: TENANT, organizationId: CLUB_A })
    expect(copied).toBe(12)
    expect(inserted[0]).toHaveLength(12)
    for (const row of inserted[0]) expect(row).toMatchObject({ tenantId: TENANT, organizationId: CLUB_A })
    expect(qb.onConflict).toHaveBeenCalledWith(['tenantId', 'organizationId', 'templateKey'])
    expect(qb.ignore).toHaveBeenCalled()
    expect(em.find.mock.calls[0][1]).toEqual({ tenantId: TENANT, organizationId: CLUB_A })
  })

  it('is idempotent: a second run inserts nothing and never overwrites club definitions', async () => {
    const { em, qb } = makeEm(TEST_TEMPLATE.map((entry) => entry.templateKey))
    expect(await ensureClubTestDefinitions(em as never, { tenantId: TENANT, organizationId: CLUB_A })).toBe(0)
    expect(qb.insert).not.toHaveBeenCalled()
  })

  it('adds only the missing definitions', async () => {
    const { em, inserted } = makeEm(['cmj', 'sprint_10m'])
    expect(await ensureClubTestDefinitions(em as never, { tenantId: TENANT, organizationId: CLUB_A })).toBe(10)
    expect(inserted[0].map((row) => row.templateKey)).not.toContain('cmj')
  })

  it('subscribes persistently to organization creation and fails closed without scope', async () => {
    expect(metadata).toMatchObject({ event: 'directory.organization.created', persistent: true })
    const { em, qb } = makeEm([])
    await handle({ id: CLUB_A, tenantId: null }, { resolve: <T,>() => em as T })
    expect(em.find).not.toHaveBeenCalled()
    await handle({ id: CLUB_A, tenantId: TENANT, organizationId: CLUB_A }, { resolve: <T,>() => em as T })
    expect(qb.insert).toHaveBeenCalledTimes(1)
  })
})
