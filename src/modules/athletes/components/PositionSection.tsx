"use client"

import * as React from 'react'
import { Plus } from 'lucide-react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions, type RowActionItem } from '@open-mercato/ui/backend/RowActions'
import type { CrudField } from '@open-mercato/ui/backend/CrudForm'
import { createCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { ClubDialogForm } from './ClubDialogForm'
import { POSITION_ENTITY_ID, rethrowTranslated, translateAthletesError, useClubRowDelete } from './ClubShared'

export type PositionRow = { id: string; name: string; sortOrder: number; updatedAt: string | null }

type PositionFormValues = { id?: string; name: string; sortOrder?: number | string | null; updatedAt?: string | null }

const POSITION_FORM_ID = 'athletes-position-dialog-form'

function toSortOrder(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : undefined
}

export function PositionSection({ canManage }: { canManage: boolean }) {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<PositionRow[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [dialog, setDialog] = React.useState<{ mode: 'create' } | { mode: 'edit'; row: PositionRow } | null>(null)
  const { deleteRow, ConfirmDialogElement } = useClubRowDelete('athletes-positions-table')
  const reload = React.useCallback(() => setReloadToken((value) => value + 1), [])

  React.useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)
    fetchCrudList<PositionRow>('athletes/positions', { page: 1, pageSize: 100, sortField: 'sortOrder', sortDir: 'asc' })
      .then((data) => { if (!cancelled) setRows(data.items ?? []) })
      .catch((err: unknown) => { if (!cancelled) setError(translateAthletesError(err, t, 'athletes.positions.errors.load')) })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [reloadToken, scopeVersion, t])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'name',
      label: t('athletes.positions.form.name'),
      type: 'text',
      required: true,
      maxLength: 40,
      placeholder: t('athletes.positions.form.namePlaceholder'),
    },
    {
      id: 'sortOrder',
      label: t('athletes.positions.form.sortOrder'),
      type: 'number',
      description: t('athletes.positions.form.sortOrderHint'),
    },
  ], [t])

  const columns = React.useMemo<ColumnDef<PositionRow>[]>(() => [
    { accessorKey: 'name', header: t('athletes.positions.table.name'), meta: { priority: 1 } },
    { accessorKey: 'sortOrder', header: t('athletes.positions.table.sortOrder'), meta: { priority: 2 } },
  ], [t])

  const nextSortOrder = React.useMemo(
    () => rows.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1,
    [rows],
  )

  const initialValues = React.useMemo<Partial<PositionFormValues>>(() => {
    if (dialog?.mode === 'edit') {
      return { id: dialog.row.id, name: dialog.row.name, sortOrder: dialog.row.sortOrder, updatedAt: dialog.row.updatedAt }
    }
    return { name: '', sortOrder: nextSortOrder }
  }, [dialog, nextSortOrder])

  const handleSubmit = React.useCallback(async (values: PositionFormValues) => {
    const payload = { name: String(values.name ?? '').trim(), sortOrder: toSortOrder(values.sortOrder) }
    try {
      if (dialog?.mode === 'edit') {
        // CrudForm attaches the expected-version header from initialValues.updatedAt.
        await updateCrud('athletes/positions', { id: dialog.row.id, ...payload })
        flash(t('athletes.positions.flash.saved'), 'success')
      } else {
        await createCrud('athletes/positions', payload)
        flash(t('athletes.positions.flash.created'), 'success')
      }
    } catch (err) {
      rethrowTranslated(err, t, 'athletes.positions.errors.save')
    }
    setDialog(null)
    reload()
  }, [dialog, reload, t])

  return (
    <>
      <DataTable<PositionRow>
        title={t('athletes.positions.section.title')}
        entityId={POSITION_ENTITY_ID}
        extensionTableId="athletes.club.positions"
        columns={columns}
        data={rows}
        isLoading={isLoading}
        error={error}
        embedded
        disableRowClick
        actions={canManage ? (
          <Button type="button" onClick={() => setDialog({ mode: 'create' })}>
            <Plus className="size-4" aria-hidden="true" />
            {t('athletes.positions.actions.create')}
          </Button>
        ) : null}
        emptyState={canManage ? t('athletes.positions.empty.description') : t('athletes.positions.empty.descriptionReadOnly')}
        rowActions={canManage ? (row) => {
          const items: RowActionItem[] = [
            { id: 'athletes.positions.edit', label: t('athletes.club.actions.edit'), onSelect: () => setDialog({ mode: 'edit', row }) },
            {
              id: 'athletes.positions.delete',
              label: t('athletes.club.actions.delete'),
              destructive: true,
              onSelect: () => {
                void deleteRow(row, {
                  apiPath: 'athletes/positions',
                  confirmTitle: t('athletes.positions.confirm.deleteTitle', { name: row.name }),
                  confirmText: t('athletes.positions.confirm.deleteText'),
                  successMessage: t('athletes.positions.flash.deleted'),
                  errorFallbackKey: 'athletes.positions.errors.delete',
                  onSettled: reload,
                })
              },
            },
          ]
          return <RowActions items={items} />
        } : undefined}
      />
      <ClubDialogForm<PositionFormValues>
        open={dialog !== null}
        onClose={() => setDialog(null)}
        formId={POSITION_FORM_ID}
        entityId={POSITION_ENTITY_ID}
        title={dialog?.mode === 'edit' ? t('athletes.positions.form.editTitle') : t('athletes.positions.form.createTitle')}
        description={t('athletes.positions.form.description')}
        submitLabel={dialog?.mode === 'edit' ? t('athletes.club.actions.save') : t('athletes.positions.actions.create')}
        fields={fields}
        initialValues={initialValues}
        onSubmit={handleSubmit}
      />
      {ConfirmDialogElement}
    </>
  )
}
