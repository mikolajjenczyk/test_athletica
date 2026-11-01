"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ClipboardList, Play, Undo2 } from 'lucide-react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions, type RowActionItem } from '@open-mercato/ui/backend/RowActions'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  directionLabelKey,
  formatTestName,
  formatTestNumber,
  openSessionsByDefinition,
  type TestDefinitionListItem,
  type TestSessionListItem,
} from '../lib/testUi'
import {
  TEST_DEFINITION_ENTITY_ID,
  TestsLoadErrorMessage,
  fetchTestDefinitions,
  testFieldHref,
  testStartHref,
  testViewHref,
  toTestsLoadError,
  useTestsPermissions,
  type TestsLoadError,
} from './TestsShared'

type CatalogRow = TestDefinitionListItem & { openSession: TestSessionListItem | null }

async function fetchOpenSessions(): Promise<TestSessionListItem[]> {
  const data = await fetchCrudList<TestSessionListItem>('athletes/test-sessions', {
    page: 1,
    pageSize: 100,
    status: 'open',
    sortField: 'testedOn',
    sortDir: 'desc',
  })
  return data.items ?? []
}

/** "Zestaw testów" (REQ-001, REQ-006): the club's test catalog — read-only in the MVP (Q-006). */
export default function TestCatalogTable() {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const { canRecord } = useTestsPermissions()

  const [definitions, setDefinitions] = React.useState<TestDefinitionListItem[]>([])
  const [openSessions, setOpenSessions] = React.useState<TestSessionListItem[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<TestsLoadError | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)
    Promise.all([fetchTestDefinitions(), fetchOpenSessions()])
      .then(([definitionItems, sessionItems]) => {
        if (cancelled) return
        setDefinitions(definitionItems)
        setOpenSessions(sessionItems)
      })
      .catch((err: unknown) => { if (!cancelled) setError(toTestsLoadError(err, t, 'athletes.tests.errors.loadCatalog')) })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [reloadToken, scopeVersion, t])

  const rows = React.useMemo<CatalogRow[]>(() => {
    const open = openSessionsByDefinition(openSessions)
    return definitions.map((definition) => ({ ...definition, openSession: open.get(definition.id) ?? null }))
  }, [definitions, openSessions])

  const activeCount = React.useMemo(() => definitions.filter((definition) => definition.isActive).length, [definitions])

  const columns = React.useMemo<ColumnDef<CatalogRow>[]>(() => [
    {
      id: 'name',
      accessorFn: (row) => row.sortOrder,
      header: t('athletes.tests.catalog.columns.name'),
      meta: { priority: 1 },
      cell: ({ row }) => (
        <span className="font-medium">{formatTestName(row.original.name, row.original.variant)}</span>
      ),
    },
    {
      id: 'status',
      accessorKey: 'isActive',
      header: t('athletes.tests.catalog.columns.status'),
      meta: { priority: 1 },
      cell: ({ row }) => (
        <StatusBadge variant={row.original.isActive ? 'success' : 'neutral'} dot>
          {row.original.isActive ? t('athletes.tests.status.active') : t('athletes.tests.status.inactive')}
        </StatusBadge>
      ),
    },
    { accessorKey: 'unit', header: t('athletes.tests.catalog.columns.unit'), meta: { priority: 3 } },
    {
      accessorKey: 'direction',
      header: t('athletes.tests.catalog.columns.direction'),
      meta: { priority: 4 },
      cell: ({ row }) => t(directionLabelKey(row.original.direction)),
    },
    {
      accessorKey: 'attempts',
      header: t('athletes.tests.catalog.columns.attempts'),
      meta: { priority: 4 },
      cell: ({ row }) => t('athletes.tests.catalog.attemptsValue', { count: row.original.attempts }),
    },
    {
      accessorKey: 'countingRule',
      header: t('athletes.tests.catalog.columns.countingRule'),
      meta: { priority: 5 },
      cell: () => t('athletes.tests.countingRule.best'),
    },
    {
      id: 'threshold',
      accessorFn: (row) => row.clearChangeThreshold ?? -1,
      header: t('athletes.tests.catalog.columns.threshold'),
      meta: { priority: 5 },
      cell: ({ row }) => {
        const value = formatTestNumber(row.original.clearChangeThreshold, locale)
        if (value === null) {
          return <span aria-label={t('athletes.tests.catalog.thresholdNone')}>—</span>
        }
        const text = `${value} ${row.original.unit}`.trim()
        return row.original.thresholdSource
          ? t('athletes.tests.catalog.thresholdWithSource', { value: text, source: row.original.thresholdSource })
          : text
      },
    },
    {
      accessorKey: 'repeatEveryWeeks',
      header: t('athletes.tests.catalog.columns.repeat'),
      meta: { priority: 4 },
      cell: ({ row }) => t('athletes.tests.catalog.repeatValue', { count: row.original.repeatEveryWeeks }),
    },
    {
      id: 'run',
      header: t('athletes.tests.catalog.columns.run'),
      enableSorting: false,
      meta: { priority: 1 },
      cell: ({ row }) => {
        const definition = row.original
        const testName = formatTestName(definition.name, definition.variant)
        if (definition.openSession && canRecord) {
          return (
            <Button asChild size="sm" variant="secondary">
              <Link
                href={testFieldHref(definition.openSession.id)}
                aria-label={t('athletes.tests.catalog.resumeAria', { name: testName })}
                onClick={(event) => event.stopPropagation()}
              >
                <Undo2 className="size-4" aria-hidden="true" />
                {t('athletes.tests.catalog.resume')}
              </Link>
            </Button>
          )
        }
        if (definition.openSession) {
          return <span>{t('athletes.tests.catalog.inProgress')}</span>
        }
        if (definition.isActive && canRecord) {
          return (
            <Button asChild size="sm" variant="outline">
              <Link
                href={testStartHref(definition.id)}
                aria-label={t('athletes.tests.catalog.startAria', { name: testName })}
                onClick={(event) => event.stopPropagation()}
              >
                <Play className="size-4" aria-hidden="true" />
                {t('athletes.tests.actions.start')}
              </Link>
            </Button>
          )
        }
        return null
      },
    },
  ], [canRecord, locale, t])

  if (error) {
    return <TestsLoadErrorMessage error={error} onRetry={() => setReloadToken((value) => value + 1)} />
  }

  const emptyState = (
    <EmptyState
      icon={<ClipboardList className="size-6" aria-hidden="true" />}
      title={t('athletes.tests.catalog.empty.title')}
      description={t('athletes.tests.catalog.empty.description')}
    />
  )

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {t('athletes.tests.catalog.readOnlyNote')}
        {' '}
        {!isLoading && definitions.length > 0 ? t('athletes.tests.catalog.activeCount', { count: activeCount }) : null}
      </p>
      <DataTable<CatalogRow>
        title={t('athletes.tests.catalog.title')}
        titleHeadingLevel={1}
        entityId={TEST_DEFINITION_ENTITY_ID}
        extensionTableId="athletes.tests.catalog"
        actions={canRecord ? (
          <Button asChild>
            <Link href={testStartHref()}>
              <Play className="size-4" aria-hidden="true" />
              {t('athletes.tests.actions.start')}
            </Link>
          </Button>
        ) : null}
        columns={columns}
        data={rows}
        isLoading={isLoading}
        emptyState={emptyState}
        onRowClick={(row) => router.push(testViewHref(row.id))}
        rowActions={(row) => {
          const items: RowActionItem[] = [
            { id: 'athletes.tests.view', label: t('athletes.tests.actions.viewResults'), href: testViewHref(row.id) },
          ]
          if (canRecord && row.openSession) {
            items.push({ id: 'athletes.tests.resume', label: t('athletes.tests.catalog.resume'), href: testFieldHref(row.openSession.id) })
          } else if (canRecord && row.isActive) {
            items.push({ id: 'athletes.tests.start', label: t('athletes.tests.actions.start'), href: testStartHref(row.id) })
          }
          return <RowActions items={items} />
        }}
      />
    </div>
  )
}
