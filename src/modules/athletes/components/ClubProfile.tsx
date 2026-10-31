"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { ClubDesktopOnly, translateAthletesError, useAthletesPermissions } from './ClubShared'
import { TeamSection, type TeamRow } from './TeamSection'
import { PositionSection } from './PositionSection'

/** "Profil klubu": the club team (MVP: one active team) and the positions dictionary. */
export default function ClubProfile() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const { canManageClub } = useAthletesPermissions()
  const [teams, setTeams] = React.useState<TeamRow[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)
  const reload = React.useCallback(() => setReloadToken((value) => value + 1), [])

  React.useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)
    fetchCrudList<TeamRow>('athletes/teams', { page: 1, pageSize: 100, sortField: 'name', sortDir: 'asc' })
      .then((data) => { if (!cancelled) setTeams(data.items ?? []) })
      .catch((err: unknown) => { if (!cancelled) setError(translateAthletesError(err, t, 'athletes.team.errors.load')) })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [reloadToken, scopeVersion, t])

  return (
    <ClubDesktopOnly>
      <TeamSection
        teams={teams}
        isLoading={isLoading}
        error={error}
        canManage={canManageClub}
        onRetry={reload}
        onChanged={reload}
      />
      <PositionSection canManage={canManageClub} />
    </ClubDesktopOnly>
  )
}
