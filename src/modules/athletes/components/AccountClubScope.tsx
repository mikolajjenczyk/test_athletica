"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

type SwitcherNode = { id: string; name: string; children?: SwitcherNode[] }

type SwitcherResponse = {
  items?: SwitcherNode[]
  selectedId?: string | null
}

export type CurrentClub = { organizationId: string; name: string }

export type CurrentClubState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'missing' }
  | { status: 'ready'; club: CurrentClub }

function findNode(nodes: SwitcherNode[] | undefined, id: string): SwitcherNode | null {
  for (const node of nodes ?? []) {
    if (node.id === id) return node
    const nested = findNode(node.children, id)
    if (nested) return nested
  }
  return null
}

/**
 * The club is the organization the server resolves for this session: the same
 * selected-organization rule (`selectedId`, falling back to the user's own organization)
 * that `/api/directory/organization-switcher` and the athletes routes apply. The user
 * never picks or types it. No selected organization means "no club" — callers fail closed.
 */
export function useCurrentClub(): CurrentClubState {
  const scopeVersion = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: ['athletes-current-club', scopeVersion],
    queryFn: () => readApiResultOrThrow<SwitcherResponse>('/api/directory/organization-switcher'),
  })
  return React.useMemo<CurrentClubState>(() => {
    if (query.isLoading) return { status: 'loading' }
    if (query.isError) return { status: 'error' }
    const selectedId = typeof query.data?.selectedId === 'string' ? query.data.selectedId : null
    if (!selectedId) return { status: 'missing' }
    const node = findNode(query.data?.items, selectedId)
    return { status: 'ready', club: { organizationId: selectedId, name: node?.name ?? '' } }
  }, [query.data, query.isError, query.isLoading])
}
