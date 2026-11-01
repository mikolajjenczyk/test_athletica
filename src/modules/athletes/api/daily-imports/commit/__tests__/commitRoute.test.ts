import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const TEAM = '11111111-1111-4111-8111-111111111111'
const GUARD_TEAM = '22222222-2222-4222-8222-222222222222'
const HASH = 'a'.repeat(64)

const execute = jest.fn<(...args: unknown[]) => Promise<unknown>>()
const runRouteMutationGuards = jest.fn<(...args: unknown[]) => Promise<unknown>>()

jest.mock('../../../../commands/dailyImports', () => ({}))
jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: (...args: unknown[]) => runRouteMutationGuards(...args),
}))
jest.mock('../../../../lib/requestContext', () => ({
  resolveClubRequestContext: async () => ({
    container: { resolve: () => ({ execute }) },
    scope: { tenantId: 't-1', organizationId: 'o-1' },
    userId: 'u-1',
    commandContext: {},
  }),
}))
jest.mock('../../../../lib/dailyImportUpload', () => ({
  readDailyUpload: async () => ({
    fileName: 'rpe.csv',
    fileHash: HASH,
    table: { headers: ['Zawodnik'], rows: [{ line: 2, cells: { Zawodnik: 'Jan Kowalski' } }] },
    form: new FormData(),
  }),
  readTeamId: () => TEAM,
  readAssignments: () => ({}),
}))
jest.mock('../../../../lib/dailyImportView', () => ({
  dailyImportCommitResponseSchema: {},
  toCommitResponse: () => ({ ok: true }),
}))

import { POST } from '../route'

const request = () => new Request('http://localhost/api/athletes/daily-imports/commit', { method: 'POST' })

describe('POST /api/athletes/daily-imports/commit — mutation guard', () => {
  beforeEach(() => {
    execute.mockReset()
    runRouteMutationGuards.mockReset()
    execute.mockResolvedValue({ result: { record: {} } })
  })

  it('merges the guard modifiedPayload into the command input and keeps the file rows', async () => {
    runRouteMutationGuards.mockResolvedValue({ ok: true, modifiedPayload: { teamId: GUARD_TEAM }, runAfterSuccess: async () => {} })
    const response = await POST(request())
    expect(response.status).toBe(201)
    const input = (execute.mock.calls[0][1] as { input: { teamId: string; table: { rows: unknown[] } } }).input
    expect(input.teamId).toBe(GUARD_TEAM)
    expect(input.table.rows).toHaveLength(1)
  })

  it('revalidates the merged payload and rejects an invalid rewrite without executing', async () => {
    runRouteMutationGuards.mockResolvedValue({ ok: true, modifiedPayload: { fileHash: 'not-a-hash' }, runAfterSuccess: async () => {} })
    const response = await POST(request())
    expect(response.status).toBe(400)
    expect(execute).not.toHaveBeenCalled()
  })
})
