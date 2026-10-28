"use client"

import * as React from 'react'
import { Plus, Users } from 'lucide-react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions, type RowActionItem } from '@open-mercato/ui/backend/RowActions'
import type { CrudField } from '@open-mercato/ui/backend/CrudForm'
import { createCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { ClubDialogForm } from './ClubDialogForm'
import { TEAM_ENTITY_ID, rethrowTranslated, useClubRowDelete } from './ClubShared'

export type TeamRow = { id: string; name: string; isActive: boolean; updatedAt: string | null }

type TeamFormValues = { id?: string; name: string; isActive: boolean; updatedAt?: string | null }

type TeamSectionProps = {
  teams: TeamRow[]
  isLoading: boolean
  error: string | null
  canManage: boolean
  onRetry: () => void
  onChanged: () => void
}

const TEAM_FORM_ID = 'athletes-team-dialog-form'

export function TeamSection({ teams, isLoading, error, canManage, onRetry, onChanged }: TeamSectionProps) {
  const t = useT()
  const [dialog, setDialog] = React.useState<{ mode: 'create' } | { mode: 'edit'; row: TeamRow } | null>(null)
  const { deleteRow, ConfirmDialogElement } = useClubRowDelete('athletes-teams-table')
  const refreshAfterClose = React.useRef(false)

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'name',
      label: t('athletes.team.form.name'),
      type: 'text',
      required: true,
      maxLength: 80,
      placeholder: t('athletes.team.form.namePlaceholder'),
    },
    {
      id: 'isActive',
      label: t('athletes.team.form.isActive'),
      type: 'checkbox',
      description: t('athletes.team.form.isActiveHint'),
    },
  ], [t])

  const columns = React.useMemo<ColumnDef<TeamRow>[]>(() => [
    { accessorKey: 'name', header: t('athletes.team.table.name'), meta: { priority: 1 } },
    {
      accessorKey: 'isActive',
      header: t('athletes.team.table.status'),
      meta: { priority: 2 },
      cell: ({ row }) => (
        <StatusBadge variant={row.original.isActive ? 'success' : 'neutral'} dot>
          {row.original.isActive ? t('athletes.team.status.active') : t('athletes.team.status.inactive')}
        </StatusBadge>
      ),
    },
  ], [t])

  const initialValues = React.useMemo<Partial<TeamFormValues>>(() => {
    if (dialog?.mode === 'edit') {
      return { id: dialog.row.id, name: dialog.row.name, isActive: dialog.row.isActive, updatedAt: dialog.row.updatedAt }
    }
    return { name: '', isActive: true }
  }, [dialog])

  const handleSubmit = React.useCallback(async (values: TeamFormValues) => {
    const payload = { name: String(values.name ?? '').trim(), isActive: values.isActive !== false }
    try {
      if (dialog?.mode === 'edit') {
        // CrudForm attaches the expected-version header from initialValues.updatedAt.
        await updateCrud('athletes/teams', { id: dialog.row.id, ...payload })
        flash(t('athletes.team.flash.saved'), 'success')
      } else {
        await createCrud('athletes/teams', payload)
        flash(t('athletes.team.flash.created'), 'success')
      }
    } catch (err) {
      rethrowTranslated(err, t, 'athletes.team.errors.save')
    }
    // Refresh only after the dialog has closed: the refresh can swap the empty state
    // (which holds the trigger button) for the table.
    refreshAfterClose.current = true
    setDialog(null)
  }, [dialog, t])

  const handleAfterClose = React.useCallback(() => {
    if (!refreshAfterClose.current) return
    refreshAfterClose.current = false
    onChanged()
  }, [onChanged])

  const createButton = canManage ? (
    <Button type="button" onClick={() => setDialog({ mode: 'create' })}>
      <Plus className="size-4" aria-hidden="true" />
      {t('athletes.team.actions.create')}
    </Button>
  ) : null

  let body: React.ReactNode
  if (error) {
    body = (
      <ErrorMessage
        label={t('athletes.team.errors.load')}
        description={error}
        action={(
          <Button type="button" variant="outline" onClick={onRetry}>
            {t('athletes.club.actions.retry')}
          </Button>
        )}
      />
    )
  } else if (!isLoading && teams.length === 0) {
    body = (
      <section aria-labelledby="athletes-team-empty-title" className="space-y-3">
        <h2 id="athletes-team-empty-title" className="text-lg font-semibold">{t('athletes.team.section.title')}</h2>
        <EmptyState
          icon={<Users className="size-6" aria-hidden="true" />}
          title={t('athletes.team.empty.title')}
          description={canManage ? t('athletes.team.empty.description') : t('athletes.team.empty.descriptionReadOnly')}
          actions={createButton}
        />
      </section>
    )
  } else {
    body = (
      <DataTable<TeamRow>
        title={t('athletes.team.section.title')}
        entityId={TEAM_ENTITY_ID}
        extensionTableId="athletes.club.teams"
        columns={columns}
        data={teams}
        isLoading={isLoading}
        embedded
        disableRowClick
        actions={createButton}
        emptyState={t('athletes.team.empty.title')}
        rowActions={canManage ? (row) => {
          const items: RowActionItem[] = [
            { id: 'athletes.teams.edit', label: t('athletes.club.actions.edit'), onSelect: () => setDialog({ mode: 'edit', row }) },
            {
              id: 'athletes.teams.delete',
              label: t('athletes.club.actions.delete'),
              destructive: true,
              onSelect: () => {
                void deleteRow(row, {
                  apiPath: 'athletes/teams',
                  confirmTitle: t('athletes.team.confirm.deleteTitle', { name: row.name }),
                  confirmText: t('athletes.team.confirm.deleteText'),
                  successMessage: t('athletes.team.flash.deleted'),
                  errorFallbackKey: 'athletes.team.errors.delete',
                  onSettled: onChanged,
                })
              },
            },
          ]
          return <RowActions items={items} />
        } : undefined}
      />
    )
  }

  return (
    <>
      {body}
      <ClubDialogForm<TeamFormValues>
        open={dialog !== null}
        onClose={() => setDialog(null)}
        formId={TEAM_FORM_ID}
        entityId={TEAM_ENTITY_ID}
        title={dialog?.mode === 'edit' ? t('athletes.team.form.editTitle') : t('athletes.team.form.createTitle')}
        description={t('athletes.team.form.description')}
        submitLabel={dialog?.mode === 'edit' ? t('athletes.club.actions.save') : t('athletes.team.actions.create')}
        fields={fields}
        initialValues={initialValues}
        onSubmit={handleSubmit}
        onAfterClose={handleAfterClose}
      />
      {ConfirmDialogElement}
    </>
  )
}
