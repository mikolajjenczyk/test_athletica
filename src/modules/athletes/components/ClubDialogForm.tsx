"use client"

import * as React from 'react'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'

type ClubDialogFormProps<TValues extends Record<string, unknown>> = {
  open: boolean
  onClose: () => void
  formId: string
  entityId: string
  title: string
  description: string
  submitLabel: string
  fields: CrudField[]
  initialValues: Partial<TValues>
  onSubmit: (values: TValues) => Promise<void>
}

/**
 * Dialog host for a small `CrudForm` (team, position). `CrudForm` derives the optimistic-lock
 * header from `initialValues.updatedAt` when `initialValues.id` is set. Escape closes the dialog
 * (Radix default); Cmd/Ctrl+Enter submits the form.
 */
export function ClubDialogForm<TValues extends Record<string, unknown>>({
  open,
  onClose,
  formId,
  entityId,
  title,
  description,
  submitLabel,
  fields,
  initialValues,
  onSubmit,
}: ClubDialogFormProps<TValues>) {
  const handleKeyDown = React.useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      const form = typeof document !== 'undefined' ? document.getElementById(formId) : null
      if (form instanceof HTMLFormElement) form.requestSubmit()
    }
  }, [formId])

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {open ? (
          <CrudForm<TValues>
            embedded
            formId={formId}
            entityId={entityId}
            title={title}
            submitLabel={submitLabel}
            fields={fields}
            initialValues={initialValues}
            onSubmit={onSubmit}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
