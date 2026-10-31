import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { forbidden } from '@open-mercato/shared/lib/crud/errors'

export type ClubScope = { tenantId: string; organizationId: string }

/**
 * Trusted club scope from the authenticated command context. A missing tenant or club
 * (organization) fails closed with 403 — never "all clubs" (D33, NFR-004).
 */
export function ensureClubScope(ctx: CommandRuntimeContext): ClubScope {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) throw forbidden('Club context is required')
  return { tenantId, organizationId }
}

/** Undo may only touch the snapshot's club when it is the caller's current club. */
export function resolveUndoScope(
  ctx: CommandRuntimeContext,
  snapshot?: { tenantId: string | null; organizationId: string | null },
): ClubScope {
  const scope = ensureClubScope(ctx)
  if (snapshot?.tenantId && snapshot.tenantId !== scope.tenantId) throw forbidden('Undo scope does not match tenant')
  if (snapshot?.organizationId && snapshot.organizationId !== scope.organizationId) {
    throw forbidden('Undo scope does not match club')
  }
  return scope
}
