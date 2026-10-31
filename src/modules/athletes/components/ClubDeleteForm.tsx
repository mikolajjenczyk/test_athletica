"use client"

import * as React from 'react'
import Link from 'next/link'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useCurrentClub } from './AccountClubScope'

const CONTEXT_ID = 'athletes-club:delete'
const ACCOUNTS_HREF = '/backend/accounts'

type DeleteResult = {
  ok?: boolean
  deletedRecords?: number
  deactivatedAccounts?: number
  skippedAccounts?: number
  error?: string
}

type Outcome = { deletedRecords: number; deactivatedAccounts: number; skippedAccounts: number }

export function ClubDeleteForm() {
  const t = useT()
  const club = useCurrentClub()
  const [confirmationName, setConfirmationName] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [outcome, setOutcome] = React.useState<Outcome | null>(null)

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: CONTEXT_ID,
    blockedMessage: t('athletes.clubDelete.error.blocked', 'Tej operacji nie można teraz wykonać.'),
  })

  const clubName = club.status === 'ready' ? club.club.name : ''
  const matches = clubName.trim().length > 0 && confirmationName.trim() === clubName.trim()

  const submit = React.useCallback(async () => {
    if (!matches || submitting) return
    setSubmitting(true)
    setError(null)
    const fallback = t('athletes.clubDelete.error.generic', 'Nie udało się usunąć danych klubu. Spróbuj ponownie.')
    try {
      const call = await runMutation({
        operation: () =>
          apiCall<DeleteResult>('/api/athletes/club/delete-request', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ confirmationName: confirmationName.trim() }),
          }),
        context: { formId: CONTEXT_ID, resourceKind: 'athletes.club', retryLastMutation },
        mutationPayload: { confirmationName: confirmationName.trim() },
      })
      if (call.ok) {
        setOutcome({
          deletedRecords: call.result?.deletedRecords ?? 0,
          deactivatedAccounts: call.result?.deactivatedAccounts ?? 0,
          skippedAccounts: call.result?.skippedAccounts ?? 0,
        })
        return
      }
      const serverError = typeof call.result?.error === 'string' ? call.result.error : null
      if (call.status === 400 && serverError === 'athletes.errors.clubNameMismatch') {
        setError(t('athletes.errors.clubNameMismatch', 'Wpisana nazwa nie zgadza się z nazwą klubu.'))
      } else if (call.status === 403) {
        setError(t('athletes.clubDelete.error.forbidden', 'Nie masz uprawnień do usunięcia danych klubu.'))
      } else {
        setError(serverError && !serverError.startsWith('athletes.') ? serverError : fallback)
      }
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : fallback)
    } finally {
      setSubmitting(false)
    }
  }, [confirmationName, matches, retryLastMutation, runMutation, submitting, t])

  if (club.status === 'loading') {
    return <LoadingMessage label={t('athletes.clubDelete.loading', 'Wczytywanie danych klubu…')} />
  }
  if (club.status !== 'ready' || !clubName) {
    return (
      <ErrorMessage
        label={t('athletes.clubDelete.error.noClub', 'Nie udało się ustalić klubu.')}
        description={t('athletes.clubDelete.error.noClubDescription', 'Odśwież stronę. Jeśli problem wraca, skontaktuj się z operatorem.')}
      />
    )
  }

  if (outcome) {
    return (
      <div className="flex flex-col gap-4" role="status" aria-live="polite">
        <Alert status="success">
          <AlertTitle>{t('athletes.clubDelete.success.title', 'Dane klubu zostały usunięte')}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5">
              <li>
                {t('athletes.clubDelete.success.records', 'Usunięte rekordy (drużyna, zawodnicy, pozycje): {count}', {
                  count: outcome.deletedRecords,
                })}
              </li>
              <li>
                {t('athletes.clubDelete.success.accounts', 'Dezaktywowane konta: {count}', {
                  count: outcome.deactivatedAccounts,
                })}
              </li>
              {outcome.skippedAccounts > 0 ? (
                <li>
                  {t('athletes.clubDelete.success.skipped', 'Konta pominięte (np. Twoje): {count}', {
                    count: outcome.skippedAccounts,
                  })}
                </li>
              ) : null}
            </ul>
            <p className="mt-2">
              {t('athletes.clubDelete.success.restore', 'Operator może przywrócić dane. Trwałe usunięcie wykonuje operator na prośbę klubu.')}
            </p>
          </AlertDescription>
        </Alert>
        <div>
          <Button asChild type="button" variant="outline">
            <Link href={ACCOUNTS_HREF}>{t('athletes.clubDelete.backToAccounts', 'Wróć do statusu kont')}</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Alert status="warning">
        <AlertTitle>{t('athletes.clubDelete.explain.title', 'Co się stanie')}</AlertTitle>
        <AlertDescription>
          <ul className="list-disc pl-5">
            <li>{t('athletes.clubDelete.explain.records', 'Drużyna, wszyscy zawodnicy i pozycje klubu zostaną usunięte.')}</li>
            <li>{t('athletes.clubDelete.explain.accounts', 'Każde inne konto klubu zostanie dezaktywowane — te osoby natychmiast stracą dostęp.')}</li>
            <li>{t('athletes.clubDelete.explain.restore', 'Operator może przywrócić usunięte dane.')}</li>
            <li>{t('athletes.clubDelete.explain.purge', 'Trwałe usunięcie danych wykonuje operator — nie da się go zrobić z tego ekranu.')}</li>
          </ul>
        </AlertDescription>
      </Alert>
      <p className="text-sm">
        {t('athletes.clubDelete.instructions', 'Aby potwierdzić, wpisz dokładną nazwę klubu: {name}', { name: clubName })}
      </p>
      <FormField
        id="athletes-club-delete-name"
        label={t('athletes.clubDelete.fields.name', 'Nazwa klubu')}
        required
        error={error ?? undefined}
      >
        <Input
          value={confirmationName}
          autoComplete="off"
          spellCheck={false}
          disabled={submitting}
          onChange={(event) => {
            setConfirmationName(event.target.value)
            if (error) setError(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void submit()
            }
          }}
        />
      </FormField>
      <div className="flex items-center gap-2">
        <Button asChild type="button" variant="outline">
          <Link href={ACCOUNTS_HREF}>{t('athletes.clubDelete.cancel', 'Anuluj')}</Link>
        </Button>
        <Button
          type="button"
          variant="destructive-solid"
          disabled={!matches || submitting}
          aria-disabled={!matches || submitting}
          onClick={() => void submit()}
        >
          {submitting
            ? t('athletes.clubDelete.submitting', 'Usuwanie…')
            : t('athletes.clubDelete.submit', 'Usuń dane klubu')}
        </Button>
      </div>
    </div>
  )
}

export default ClubDeleteForm
