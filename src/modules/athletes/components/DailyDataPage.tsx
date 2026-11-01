"use client"

import * as React from 'react'
import Link from 'next/link'
import { CalendarDays, History, Upload } from 'lucide-react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Input } from '@open-mercato/ui/primitives/input'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { formatDisplayDate, formatDisplayDateTime } from '@open-mercato/ui/primitives/date-format'
import { HideNamesToggle, PersonName } from './PersonName'
import type { PlayerListItem } from './PlayersTable'
import { RpeValue } from './RpeImportDetails'
import {
  DAILY_IMPORT_ENTITY_ID,
  DailyLoadErrorMessage,
  TRAINING_SESSION_ENTITY_ID,
  dailyImportHref,
  toDailyLoadError,
  useDailyPermissions,
  type DailyLoadError,
} from './DailyShared'
import type { DailyImportListItem, TrainingSessionView } from '../lib/dailyImportView'
import {
  dailyImportErrorKey,
  defaultSessionRange,
  formatLoad,
  formatMinutes,
  sessionRangeError,
} from '../lib/dailyImportUi'

type PagedList<T> = { items: T[]; total: number; page: number; pageSize: number; totalPages: number }

type SessionRow = TrainingSessionView & { firstName: string; lastName: string }

const SESSIONS_PAGE_SIZE = 50
const IMPORTS_PAGE_SIZE = 10
const PLAYERS_PAGE_SIZE = 100
const PLAYERS_MAX_PAGES = 10

/** Names are encrypted at rest: load the club's players once and join them in the client. */
async function fetchAllPlayers(): Promise<PlayerListItem[]> {
  const items: PlayerListItem[] = []
  for (let page = 1; page <= PLAYERS_MAX_PAGES; page += 1) {
    const data = await fetchCrudList<PlayerListItem>('athletes/players', { page, pageSize: PLAYERS_PAGE_SIZE, sortField: 'joinedAt', sortDir: 'asc' })
    items.push(...(data.items ?? []))
    if (page >= (data.totalPages ?? 1)) break
  }
  return items
}

