"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, Users } from 'lucide-react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions, type RowActionItem } from '@open-mercato/ui/backend/RowActions'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { formatDisplayDate } from '@open-mercato/ui/primitives/date-format'
import { HideNamesToggle, PersonName, formatPersonName, useHideNames } from './PersonName'
import {
  CLUB_HREF,
  PLAYERS_HREF,
  PLAYER_ENTITY_ID,
  translateAthletesError,
  useAthletesPermissions,
  useClubRowDelete,
} from './ClubShared'

export type PlayerListItem = {
  id: string
  teamId: string
  firstName: string
  lastName: string
  birthDate: string
  positionId: string | null
  joinedAt: string
  isActive: boolean
  updatedAt: string | null
}

type PlayerRow = PlayerListItem & { teamLabel: string; positionLabel: string }

type OptionsResponse = { items: Array<{ value: string; label: string }> }

/** The API caps pages at 100; one club team is small (D206), so walk a few pages at most. */
const PAGE_SIZE = 100
const MAX_PAGES = 10

async function fetchAllPlayers(): Promise<PlayerListItem[]> {
  const items: PlayerListItem[] = []
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    // Names are encrypted at rest: never send a name sort/search to the API.
    const data = await fetchCrudList<PlayerListItem>('athletes/players', {
      page,
      pageSize: PAGE_SIZE,
      sortField: 'joinedAt',
      sortDir: 'asc',
    })
    items.push(...(data.items ?? []))
    if (page >= (data.totalPages ?? 1)) break
  }
  return items
}

