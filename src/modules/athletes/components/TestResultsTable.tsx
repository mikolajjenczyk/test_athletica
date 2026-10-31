"use client"

import * as React from 'react'
import Link from 'next/link'
import { ClipboardList, Play, Undo2 } from 'lucide-react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { formatDisplayDate } from '@open-mercato/ui/primitives/date-format'
import { HideNamesToggle, PersonName, formatPersonName, useHideNames } from './PersonName'
import type { PlayerListItem } from './PlayersTable'
import {
  TESTS_HREF,
  TEST_RESULT_ENTITY_ID,
  TestsLoadErrorMessage,
  fetchTestDefinitions,
  testFieldHref,
  testStartHref,
  toTestsLoadError,
  useTestsPermissions,
  type TestsLoadError,
} from './TestsShared'
import {
  describeTestResult,
  directionLabelKey,
  formatTestName,
  openSessionsByDefinition,
  type TestDefinitionListItem,
  type TestResultListItem,
  type TestSessionListItem,
} from '../lib/testUi'

type ResultRow = TestResultListItem & {
  firstName: string
  lastName: string
  sessionLabel: string
}

type OptionsResponse = { items: Array<{ value: string; label: string }> }

type ViewData = {
  definition: TestDefinitionListItem
  sessions: TestSessionListItem[]
  results: TestResultListItem[]
  players: Map<string, PlayerListItem>
  teams: Map<string, string>
}

const PAGE_SIZE = 100
const MAX_PAGES = 10

async function fetchAllPages<T>(apiPath: string, params: Record<string, unknown>): Promise<T[]> {
  const items: T[] = []
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const data = await fetchCrudList<T>(apiPath, { ...params, page, pageSize: PAGE_SIZE })
    items.push(...(data.items ?? []))
    if (page >= (data.totalPages ?? 1)) break
  }
  return items
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

