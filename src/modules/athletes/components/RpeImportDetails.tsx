"use client"

import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { formatDisplayDate } from '@open-mercato/ui/primitives/date-format'
import { PersonName } from './PersonName'
import { TRAINING_SESSION_ENTITY_ID } from './DailyShared'
import type { RpePreviewResponse } from '../lib/dailyImportView'
import {
  PREVIEW_ROW_STATUS_KEYS,
  PREVIEW_ROW_STATUS_VARIANTS,
  describeRpe,
  formatLoad,
  formatMinutes,
} from '../lib/dailyImportUi'

type PreviewRow = RpePreviewResponse['rows'][number]
type PreviewPlayer = RpePreviewResponse['players'][number]
type SessionValues = { kind: string | null; minutes: number | null; rpe: number | null }

const PAGE_SIZE = 50

export function RpeValue({ rpe }: { rpe: number | null }) {
  const t = useT()
  const described = describeRpe(rpe)
  if (described.missingKey) return <StatusBadge variant="warning">{t(described.missingKey)}</StatusBadge>
  return <span className="font-medium">{described.text}</span>
}

function PlayerCell({ player, fallback }: { player: PreviewPlayer | undefined; fallback: string }) {
  if (player) return <PersonName firstName={player.firstName} lastName={player.lastName} />
  return <span data-person-name="">{fallback}</span>
}

