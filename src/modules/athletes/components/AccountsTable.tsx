"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader, extractOptimisticLockConflict, extractRecordLockConflict } from '@open-mercato/ui/backend/utils/optimisticLock'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDisplayName, HideNamesToggle, useHideNames } from './PersonName'
import { CLUB_ROLES, clubRoleLabel, clubRoleOptions, isClubRole, type ClubRole } from './AccountRoles'
import { useCurrentClub } from './AccountClubScope'
import { AccountInviteDialog } from './AccountInviteDialog'

const TABLE_ID = 'athletes.accounts'
const ACCOUNTS_QUERY_KEY = 'athletes-accounts'
const MUTATION_CONTEXT_ID = 'athletes-accounts:row'
const SOURCE_PAGE_SIZE = 100
const MAX_SOURCE_PAGES = 20
const VIEW_PAGE_SIZE = 25

export type AccountStatus = 'active' | 'pending' | 'inactive'

const STATUS_VARIANTS: Record<AccountStatus, StatusBadgeVariant> = {
  active: 'success',
  pending: 'warning',
  inactive: 'neutral',
}

type AuthUserItem = {
  id: string
  email: string
  name: string | null
  organizationId: string | null
  roles?: string[]
  isConfirmed?: boolean
  updatedAt?: string | null
}

type AuthUsersResponse = { items?: AuthUserItem[]; totalPages?: number }

type InviteStatusResponse = { items?: Array<{ id: string; pending: boolean }> }

export type AccountRow = {
  id: string
  email: string
  name: string
  clubRoles: ClubRole[]
  isConfirmed: boolean
  pending: boolean
  status: AccountStatus
  updatedAt: string | null
}

type Translate = ReturnType<typeof useT>

function statusLabel(status: AccountStatus, t: Translate): string {
  switch (status) {
    case 'active':
      return t('athletes.accounts.status.active', 'Aktywne')
    case 'pending':
      return t('athletes.accounts.status.pending', 'Zaproszenie oczekuje')
    case 'inactive':
      return t('athletes.accounts.status.inactive', 'Nieaktywne')
  }
}

async function loadInviteStatus(ids: string[], errorMessage: string): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>()
  if (ids.length === 0) return result
  const call = await apiCall<InviteStatusResponse>(
    `/api/athletes/accounts/invite-status?ids=${encodeURIComponent(ids.join(','))}`,
  )
  if (!call.ok) await raiseCrudError(call.response, errorMessage)
  for (const item of call.result?.items ?? []) result.set(item.id, item.pending === true)
  return result
}

/**
 * Loads every account of the club. A club has a handful of staff accounts, and the
 * status ("Zaproszenie oczekuje") is not an `auth` list field, so role/status filters
 * run over the complete club set rather than over one server page.
 */
async function loadClubAccounts(organizationId: string, errorMessage: string): Promise<AccountRow[]> {
  const rows: AccountRow[] = []
  for (let page = 1; page <= MAX_SOURCE_PAGES; page += 1) {
    const params = new URLSearchParams({
      organizationId,
      page: String(page),
      pageSize: String(SOURCE_PAGE_SIZE),
    })
    const call = await apiCall<AuthUsersResponse>(`/api/auth/users?${params.toString()}`)
    if (!call.ok) await raiseCrudError(call.response, errorMessage)
    const items = (call.result?.items ?? []).filter((item) => item.organizationId === organizationId)
    const clubItems = items.filter((item) => {
      const roles = item.roles ?? []
      return roles.length === 0 || roles.some(isClubRole)
    })
    const pendingById = await loadInviteStatus(clubItems.map((item) => item.id), errorMessage)
    for (const item of clubItems) {
      const isConfirmed = item.isConfirmed !== false
      const pending = pendingById.get(item.id) === true
      rows.push({
        id: item.id,
        email: item.email,
        name: item.name ?? '',
        clubRoles: CLUB_ROLES.filter((role) => (item.roles ?? []).includes(role)),
        isConfirmed,
        pending,
        status: !isConfirmed ? 'inactive' : pending ? 'pending' : 'active',
        updatedAt: item.updatedAt ?? null,
      })
    }
    const totalPages = call.result?.totalPages ?? 1
    if (page >= totalPages) break
  }
  return rows
}