async function fetchOptions(kind: 'teams' | 'positions'): Promise<Map<string, string>> {
  const data = await readApiResultOrThrow<OptionsResponse>(`/api/athletes/options/${kind}?limit=200`)
  return new Map((data?.items ?? []).map((item) => [item.value, item.label]))
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

export default function PlayersTable() {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const [hideNames] = useHideNames()
  const { canManagePlayers } = useAthletesPermissions()
  const { deleteRow, ConfirmDialogElement } = useClubRowDelete('athletes-players-table')

  const [players, setPlayers] = React.useState<PlayerListItem[]>([])
  const [teams, setTeams] = React.useState<Map<string, string>>(() => new Map())
  const [positions, setPositions] = React.useState<Map<string, string>>(() => new Map())
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)
  const reload = React.useCallback(() => setReloadToken((value) => value + 1), [])

  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'name', desc: false }])

  React.useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)
    Promise.all([fetchAllPlayers(), fetchOptions('teams'), fetchOptions('positions')])
      .then(([playerItems, teamMap, positionMap]) => {
        if (cancelled) return
        setPlayers(playerItems)
        setTeams(teamMap)
        setPositions(positionMap)
      })
      .catch((err: unknown) => { if (!cancelled) setError(translateAthletesError(err, t, 'athletes.players.errors.load')) })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [reloadToken, scopeVersion, t])

  const rows = React.useMemo<PlayerRow[]>(() => players.map((player) => ({
    ...player,
    teamLabel: teams.get(player.teamId) ?? t('athletes.players.table.unknownTeam'),
    positionLabel: player.positionId
      ? positions.get(player.positionId) ?? t('athletes.players.table.unknownPosition')
      : t('athletes.players.table.noPosition'),
  })), [players, positions, t, teams])

  const filteredRows = React.useMemo(() => {
    const needle = normalize(search.trim())
    const positionFilter = typeof filterValues.positionId === 'string' ? filterValues.positionId : ''
    const statusFilter = typeof filterValues.status === 'string' ? filterValues.status : ''
    return rows.filter((row) => {
      if (needle) {
        // Search what the user can see: initials when names are hidden.
        const shown = normalize(formatPersonName(row.firstName, row.lastName, hideNames))
        const reversed = normalize(`${row.lastName} ${row.firstName}`)
        if (!shown.includes(needle) && (hideNames || !reversed.includes(needle))) return false
      }
      if (positionFilter === '__none__' && row.positionId) return false
      if (positionFilter && positionFilter !== '__none__' && row.positionId !== positionFilter) return false
      if (statusFilter === 'active' && !row.isActive) return false
      if (statusFilter === 'inactive' && row.isActive) return false
      return true
    })
  }, [filterValues, hideNames, rows, search])

  const columns = React.useMemo<ColumnDef<PlayerRow>[]>(() => [
    {
      id: 'name',
      // Client-side sort key; the cell always renders through PersonName (REQ-005).
      accessorFn: (row) => `${row.lastName} ${row.firstName}`.toLocaleLowerCase(),
      header: t('athletes.players.table.name'),
      meta: { priority: 1 },
      cell: ({ row }) => <PersonName firstName={row.original.firstName} lastName={row.original.lastName} />,
    },
    { accessorKey: 'positionLabel', header: t('athletes.players.table.position'), meta: { priority: 2 } },
    { accessorKey: 'teamLabel', header: t('athletes.players.table.team'), meta: { priority: 4 } },
    {
      accessorKey: 'birthDate',
      header: t('athletes.players.table.birthDate'),
      meta: { priority: 3 },
      cell: ({ row }) => formatDisplayDate(row.original.birthDate, locale) ?? '—',
    },
    {
      accessorKey: 'joinedAt',
      header: t('athletes.players.table.joinedAt'),
      meta: { priority: 5 },
      cell: ({ row }) => formatDisplayDate(row.original.joinedAt, locale) ?? '—',
    },
    {
      accessorKey: 'isActive',
      header: t('athletes.players.table.status'),
      meta: { priority: 2 },
      cell: ({ row }) => (
        <StatusBadge variant={row.original.isActive ? 'success' : 'neutral'} dot>
          {row.original.isActive ? t('athletes.players.status.active') : t('athletes.players.status.inactive')}
        </StatusBadge>
      ),
    },
  ], [locale, t])

  const filters = React.useMemo(() => [
    {
      id: 'positionId',
      label: t('athletes.players.filters.position'),
      type: 'select' as const,
      options: [
        { value: '__none__', label: t('athletes.players.table.noPosition') },
        ...Array.from(positions.entries()).map(([value, label]) => ({ value, label })),
      ],
    },
    {
      id: 'status',
      label: t('athletes.players.filters.status'),
      type: 'select' as const,
      options: [
        { value: 'active', label: t('athletes.players.status.active') },
        { value: 'inactive', label: t('athletes.players.status.inactive') },
      ],
    },
  ], [positions, t])

  const hasTeam = teams.size > 0
  const isFiltered = search.trim().length > 0 || Object.values(filterValues).some((value) => value !== undefined && value !== '')

  const emptyState = !hasTeam ? (
    <EmptyState
      icon={<Users className="size-6" aria-hidden="true" />}
      title={t('athletes.players.empty.noTeamTitle')}
      description={t('athletes.players.empty.noTeamDescription')}
      actions={(
        <Button asChild variant="outline">
          <Link href={CLUB_HREF}>{t('athletes.players.empty.goToClub')}</Link>
        </Button>
      )}
    />
  ) : isFiltered ? (
    <EmptyState
      title={t('athletes.players.empty.filteredTitle')}
      actions={(
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setSearch('')
            setFilterValues({})
          }}
        >
          {t('athletes.players.empty.clearFilters')}
        </Button>
      )}
    />
  ) : (
    <EmptyState
      icon={<Users className="size-6" aria-hidden="true" />}
      title={t('athletes.players.empty.title')}
      description={canManagePlayers ? t('athletes.players.empty.description') : t('athletes.players.empty.descriptionReadOnly')}
    />
  )

  return (
    <>
      <DataTable<PlayerRow>
        title={t('athletes.players.page.title')}
        titleHeadingLevel={1}
        entityId={PLAYER_ENTITY_ID}
        extensionTableId="athletes.players"
        actions={canManagePlayers && hasTeam ? (
          <Button asChild>
            <Link href={`${PLAYERS_HREF}/create`}>
              <Plus className="size-4" aria-hidden="true" />
              {t('athletes.players.actions.create')}
            </Link>
          </Button>
        ) : null}
        toolbar={<HideNamesToggle />}
        columns={columns}
        data={filteredRows}
        isLoading={isLoading}
        error={error}
        emptyState={emptyState}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('athletes.players.search.placeholder')}
        searchAlign="right"
        filters={filters}
        filterValues={filterValues}
        onFiltersApply={(values: FilterValues) => setFilterValues(values)}
        onFiltersClear={() => setFilterValues({})}
        sortable
        sorting={sorting}
        onSortingChange={setSorting}
        disableRowClick={!canManagePlayers}
        onRowClick={canManagePlayers ? (row) => router.push(`${PLAYERS_HREF}/${row.id}/edit`) : undefined}
        rowActions={canManagePlayers ? (row) => {
          const items: RowActionItem[] = [
            { id: 'athletes.players.edit', label: t('athletes.club.actions.edit'), href: `${PLAYERS_HREF}/${row.id}/edit` },
            {
              id: 'athletes.players.delete',
              label: t('athletes.club.actions.delete'),
              destructive: true,
              onSelect: () => {
                void deleteRow(row, {
                  apiPath: 'athletes/players',
                  confirmTitle: t('athletes.players.confirm.deleteTitle', {
                    name: formatPersonName(row.firstName, row.lastName, hideNames),
                  }),
                  confirmText: t('athletes.players.confirm.deleteText'),
                  successMessage: t('athletes.players.flash.deleted'),
                  errorFallbackKey: 'athletes.players.errors.delete',
                  onSettled: reload,
                })
              },
            },
          ]
          return <RowActions items={items} />
        } : undefined}
      />
      {ConfirmDialogElement}
    </>
  )
}