/** "Widok testu" (REQ-013, REQ-010): read-only sessions and results of one test (phase 1). */
export default function TestResultsTable({ definitionId }: { definitionId: string }) {
  const t = useT()
  const locale = useLocale()
  const scopeVersion = useOrganizationScopeVersion()
  const [hideNames] = useHideNames()
  const { canRecord } = useTestsPermissions()

  const [data, setData] = React.useState<ViewData | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<TestsLoadError | null>(null)
  const [notFound, setNotFound] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'testedOn', desc: true }])

  React.useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)
    setNotFound(false)
    void (async () => {
      try {
        const [definitions, sessions, resultData, players, teams] = await Promise.all([
          fetchTestDefinitions({ id: definitionId }),
          fetchAllPages<TestSessionListItem>('athletes/test-sessions', { testDefinitionId: definitionId, sortField: 'testedOn', sortDir: 'desc' }),
          readApiResultOrThrow<{ items: TestResultListItem[] }>(
            `/api/athletes/test-results?definitionId=${encodeURIComponent(definitionId)}&limit=500`,
          ),
          // Names are encrypted at rest: never sort or search them on the server.
          fetchAllPages<PlayerListItem>('athletes/players', { sortField: 'joinedAt', sortDir: 'asc' }),
          readApiResultOrThrow<OptionsResponse>('/api/athletes/options/teams?limit=200'),
        ])
        if (cancelled) return
        const definition = definitions[0]
        if (!definition) {
          setNotFound(true)
          return
        }
        setData({
          definition,
          sessions,
          results: resultData?.items ?? [],
          players: new Map(players.map((player) => [player.id, player])),
          teams: new Map((teams?.items ?? []).map((item) => [item.value, item.label])),
        })
      } catch (err) {
        if (cancelled) return
        if ((err as { status?: number }).status === 404) setNotFound(true)
        else setError(toTestsLoadError(err, t, 'athletes.tests.errors.loadResults'))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [definitionId, reloadToken, scopeVersion, t])

  const sessionLabel = React.useCallback((session: TestSessionListItem | undefined): string => {
    if (!session) return t('athletes.tests.view.unknownSession')
    const date = formatDisplayDate(session.testedOn, locale) ?? session.testedOn
    const who = session.kind === 'individual'
      ? t('athletes.tests.view.individual')
      : (session.teamId ? data?.teams.get(session.teamId) : null) ?? t('athletes.tests.view.team')
    const status = session.status === 'open' ? t('athletes.tests.view.sessionOpen') : t('athletes.tests.view.sessionFinished')
    return `${date} · ${who} · ${status}`
  }, [data, locale, t])

  const sessionsById = React.useMemo(() => new Map((data?.sessions ?? []).map((session) => [session.id, session])), [data])

  const rows = React.useMemo<ResultRow[]>(() => (data?.results ?? []).map((result) => {
    const player = data?.players.get(result.playerId)
    return {
      ...result,
      firstName: player?.firstName ?? '',
      lastName: player?.lastName ?? '',
      sessionLabel: sessionLabel(sessionsById.get(result.sessionId)),
    }
  }), [data, sessionLabel, sessionsById])

  const filteredRows = React.useMemo(() => {
    const needle = normalize(search.trim())
    const sessionFilter = typeof filterValues.sessionId === 'string' ? filterValues.sessionId : ''
    return rows.filter((row) => {
      if (sessionFilter && row.sessionId !== sessionFilter) return false
      if (needle) {
        const shown = normalize(formatPersonName(row.firstName, row.lastName, hideNames))
        const reversed = normalize(`${row.lastName} ${row.firstName}`)
        if (!shown.includes(needle) && (hideNames || !reversed.includes(needle))) return false
      }
      return true
    })
  }, [filterValues, hideNames, rows, search])

  const unit = data?.definition.unit ?? ''

  const columns = React.useMemo<ColumnDef<ResultRow>[]>(() => [
    {
      id: 'player',
      accessorFn: (row) => `${row.lastName} ${row.firstName}`.toLocaleLowerCase(),
      header: t('athletes.tests.view.columns.player'),
      meta: { priority: 1 },
      cell: ({ row }) => (row.original.firstName || row.original.lastName)
        ? <PersonName firstName={row.original.firstName} lastName={row.original.lastName} />
        : t('athletes.tests.view.unknownPlayer'),
    },
    {
      id: 'testedOn',
      accessorKey: 'testedOn',
      header: t('athletes.tests.view.columns.date'),
      meta: { priority: 2 },
      cell: ({ row }) => formatDisplayDate(row.original.testedOn, locale) ?? row.original.testedOn,
    },
    {
      id: 'result',
      // Gaps sort after every value; a gap is never 0 (R12).
      accessorFn: (row) => (row.state === 'recorded' && row.value !== null ? row.value : Number.NEGATIVE_INFINITY),
      header: t('athletes.tests.view.columns.result'),
      meta: { priority: 1 },
      cell: ({ row }) => {
        const described = describeTestResult(row.original, unit, locale)
        return (
          <span className={described.isGap ? 'text-muted-foreground' : 'font-medium'}>
            {described.text ?? t(described.stateKey ?? 'athletes.tests.state.empty')}
            {described.reasonKey ? `: ${t(described.reasonKey)}` : ''}
          </span>
        )
      },
    },
    {
      id: 'markers',
      header: t('athletes.tests.view.columns.markers'),
      enableSorting: false,
      meta: { priority: 2 },
      cell: ({ row }) => {
        const markers: React.ReactNode[] = []
        if (row.original.checkFlag) {
          markers.push(<StatusBadge key="check" variant="warning">{t('athletes.tests.check')}</StatusBadge>)
        }
        if (row.original.noPreviousMeasurement) {
          markers.push(<span key="first" className="text-sm text-muted-foreground">{t('athletes.tests.view.noPreviousMeasurement')}</span>)
        }
        return markers.length > 0 ? <span className="flex flex-wrap items-center gap-2">{markers}</span> : null
      },
    },
    {
      id: 'session',
      accessorKey: 'sessionLabel',
      header: t('athletes.tests.view.columns.session'),
      meta: { priority: 4 },
    },
  ], [locale, t, unit])

  const filters = React.useMemo(() => [
    {
      id: 'sessionId',
      label: t('athletes.tests.view.filters.session'),
      type: 'select' as const,
      options: (data?.sessions ?? []).map((session) => ({ value: session.id, label: sessionLabel(session) })),
    },
  ], [data, sessionLabel, t])

  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('athletes.tests.view.notFound')}
        backHref={TESTS_HREF}
        backLabel={t('athletes.tests.actions.backToCatalog')}
      />
    )
  }
  if (error) return <TestsLoadErrorMessage error={error} onRetry={() => setReloadToken((value) => value + 1)} />
  if (!data && isLoading) return <LoadingMessage label={t('athletes.tests.view.loading')} />
  if (!data) return null

  const definition = data.definition
  const testName = formatTestName(definition.name, definition.variant)
  const openSession = openSessionsByDefinition(data.sessions).get(definition.id) ?? null
  const canStart = canRecord && definition.isActive && !openSession
  const isFiltered = search.trim().length > 0 || Object.values(filterValues).some((value) => value !== undefined && value !== '')

  const startButton = canStart ? (
    <Button asChild>
      <Link href={testStartHref(definition.id)}>
        <Play className="size-4" aria-hidden="true" />
        {t('athletes.tests.actions.start')}
      </Link>
    </Button>
  ) : null

  const emptyState = data.sessions.length === 0 ? (
    <EmptyState
      icon={<ClipboardList className="size-6" aria-hidden="true" />}
      title={t('athletes.tests.view.empty.notYetTitle')}
      description={canStart ? undefined : t('athletes.tests.view.empty.notYetReadOnly')}
      actions={startButton}
    />
  ) : isFiltered ? (
    <EmptyState
      title={t('athletes.tests.view.empty.filteredTitle')}
      actions={(
        <Button type="button" variant="outline" onClick={() => { setSearch(''); setFilterValues({}) }}>
          {t('athletes.tests.view.empty.clearFilters')}
        </Button>
      )}
    />
  ) : (
    <EmptyState
      title={t('athletes.tests.view.empty.noResultsTitle')}
      description={t('athletes.tests.view.empty.noResultsDescription')}
    />
  )

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {t('athletes.tests.view.summary', {
          unit: definition.unit,
          direction: t(directionLabelKey(definition.direction)),
          attempts: definition.attempts,
        })}
      </p>
      {openSession ? (
        <Alert
          status="information"
          action={canRecord ? (
            <Button asChild size="sm" variant="outline">
              <Link href={testFieldHref(openSession.id)}>
                <Undo2 className="size-4" aria-hidden="true" />
                {t('athletes.tests.catalog.resume')}
              </Link>
            </Button>
          ) : undefined}
        >
          <AlertDescription>
            {t('athletes.tests.view.openSession', { session: sessionLabel(openSession) })}
          </AlertDescription>
        </Alert>
      ) : null}
      <DataTable<ResultRow>
        title={testName}
        titleHeadingLevel={1}
        entityId={TEST_RESULT_ENTITY_ID}
        extensionTableId="athletes.tests.results"
        actions={data.sessions.length > 0 ? startButton : null}
        toolbar={<HideNamesToggle />}
        columns={columns}
        data={filteredRows}
        isLoading={isLoading}
        emptyState={emptyState}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('athletes.tests.view.search')}
        searchAlign="right"
        filters={filters}
        filterValues={filterValues}
        onFiltersApply={(values: FilterValues) => setFilterValues(values)}
        onFiltersClear={() => setFilterValues({})}
        sortable
        sorting={sorting}
        onSortingChange={setSorting}
        disableRowClick
      />
    </div>
  )
}