/** "Dane dzienne" (REQ-003, REQ-004, REQ-014): RPE sessions of the club and the import history. */
export default function DailyDataPage() {
  const t = useT()
  const { canImport } = useDailyPermissions()
  const [reloadToken, setReloadToken] = React.useState(0)
  const reload = React.useCallback(() => setReloadToken((value) => value + 1), [])

  const importButton = canImport ? (
    <Button asChild>
      <Link href={dailyImportHref('rpe')}>
        <Upload className="size-4" aria-hidden="true" />
        {t('athletes.daily.actions.importRpe')}
      </Link>
    </Button>
  ) : null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{t('athletes.daily.page.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('athletes.daily.page.description')}</p>
        </div>
        <div className="hidden lg:flex">{importButton}</div>
      </div>
      <Tabs defaultValue="rpe" variant="underline">
        <TabsList aria-label={t('athletes.daily.tabs.label')}>
          <TabsTrigger value="rpe">{t('athletes.daily.tabs.rpe')}</TabsTrigger>
        </TabsList>
        <TabsContent value="rpe" className="space-y-8 pt-4">
          <RpeSessionsTable reloadToken={reloadToken} canImport={canImport} importButton={importButton} />
          <ImportHistoryTable reloadToken={reloadToken} canImport={canImport} onUndone={reload} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function RpeSessionsTable({ reloadToken, canImport, importButton }: { reloadToken: number; canImport: boolean; importButton: React.ReactNode }) {
  const t = useT()
  const locale = useLocale()
  const scopeVersion = useOrganizationScopeVersion()
  const [range, setRange] = React.useState(() => defaultSessionRange())
  const [page, setPage] = React.useState(1)
  const [data, setData] = React.useState<PagedList<TrainingSessionView> | null>(null)
  const [players, setPlayers] = React.useState<Map<string, PlayerListItem>>(new Map())
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<DailyLoadError | null>(null)
  const [retryToken, setRetryToken] = React.useState(0)
  const rangeError = sessionRangeError(range)

  React.useEffect(() => {
    let cancelled = false
    fetchAllPlayers()
      .then((items) => { if (!cancelled) setPlayers(new Map(items.map((player) => [player.id, player]))) })
      // Without the roster the table still renders, with "Nieznany zawodnik".
      .catch(() => { if (!cancelled) setPlayers(new Map()) })
    return () => { cancelled = true }
  }, [reloadToken, scopeVersion])

  React.useEffect(() => {
    if (rangeError) return
    let cancelled = false
    setIsLoading(true)
    setError(null)
    const params = new URLSearchParams({ from: range.from, to: range.to, page: String(page), pageSize: String(SESSIONS_PAGE_SIZE) })
    readApiResultOrThrow<PagedList<TrainingSessionView>>(`/api/athletes/training-sessions?${params.toString()}`)
      .then((result) => { if (!cancelled) setData(result) })
      .catch((err: unknown) => { if (!cancelled) setError(toDailyLoadError(err, t, 'athletes.daily.errors.loadSessions')) })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [page, range.from, range.to, rangeError, reloadToken, retryToken, scopeVersion, t])

  const formatDate = React.useCallback((value: string) => formatDisplayDate(value, locale) ?? value, [locale])

  const rows = React.useMemo<SessionRow[]>(() => (data?.items ?? []).map((session) => {
    const player = players.get(session.playerId)
    return { ...session, firstName: player?.firstName ?? '', lastName: player?.lastName ?? '' }
  }), [data, players])

  const columns = React.useMemo<ColumnDef<SessionRow>[]>(() => [
    {
      id: 'player',
      header: t('athletes.daily.sessions.columns.player'),
      meta: { priority: 1 },
      cell: ({ row }) => (row.original.firstName || row.original.lastName)
        ? <PersonName firstName={row.original.firstName} lastName={row.original.lastName} />
        : t('athletes.daily.unknownPlayer'),
    },
    { id: 'sessionDate', header: t('athletes.daily.sessions.columns.date'), meta: { priority: 1 }, cell: ({ row }) => formatDate(row.original.sessionDate) },
    { id: 'sessionNo', accessorKey: 'sessionNo', header: t('athletes.daily.sessions.columns.sessionNo'), meta: { priority: 2 } },
    { id: 'kind', header: t('athletes.daily.sessions.columns.kind'), meta: { priority: 4 }, cell: ({ row }) => row.original.kind ?? '—' },
    { id: 'minutes', header: t('athletes.daily.sessions.columns.minutes'), meta: { priority: 2 }, cell: ({ row }) => formatMinutes(row.original.minutes) },
    { id: 'rpe', header: t('athletes.daily.sessions.columns.rpe'), meta: { priority: 1 }, cell: ({ row }) => <RpeValue rpe={row.original.rpe} /> },
    { id: 'load', header: t('athletes.daily.sessions.columns.load'), meta: { priority: 2 }, cell: ({ row }) => formatLoad(row.original.load) },
    {
      id: 'corrected',
      header: t('athletes.daily.sessions.columns.corrected'),
      meta: { priority: 3 },
      cell: ({ row }) => {
        const session = row.original
        if (!session.correctedAt) return null
        return (
          <span className="flex flex-col gap-1">
            <StatusBadge variant="warning">{t('athletes.daily.sessions.correctedBadge')}</StatusBadge>
            <span className="text-xs text-muted-foreground">
              {t('athletes.daily.sessions.previousValues', {
                rpe: session.previousRpe === null ? t('athletes.daily.rpeMissing') : String(session.previousRpe),
                minutes: formatMinutes(session.previousMinutes),
              })}
            </span>
          </span>
        )
      },
    },
  ], [formatDate, t])

  const updateRange = (patch: Partial<{ from: string; to: string }>) => {
    setRange((current) => ({ ...current, ...patch }))
    setPage(1)
  }

  const toolbar = (
    <div className="flex flex-wrap items-end gap-3">
      <FormField label={t('athletes.daily.filters.from')} id="athletes-daily-from" error={rangeError ? t(rangeError) : undefined}>
        <Input type="date" value={range.from} max={range.to || undefined} onChange={(event) => updateRange({ from: event.target.value })} />
      </FormField>
      <FormField label={t('athletes.daily.filters.to')} id="athletes-daily-to">
        <Input type="date" value={range.to} min={range.from || undefined} onChange={(event) => updateRange({ to: event.target.value })} />
      </FormField>
      <Button type="button" variant="outline" size="sm" onClick={() => updateRange(defaultSessionRange())}>
        {t('athletes.daily.filters.last7Days')}
      </Button>
      <HideNamesToggle />
    </div>
  )

  return (
    <section aria-label={t('athletes.daily.sessions.title')} className="space-y-3">
      {error ? (
        <DailyLoadErrorMessage error={error} onRetry={() => setRetryToken((value) => value + 1)} />
      ) : (
        <DataTable<SessionRow>
          title={t('athletes.daily.sessions.title')}
          entityId={TRAINING_SESSION_ENTITY_ID}
          extensionTableId="athletes.daily.sessions"
          toolbar={toolbar}
          columns={columns}
          data={rangeError ? [] : rows}
          isLoading={isLoading && !rangeError}
          emptyState={(
            <EmptyState
              icon={<CalendarDays className="size-6" aria-hidden="true" />}
              title={t('athletes.daily.sessions.empty')}
              description={canImport ? t('athletes.daily.sessions.emptyImportHint') : undefined}
              actions={importButton}
            />
          )}
          pagination={data && !rangeError ? {
            page: data.page,
            pageSize: data.pageSize,
            total: data.total,
            totalPages: data.totalPages,
            onPageChange: setPage,
          } : undefined}
          showQueryTime={false}
          disableRowClick
        />
      )}
    </section>
  )
}

function ImportHistoryTable({ reloadToken, canImport, onUndone }: { reloadToken: number; canImport: boolean; onUndone: () => void }) {
  const t = useT()
  const locale = useLocale()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation } = useGuardedMutation<{ formId: string; resourceId: string }>({ contextId: 'athletes.daily-import.undo' })
  const [page, setPage] = React.useState(1)
  const [data, setData] = React.useState<PagedList<DailyImportListItem> | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<DailyLoadError | null>(null)
  const [retryToken, setRetryToken] = React.useState(0)
  const [undoingId, setUndoingId] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)
    const params = new URLSearchParams({ kind: 'rpe', page: String(page), pageSize: String(IMPORTS_PAGE_SIZE) })
    readApiResultOrThrow<PagedList<DailyImportListItem>>(`/api/athletes/daily-imports?${params.toString()}`)
      .then((result) => { if (!cancelled) setData(result) })
      .catch((err: unknown) => { if (!cancelled) setError(toDailyLoadError(err, t, 'athletes.daily.errors.loadImports')) })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [page, reloadToken, retryToken, scopeVersion, t])

  const formatDate = React.useCallback((value: string) => formatDisplayDate(value, locale) ?? value, [locale])

  const undo = React.useCallback(async (row: DailyImportListItem) => {
    if (undoingId) return
    const confirmed = await confirm({
      title: t('athletes.daily.imports.undoConfirmTitle'),
      text: t('athletes.daily.imports.undoConfirmText', { fileName: row.fileName }),
      confirmText: t('athletes.daily.imports.undo'),
      variant: 'destructive',
    })
    if (!confirmed) return
    setUndoingId(row.id)
    try {
      await runMutation({
        operation: () => apiCallOrThrow('/api/athletes/daily-imports/undo', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ importId: row.id }),
        }),
        context: { formId: 'athletes.daily-import.undo', resourceId: row.id },
        mutationPayload: { importId: row.id },
      })
      flash(t('athletes.daily.imports.undoSuccess'), 'success')
      onUndone()
    } catch (err) {
      // 409: not the latest import, already undone, or data changed since — reload to show why.
      flash(t(dailyImportErrorKey(err, 'athletes.daily.errors.undoFailed')), 'error')
      const status = (err as { status?: number } | null)?.status
      if (status === 404 || status === 409) onUndone()
    } finally {
      setUndoingId(null)
    }
  }, [confirm, onUndone, runMutation, t, undoingId])

  const columns = React.useMemo<ColumnDef<DailyImportListItem>[]>(() => [
    {
      id: 'createdAt',
      header: t('athletes.daily.imports.columns.createdAt'),
      meta: { priority: 1 },
      cell: ({ row }) => formatDisplayDateTime(row.original.createdAt, locale) ?? '—',
    },
    { id: 'fileName', accessorKey: 'fileName', header: t('athletes.daily.imports.columns.fileName'), meta: { priority: 1 } },
    {
      id: 'period',
      header: t('athletes.daily.imports.columns.period'),
      meta: { priority: 2 },
      cell: ({ row }) => `${formatDate(row.original.periodFrom)} – ${formatDate(row.original.periodTo)}`,
    },
    {
      id: 'counts',
      header: t('athletes.daily.imports.columns.counts'),
      meta: { priority: 2 },
      cell: ({ row }) => t('athletes.dailyImport.commit.success', {
        saved: row.original.saved,
        corrected: row.original.corrected,
        unchanged: row.original.unchanged,
        rejected: row.original.rejected,
      }),
    },
    {
      id: 'state',
      header: t('athletes.daily.imports.columns.state'),
      meta: { priority: 1 },
      cell: ({ row }) => {
        const item = row.original
        if (item.undoneAt) {
          return (
            <StatusBadge variant="neutral">
              {t('athletes.daily.imports.undoneAt', { date: formatDisplayDateTime(item.undoneAt, locale) ?? '' })}
            </StatusBadge>
          )
        }
        if (canImport && item.canUndo) {
          return (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => { void undo(item) }}
              disabled={undoingId !== null}
              aria-label={t('athletes.daily.imports.undoAria', { fileName: item.fileName })}
            >
              {undoingId === item.id ? t('athletes.daily.imports.undoing') : t('athletes.daily.imports.undo')}
            </Button>
          )
        }
        return <StatusBadge variant="success">{t('athletes.daily.imports.active')}</StatusBadge>
      },
    },
  ], [canImport, formatDate, locale, t, undo, undoingId])

  return (
    <section aria-label={t('athletes.daily.imports.title')} className="space-y-3">
      {error ? (
        <DailyLoadErrorMessage error={error} onRetry={() => setRetryToken((value) => value + 1)} />
      ) : (
        <DataTable<DailyImportListItem>
          title={t('athletes.daily.imports.title')}
          entityId={DAILY_IMPORT_ENTITY_ID}
          extensionTableId="athletes.daily.imports"
          columns={columns}
          data={data?.items ?? []}
          isLoading={isLoading}
          emptyState={(
            <EmptyState
              icon={<History className="size-6" aria-hidden="true" />}
              title={t('athletes.daily.imports.empty')}
            />
          )}
          pagination={data ? {
            page: data.page,
            pageSize: data.pageSize,
            total: data.total,
            totalPages: data.totalPages,
            onPageChange: setPage,
          } : undefined}
          showQueryTime={false}
          disableRowClick
        />
      )}
      {ConfirmDialogElement}
    </section>
  )
}