/** RPE part of the import preview: rows with status and load, "Brak RPE" gaps, corrections. */
export function RpeImportDetails({ preview }: { preview: RpePreviewResponse }) {
  const t = useT()
  const locale = useLocale()
  const [page, setPage] = React.useState(1)
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const players = React.useMemo(() => new Map(preview.players.map((player) => [player.id, player])), [preview.players])
  const formatDate = React.useCallback((value: string) => formatDisplayDate(value, locale) ?? value, [locale])

  const statusFilter = typeof filterValues.status === 'string' ? filterValues.status : ''
  const filteredRows = React.useMemo(
    () => (statusFilter ? preview.rows.filter((row) => row.status === statusFilter) : preview.rows),
    [preview.rows, statusFilter],
  )
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageRows = filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const columns = React.useMemo<ColumnDef<PreviewRow>[]>(() => [
    { id: 'line', accessorKey: 'line', header: t('athletes.dailyImport.preview.columns.line'), meta: { priority: 3 } },
    {
      id: 'player',
      header: t('athletes.dailyImport.preview.columns.player'),
      meta: { priority: 1 },
      cell: ({ row }) => (
        <span className="flex flex-wrap items-center gap-2">
          <PlayerCell player={players.get(row.original.playerId)} fallback={row.original.name} />
          {row.original.assigned ? (
            <span className="text-xs text-muted-foreground">{t('athletes.dailyImport.preview.assignedMarker')}</span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'sessionDate',
      header: t('athletes.dailyImport.preview.columns.date'),
      meta: { priority: 1 },
      cell: ({ row }) => formatDate(row.original.sessionDate),
    },
    { id: 'sessionNo', accessorKey: 'sessionNo', header: t('athletes.dailyImport.preview.columns.sessionNo'), meta: { priority: 2 } },
    { id: 'kind', header: t('athletes.dailyImport.preview.columns.kind'), meta: { priority: 4 }, cell: ({ row }) => row.original.kind ?? '—' },
    {
      id: 'minutes',
      header: t('athletes.dailyImport.preview.columns.minutes'),
      meta: { priority: 2 },
      cell: ({ row }) => (
        <span className="flex flex-wrap items-center gap-2">
          {formatMinutes(row.original.minutes)}
          {row.original.noMinutes ? <StatusBadge variant="warning">{t('athletes.dailyImport.preview.noMinutes')}</StatusBadge> : null}
        </span>
      ),
    },
    { id: 'rpe', header: t('athletes.dailyImport.preview.columns.rpe'), meta: { priority: 1 }, cell: ({ row }) => <RpeValue rpe={row.original.rpe} /> },
    { id: 'load', header: t('athletes.dailyImport.preview.columns.load'), meta: { priority: 2 }, cell: ({ row }) => formatLoad(row.original.load) },
    {
      id: 'status',
      header: t('athletes.dailyImport.preview.columns.status'),
      meta: { priority: 1 },
      cell: ({ row }) => (
        <StatusBadge variant={PREVIEW_ROW_STATUS_VARIANTS[row.original.status]}>{t(PREVIEW_ROW_STATUS_KEYS[row.original.status])}</StatusBadge>
      ),
    },
  ], [formatDate, players, t])

  const filters = React.useMemo(() => [
    {
      id: 'status',
      label: t('athletes.dailyImport.preview.columns.status'),
      type: 'select' as const,
      options: (['new', 'corrected', 'unchanged'] as const).map((status) => ({ value: status, label: t(PREVIEW_ROW_STATUS_KEYS[status]) })),
    },
  ], [t])

  const describeValues = (values: SessionValues) => {
    const rpe = describeRpe(values.rpe)
    return t('athletes.dailyImport.preview.correctionValues', {
      rpe: rpe.text ?? t('athletes.daily.rpeMissing'),
      minutes: formatMinutes(values.minutes),
    })
  }

  const missingByPlayer = React.useMemo(() => {
    const groups = new Map<string, RpePreviewResponse['missing']>()
    for (const gap of preview.missing) {
      const list = groups.get(gap.playerId) ?? []
      list.push(gap)
      groups.set(gap.playerId, list)
    }
    return [...groups.entries()]
  }, [preview.missing])

  return (
    <div className="space-y-6">
      <DataTable<PreviewRow>
        title={t('athletes.dailyImport.preview.rowsTitle')}
        entityId={TRAINING_SESSION_ENTITY_ID}
        extensionTableId="athletes.daily.import.preview"
        columns={columns}
        data={pageRows}
        embedded
        filters={filters}
        filterValues={filterValues}
        onFiltersApply={(values: FilterValues) => { setFilterValues(values); setPage(1) }}
        onFiltersClear={() => { setFilterValues({}); setPage(1) }}
        emptyState={<EmptyState title={t('athletes.dailyImport.preview.noRows')} />}
        pagination={{
          page: currentPage,
          pageSize: PAGE_SIZE,
          total: filteredRows.length,
          totalPages,
          onPageChange: setPage,
        }}
        showQueryTime={false}
        disableRowClick
      />

      {missingByPlayer.length > 0 ? (
        <section aria-label={t('athletes.dailyImport.preview.missingTitle')} className="space-y-2">
          <SectionHeader title={t('athletes.dailyImport.preview.missingTitle')} count={preview.missing.length} />
          <p className="text-sm text-muted-foreground">{t('athletes.dailyImport.preview.missingDescription')}</p>
          <ul className="space-y-1 text-sm">
            {missingByPlayer.map(([playerId, gaps]) => (
              <li key={playerId}>
                <PlayerCell player={players.get(playerId)} fallback={t('athletes.daily.unknownPlayer')} />
                {': '}
                {gaps.map((gap) => t('athletes.dailyImport.preview.sessionRef', {
                  date: formatDate(gap.sessionDate),
                  sessionNo: gap.sessionNo,
                })).join(', ')}
                {' — '}
                <span className="font-medium">{t('athletes.daily.rpeMissing')}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {preview.corrections.length > 0 ? (
        <section aria-label={t('athletes.dailyImport.preview.correctionsTitle')} className="space-y-2">
          <SectionHeader title={t('athletes.dailyImport.preview.correctionsTitle')} count={preview.corrections.length} />
          <ul className="space-y-1 text-sm">
            {preview.corrections.map((correction) => (
              <li key={`${correction.line}-${correction.playerId}-${correction.sessionDate}-${correction.sessionNo}`}>
                {t('athletes.dailyImport.preview.correctionLine', { line: correction.line })}{' '}
                <PlayerCell player={players.get(correction.playerId)} fallback={t('athletes.daily.unknownPlayer')} />
                {', '}
                {t('athletes.dailyImport.preview.sessionRef', { date: formatDate(correction.sessionDate), sessionNo: correction.sessionNo })}
                {': '}
                <span className="text-muted-foreground">{describeValues(correction.before)}</span>
                {' → '}
                <span className="font-medium">{describeValues(correction.after)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

export default RpeImportDetails
