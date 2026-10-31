import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { ensureClubTestDefinitions } from '../lib/testCatalog'

const logger = createLogger('athletes').child({ subscriber: 'copy-test-template' })

/**
 * A new club (a `directory` organization) gets the Apzumi test catalog (spec E02, REQ-001).
 *
 * Persistent: a missed copy would leave the club with an empty catalog, so the event is
 * retried from the queue. The copy is idempotent by `(tenant, organization, template_key)`,
 * so a retry — or `seedDefaults` running for the same club — never duplicates or
 * overwrites a definition. The payload carries ids and scope only.
 */
export const metadata = {
  event: 'directory.organization.created',
  persistent: true,
  id: 'athletes:copy-test-template',
}

export type OrganizationCreatedPayload = {
  id?: string | null
  tenantId?: string | null
  organizationId?: string | null
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(payload: OrganizationCreatedPayload, ctx: ResolverContext): Promise<void> {
  const tenantId = typeof payload?.tenantId === 'string' ? payload.tenantId : null
  const organizationId = typeof payload?.organizationId === 'string'
    ? payload.organizationId
    : typeof payload?.id === 'string' ? payload.id : null
  // Fail closed: without a concrete tenant and club there is nothing to copy into.
  if (!tenantId || !organizationId) {
    logger.warn('Organization created without scope; test template not copied')
    return
  }
  const em = ctx.resolve<EntityManager>('em').fork()
  const copied = await ensureClubTestDefinitions(em, { tenantId, organizationId })
  if (copied > 0) logger.info('Test template copied to club', { tenantId, organizationId, copied })
}
