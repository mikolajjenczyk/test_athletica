import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, forbidden } from '@open-mercato/shared/lib/crud/errors'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveSingleOrganizationIdOrDeny } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import type { ClubScope } from './scope'

export type ClubRequestContext = {
  container: AwilixContainer
  em: EntityManager
  scope: ClubScope
  userId: string
  commandContext: CommandRuntimeContext
}

/** Trusted club scope for hand-written routes; a missing club fails closed with 403. */
export async function resolveClubRequestContext(request: Request): Promise<ClubRequestContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)
  if (!auth?.tenantId || !auth.sub) throw new CrudHttpError(401, { error: 'Unauthorized' })
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const organizationId = resolveSingleOrganizationIdOrDeny(organizationScope, auth) ?? auth.orgId ?? null
  if (!organizationId) throw forbidden('Club context is required')
  return {
    container,
    em: (container.resolve('em') as EntityManager).fork(),
    scope: { tenantId: auth.tenantId, organizationId },
    userId: String(auth.sub),
    commandContext: {
      container,
      auth,
      organizationScope,
      selectedOrganizationId: organizationId,
      organizationIds: [organizationId],
      request,
    },
  }
}
