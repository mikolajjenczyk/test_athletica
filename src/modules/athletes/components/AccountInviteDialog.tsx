"use client"

import * as React from 'react'
import { z } from 'zod'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CLUB_ROLES, clubRoleOptions, type ClubRole } from './AccountRoles'

const INVITE_CONTEXT_ID = 'athletes-accounts:invite'
const INVITE_FORM_ID = 'athletes-account-invite-form'

type InviteFormValues = {
  email: string
  name: string
  role: ClubRole | ''
}

type InviteResponse = { id?: string; _warning?: string }

type AccountInviteDialogProps = {
  open: boolean
  organizationId: string
  onClose: () => void
  onInvited: () => void
}

function hasEmailFieldError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const fieldErrors = (error as { fieldErrors?: unknown }).fieldErrors
  return !!fieldErrors && typeof fieldErrors === 'object' && 'email' in (fieldErrors as Record<string, unknown>)
}

export function AccountInviteDialog({ open, organizationId, onClose, onInvited }: AccountInviteDialogProps) {
  const t = useT()
  // Fresh form on every open so stale values and errors never carry over.
  const [formInstanceKey, setFormInstanceKey] = React.useState(0)
  React.useEffect(() => {
    if (open) setFormInstanceKey((current) => current + 1)
  }, [open])

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: INVITE_CONTEXT_ID,
    blockedMessage: t('athletes.accounts.invite.blocked', 'Nie można teraz wysłać zaproszenia.'),
  })

  const schema = React.useMemo(
    () =>
      z.object({
        email: z.string().trim().email(t('athletes.accounts.invite.validation.email', 'Podaj poprawny adres e-mail.')),
        name: z
          .string()
          .trim()
          .min(1, t('athletes.accounts.invite.validation.name', 'Podaj imię i nazwisko.'))
          .max(120, t('athletes.accounts.invite.validation.nameLength', 'Imię i nazwisko może mieć najwyżej 120 znaków.')),
        role: z.enum(CLUB_ROLES, {
          message: t('athletes.accounts.invite.validation.role', 'Wybierz rolę.'),
        }),
      }) as unknown as z.ZodType<InviteFormValues>,
    [t],
  )

  const fields = React.useMemo<CrudField[]>(
    () => [
      {
        id: 'email',
        label: t('athletes.accounts.invite.fields.email', 'E-mail'),
        type: 'text',
        required: true,
        placeholder: t('athletes.accounts.invite.fields.emailPlaceholder', 'np. trener@klub.pl'),
      },
      {
        id: 'name',
        label: t('athletes.accounts.invite.fields.name', 'Imię i nazwisko'),
        type: 'text',
        required: true,
      },
      {
        id: 'role',
        label: t('athletes.accounts.invite.fields.role', 'Rola'),
        type: 'select',
        required: true,
        options: clubRoleOptions(t),
      },
    ],
    [t],
  )

  const initialValues = React.useMemo<Partial<InviteFormValues>>(() => ({ email: '', name: '', role: '' }), [])

  const handleSubmit = React.useCallback(
    async (values: InviteFormValues) => {
      const role = values.role
      if (!role) {
        const message = t('athletes.accounts.invite.validation.role', 'Wybierz rolę.')
        throw createCrudFormError(message, { role: message })
      }
      const payload = {
        email: values.email.trim(),
        name: values.name.trim(),
        organizationId,
        roles: [role],
        sendInviteEmail: true,
      }
      let warning: string | undefined
      try {
        const call = await runMutation({
          operation: () =>
            createCrud<InviteResponse>('auth/users', payload, {
              errorMessage: t('athletes.accounts.invite.error', 'Nie udało się wysłać zaproszenia.'),
            }),
          context: { formId: INVITE_CONTEXT_ID, resourceKind: 'auth.user', retryLastMutation },
          mutationPayload: { roles: payload.roles, sendInviteEmail: true },
        })
        warning = call.result?._warning
      } catch (error) {
        if (hasEmailFieldError(error)) {
          // Neutral on purpose: never confirm or echo which addresses already have an account.
          const message = t(
            'athletes.accounts.invite.emailUnavailable',
            'Nie można zaprosić osoby na ten adres e-mail. Sprawdź adres lub użyj innego.',
          )
          throw createCrudFormError(message, { email: message })
        }
        throw error
      }
      if (warning) {
        flash(
          t('athletes.accounts.invite.emailFailed', 'Konto utworzono, ale e-maila z zaproszeniem nie udało się wysłać. Użyj „Wyślij ponownie”.'),
          'error',
        )
      } else {
        flash(t('athletes.accounts.invite.success', 'Zaproszenie wysłane.'), 'success')
      }
      onInvited()
      onClose()
    },
    [onClose, onInvited, organizationId, retryLastMutation, runMutation, t],
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            const form = document.getElementById(INVITE_FORM_ID)
            if (form instanceof HTMLFormElement) form.requestSubmit()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('athletes.accounts.invite.title', 'Zaproś osobę do klubu')}</DialogTitle>
          <DialogDescription>
            {t(
              'athletes.accounts.invite.description',
              'Osoba dostanie e-mail z linkiem do ustawienia hasła. Ctrl/⌘ + Enter wysyła, Esc zamyka.',
            )}
          </DialogDescription>
        </DialogHeader>
        <CrudForm<InviteFormValues>
          key={formInstanceKey}
          formId={INVITE_FORM_ID}
          embedded
          fields={fields}
          initialValues={initialValues}
          schema={schema}
          submitLabel={t('athletes.accounts.invite.submit', 'Wyślij zaproszenie')}
          onSubmit={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  )
}

export default AccountInviteDialog
