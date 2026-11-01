"use client"

import * as React from 'react'
import { Monitor } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { AccessDeniedMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { Button } from '@open-mercato/ui/primitives/button'
import { dailyImportErrorKey, type DailyImportKind } from '../lib/dailyImportUi'

/** Stable host IDs and routes of the E01 daily-data screens. */
export const TRAINING_SESSION_ENTITY_ID = 'athletes:athletes_training_session'
export const DAILY_IMPORT_ENTITY_ID = 'athletes:athletes_daily_import'

export const DAILY_HREF = '/backend/daily'
export const DAILY_IMPORT_HREF = '/backend/daily/import'

export function dailyImportHref(kind: DailyImportKind): string {
  return `${DAILY_IMPORT_HREF}?kind=${encodeURIComponent(kind)}`
}

type Translate = ReturnType<typeof useT>

/** A load failure that keeps the HTTP status, so a 403 renders as "permission denied". */
export type DailyLoadError = { message: string; forbidden: boolean }

export function toDailyLoadError(err: unknown, t: Translate, fallbackKey: string): DailyLoadError {
  const status = (err as { status?: number } | null)?.status
  if (status === 403) return { message: t('athletes.daily.errors.forbidden'), forbidden: true }
  return { message: t(dailyImportErrorKey(err, fallbackKey)), forbidden: false }
}

export function DailyLoadErrorMessage({ error, onRetry }: { error: DailyLoadError; onRetry?: () => void }) {
  const t = useT()
  if (error.forbidden) {
    return (
      <AccessDeniedMessage
        label={t('athletes.daily.errors.forbidden')}
        description={t('athletes.daily.errors.forbiddenDescription')}
      />
    )
  }
  return (
    <ErrorMessage
      label={error.message}
      action={onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>{t('athletes.daily.actions.retry')}</Button>
      ) : undefined}
    />
  )
}

/**
 * UI visibility only — the import, commit and undo APIs enforce `athletes.daily.import` on their
 * own. Wildcard-aware (`athletes.*`, `*`).
 */
export function useDailyPermissions(): { canImport: boolean; isLoading: boolean } {
  const [state, setState] = React.useState({ canImport: false, isLoading: true })
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const call = await apiCall<{ granted?: unknown[] }>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features: ['athletes.daily.import'] }),
        })
        if (cancelled) return
        const granted = Array.isArray(call.result?.granted) ? call.result.granted.map((value) => String(value)) : []
        setState({ canImport: call.ok && hasAllFeatures(['athletes.daily.import'], granted), isLoading: false })
      } catch {
        if (!cancelled) setState({ canImport: false, isLoading: false })
      }
    })()
    return () => { cancelled = true }
  }, [])
  return state
}

/**
 * File import is desktop-only (spec: "Wgraj plik na komputerze", analogous to D344): below
 * 1024 px (`lg`) a localized notice replaces it. CSS-only, so server and client render the same.
 */
export function DailyImportDesktopOnly({ children }: { children: React.ReactNode }) {
  const t = useT()
  return (
    <>
      <div className="lg:hidden">
        <EmptyState
          icon={<Monitor className="size-6" aria-hidden="true" />}
          title={t('athletes.daily.desktopOnly.title')}
          description={t('athletes.daily.desktopOnly.description')}
        />
      </div>
      <div className="hidden lg:block">{children}</div>
    </>
  )
}