export function AccountsTable() {
  const t = useT()
  const queryClient = useQueryClient()
  const club = useCurrentClub()
  const [hideNames] = useHideNames()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [page, setPage] = React.useState(1)
  const [inviteOpen, setInviteOpen] = React.useState(false)
  const [busyRowId, setBusyRowId] = React.useState<string | null>(null)

  const organizationId = club.status === 'ready' ? club.club.organizationId : null
  const loadErrorMessage = t('athletes.accounts.error.load', 'Nie udało się wczytać kont klubu.')

  const accountsQuery = useQuery({
    queryKey: [ACCOUNTS_QUERY_KEY, organizationId],
    queryFn: () => loadClubAccounts(organizationId as string, loadErrorMessage),
    enabled: !!organizationId,
  })

  const refresh = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [ACCOUNTS_QUERY_KEY] })
  }, [queryClient])

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: MUTATION_CONTEXT_ID,
    blockedMessage: t('athletes.accounts.error.blocked', 'Tej zmiany nie można teraz zapisać.'),
  })

  const setConfirmed = React.useCallback(
    async (row: AccountRow, isConfirmed: boolean) => {
      const fallback = isConfirmed
        ? t('athletes.accounts.reactivate.error', 'Nie udało się aktywować konta.')
        : t('athletes.accounts.deactivate.error', 'Nie udało się dezaktywować konta.')
      setBusyRowId(row.id)
      try {
        await runMutation({
          operation: () =>
            withScopedApiRequestHeaders(buildOptimisticLockHeader(row.updatedAt), async () => {
              const call = await apiCall('/api/auth/users', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ id: row.id, isConfirmed }),
              })
              if (!call.ok) await raiseCrudError(call.response, fallback)
              return call
            }),
          context: { formId: MUTATION_CONTEXT_ID, resourceKind: 'auth.user', retryLastMutation },
          mutationPayload: { id: row.id, isConfirmed },
        })
        flash(
          isConfirmed
            ? t('athletes.accounts.reactivate.success', 'Konto znów jest aktywne.')
            : t('athletes.accounts.deactivate.success', 'Konto dezaktywowane. Osoba straciła dostęp.'),
          'success',
        )
      } catch (error) {
        // Version conflicts are surfaced by the shared conflict banner (useGuardedMutation).
        if (extractOptimisticLockConflict(error) || extractRecordLockConflict(error)) return
        const message = error instanceof Error && error.message ? error.message : fallback
        flash(message, 'error')
      } finally {
        setBusyRowId(null)
        refresh()
      }
    },
    [refresh, retryLastMutation, runMutation, t],
  )

  const handleDeactivate = React.useCallback(
    async (row: AccountRow) => {
      const confirmed = await confirm({
        title: t('athletes.accounts.deactivate.confirmTitle', 'Dezaktywować konto?'),
        text: t(
          'athletes.accounts.deactivate.confirmText',
          'Osoba natychmiast straci dostęp do klubu. Możesz później aktywować konto ponownie.',
        ),
        confirmText: t('athletes.accounts.actions.deactivate', 'Dezaktywuj'),
        cancelText: t('athletes.accounts.actions.cancel', 'Anuluj'),
        variant: 'destructive',
      })
      if (!confirmed) return
      await setConfirmed(row, false)
    },
    [confirm, setConfirmed, t],
  )

  const handleResend = React.useCallback(
    async (row: AccountRow) => {
      const fallback = t('athletes.accounts.resend.error', 'Nie udało się wysłać zaproszenia ponownie.')
      setBusyRowId(row.id)
      try {
        const call = await runMutation({
          operation: async () =>
            apiCall<{ ok?: boolean; warning?: string }>('/api/auth/users/resend-invite', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id: row.id }),
            }),
          context: { formId: MUTATION_CONTEXT_ID, resourceKind: 'auth.user', retryLastMutation },
          mutationPayload: { id: row.id },
        })
        if (call.status === 429) {
          flash(t('athletes.accounts.resend.rateLimited', 'Zaproszenie wysłano już kilka razy. Spróbuj ponownie za kilka minut.'), 'error')
          return
        }
        if (call.status === 409) {
          flash(t('athletes.accounts.resend.alreadySet', 'Ta osoba ustawiła już hasło — zaproszenie nie jest potrzebne.'), 'error')
          refresh()
          return
        }
        if (!call.ok) await raiseCrudError(call.response, fallback)
        if (call.result?.warning) {
          flash(t('athletes.accounts.resend.emailFailed', 'Nie udało się wysłać e-maila. Spróbuj ponownie później.'), 'error')
          return
        }
        flash(t('athletes.accounts.resend.success', 'Zaproszenie wysłane ponownie.'), 'success')
      } catch (error) {
        const message = error instanceof Error && error.message ? error.message : fallback
        flash(message, 'error')
      } finally {
        setBusyRowId(null)
      }
    },
    [refresh, retryLastMutation, runMutation, t],
  )

  const roleFilter = typeof filterValues.role === 'string' && isClubRole(filterValues.role) ? filterValues.role : null
  const statusFilter =
    filterValues.status === 'active' || filterValues.status === 'pending' || filterValues.status === 'inactive'
      ? (filterValues.status as AccountStatus)
      : null

  const allRows = accountsQuery.data
  const filteredRows = React.useMemo(() => {
    return (allRows ?? []).filter((row) => {
      if (roleFilter && !row.clubRoles.includes(roleFilter)) return false
      if (statusFilter && row.status !== statusFilter) return false
      return true
    })
  }, [allRows, roleFilter, statusFilter])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / VIEW_PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageRows = React.useMemo(
    () => filteredRows.slice((currentPage - 1) * VIEW_PAGE_SIZE, currentPage * VIEW_PAGE_SIZE),
    [currentPage, filteredRows],
  )

  const filters = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'role',
        label: t('athletes.accounts.filters.role', 'Rola'),
        type: 'select',
        options: clubRoleOptions(t),
      },
      {
        id: 'status',
        label: t('athletes.accounts.filters.status', 'Status'),
        type: 'select',
        options: (['active', 'pending', 'inactive'] as const).map((status) => ({
          value: status,
          label: statusLabel(status, t),
        })),
      },
    ],
    [t],
  )

  const columns = React.useMemo<ColumnDef<AccountRow>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('athletes.accounts.columns.person', 'Osoba'),
        meta: { priority: 1 },
        cell: ({ row }) => {
          const display = formatDisplayName(row.original.name, hideNames)
          return display ? (
            <span data-person-name="">{display}</span>
          ) : (
            <span className="text-muted-foreground">{t('athletes.accounts.noName', 'Bez nazwy')}</span>
          )
        },
      },
      {
        accessorKey: 'email',
        header: t('athletes.accounts.columns.email', 'E-mail'),
        meta: { priority: 2, truncate: true },
      },
      {
        accessorKey: 'clubRoles',
        header: t('athletes.accounts.columns.role', 'Rola'),
        enableSorting: false,
        meta: { priority: 3 },
        cell: ({ row }) =>
          row.original.clubRoles.length ? (
            row.original.clubRoles.map((role) => clubRoleLabel(role, t)).join(', ')
          ) : (
            <span className="text-muted-foreground">{t('athletes.roles.none', 'Brak roli')}</span>
          ),
      },
      {
        accessorKey: 'status',
        header: t('athletes.accounts.columns.status', 'Status'),
        meta: { priority: 1 },
        cell: ({ row }) => (
          <StatusBadge variant={STATUS_VARIANTS[row.original.status]} dot>
            {statusLabel(row.original.status, t)}
          </StatusBadge>
        ),
      },
    ],
    [hideNames, t],
  )

  if (club.status === 'loading') {
    return <LoadingMessage label={t('athletes.accounts.loading', 'Wczytywanie kont klubu…')} />
  }
  if (club.status === 'error') {
    return <ErrorMessage label={loadErrorMessage} />
  }
  if (club.status === 'missing') {
    return (
      <ErrorMessage
        label={t('athletes.accounts.error.noClub', 'Brak kontekstu klubu.')}
        description={t('athletes.accounts.error.noClubDescription', 'Twoje konto nie jest przypisane do klubu. Skontaktuj się z operatorem.')}
      />
    )
  }

  const hasAnyAccount = (allRows?.length ?? 0) > 0
  const isFiltered = !!roleFilter || !!statusFilter

  const inviteButton = (
    <Button type="button" onClick={() => setInviteOpen(true)}>
      {t('athletes.accounts.actions.invite', 'Zaproś')}
    </Button>
  )

  return (
    <div className="flex flex-col gap-4">
      <HideNamesToggle />
      <DataTable<AccountRow>
        title={t('athletes.accounts.title', 'Status konta')}
        titleHeadingLevel={1}
        actions={(
          <div className="flex items-center gap-2">
            <Button asChild type="button" variant="destructive">
              <Link href="/backend/accounts/delete-club">{t('athletes.accounts.actions.deleteClub', 'Usuń dane klubu')}</Link>
            </Button>
            {inviteButton}
          </div>
        )}
        columns={columns}
        data={pageRows}
        entityId="athletes:account"
        extensionTableId={TABLE_ID}
        exporter={false}
        filters={filters}
        filterValues={filterValues}
        onFiltersApply={(values: FilterValues) => {
          setFilterValues(values)
          setPage(1)
        }}
        onFiltersClear={() => {
          setFilterValues({})
          setPage(1)
        }}
        isLoading={accountsQuery.isLoading}
        error={accountsQuery.isError ? loadErrorMessage : null}
        disableRowClick
        emptyState={
          hasAnyAccount || isFiltered ? (
            <EmptyState
              size="sm"
              title={t('athletes.accounts.emptyFiltered', 'Żadne konto nie pasuje do filtrów.')}
            />
          ) : (
            <EmptyState
              title={t('athletes.accounts.empty.title', 'Nikt jeszcze nie został zaproszony')}
              description={t('athletes.accounts.empty.description', 'Zaproś trenera, dyrektora lub drugiego administratora klubu.')}
              actions={inviteButton}
            />
          )
        }
        rowActions={(row) => {
          const busy = busyRowId === row.id
          const items = [] as Array<{ id: string; label: string; destructive?: boolean; onSelect: () => void }>
          if (row.status === 'pending') {
            items.push({
              id: 'athletes.accounts.resend',
              label: t('athletes.accounts.actions.resend', 'Wyślij ponownie'),
              onSelect: () => {
                if (!busy) void handleResend(row)
              },
            })
          }
          if (row.isConfirmed) {
            items.push({
              id: 'athletes.accounts.deactivate',
              label: t('athletes.accounts.actions.deactivate', 'Dezaktywuj'),
              destructive: true,
              onSelect: () => {
                if (!busy) void handleDeactivate(row)
              },
            })
          } else {
            items.push({
              id: 'athletes.accounts.reactivate',
              label: t('athletes.accounts.actions.reactivate', 'Aktywuj ponownie'),
              onSelect: () => {
                if (!busy) void setConfirmed(row, true)
              },
            })
          }
          return <RowActions items={items} />
        }}
        pagination={{
          page: currentPage,
          pageSize: VIEW_PAGE_SIZE,
          total: filteredRows.length,
          totalPages,
          onPageChange: setPage,
        }}
      />
      {organizationId ? (
        <AccountInviteDialog
          open={inviteOpen}
          organizationId={organizationId}
          onClose={() => setInviteOpen(false)}
          onInvited={refresh}
        />
      ) : null}
      {ConfirmDialogElement}
    </div>
  )
}

export default AccountsTable
