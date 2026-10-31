"use client"

import * as React from 'react'
import { Monitor } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader, extractOptimisticLockConflict } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'

/** Stable host IDs (colon form) for the athletes CRUD surfaces. Mirrors the module's entity IDs. */
export const TEAM_ENTITY_ID = 'athletes:athletes_team'
export const POSITION_ENTITY_ID = 'athletes:athletes_position'
export const PLAYER_ENTITY_ID = 'athletes:athletes_player'

export const CLUB_HREF = '/backend/club'
export const PLAYERS_HREF = '/backend/players'

type Translate = ReturnType<typeof useT>

const MANAGE_FEATURES = ['athletes.club.manage', 'athletes.players.manage'] as const

export type AthletesPermissions = {
  canManageClub: boolean
  canManagePlayers: boolean
  isLoading: boolean
}

/**
 * UI visibility only: the API enforces every feature on its own. Uses the wildcard-aware
 * matcher so `athletes.*` and `*` grants show the actions too.
 */
export function useAthletesPermissions(): AthletesPermissions {
  const [state, setState] = React.useState<AthletesPermissions>({
    canManageClub: false,
    canManagePlayers: false,
    isLoading: true,
  })
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const call = await apiCall<{ granted?: unknown[] }>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features: MANAGE_FEATURES }),
        })
        if (cancelled) return
        const granted = Array.isArray(call.result?.granted) ? call.result.granted.map((value) => String(value)) : []
        setState({
          canManageClub: call.ok && hasAllFeatures(['athletes.club.manage'], granted),
          canManagePlayers: call.ok && hasAllFeatures(['athletes.players.manage'], granted),
          isLoading: false,
        })
      } catch {
        if (!cancelled) setState({ canManageClub: false, canManagePlayers: false, isLoading: false })
      }
    })()
    return () => { cancelled = true }
  }, [])
  return state
}

/**
 * Domain errors arrive as `{ error: 'athletes.errors.*' }`; the CRUD helpers put that key in
 * `error.message`. Translate it in place so CrudForm, flashes and inline errors show copy, not keys.
 */
export function translateAthletesError(err: unknown, t: Translate, fallbackKey: string): string {
  const raw = err instanceof Error && typeof err.message === 'string' ? err.message.trim() : ''
  if (raw && /^athletes\.(errors|validation)\.[A-Za-z0-9_.]+$/.test(raw)) return t(raw)
  if (raw && !raw.startsWith('Failed to') && !raw.startsWith('Request failed')) return raw
  return t(fallbackKey)
}

/** Rethrows a CRUD error with a translated message, keeping status/code/body for conflict handling. */
export function rethrowTranslated(err: unknown, t: Translate, fallbackKey: string): never {
  if (err instanceof Error) {
    err.message = translateAthletesError(err, t, fallbackKey)
    throw err
  }
  throw new Error(t(fallbackKey))
}

/**
 * Club administration is desktop-only (spec D344): below 1024 px (`lg`) the forms are replaced by
 * a localized notice. CSS-only, so server and client render the same markup.
 */
export function ClubDesktopOnly({ children }: { children: React.ReactNode }) {
  const t = useT()
  return (
    <>
      <div className="lg:hidden">
        <EmptyState
          icon={<Monitor className="size-6" aria-hidden="true" />}
          title={t('athletes.club.desktopOnly.title')}
          description={t('athletes.club.desktopOnly.description')}
        />
      </div>
      <div className="hidden lg:block space-y-6">{children}</div>
    </>
  )
}

type DeletableRow = { id: string; updatedAt: string | null }

export type ClubRowDeleteOptions = {
  /** CRUD helper path without the `/api/` prefix, e.g. `athletes/positions`. */
  apiPath: string
  confirmTitle: string
  confirmText?: string
  successMessage: string
  errorFallbackKey: string
  /** Called after success and after a conflict (to reload the stale row). */
  onSettled: () => void
}

/**
 * Row-level delete for non-`CrudForm` hosts: destructive confirmation, the row's own
 * optimistic-lock version, guarded mutation (shared conflict bar on a stale 409) and a
 * translated flash for domain 409s such as `athletes.errors.positionInUse`.
 */
export function useClubRowDelete(contextId: string) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation } = useGuardedMutation<{ formId: string; resourceId: string }>({ contextId })
  const pendingRef = React.useRef<Set<string>>(new Set())

  const deleteRow = React.useCallback(async (row: DeletableRow, options: ClubRowDeleteOptions) => {
    if (pendingRef.current.has(row.id)) return
    const confirmed = await confirm({
      title: options.confirmTitle,
      text: options.confirmText,
      confirmText: t('athletes.club.actions.delete'),
      variant: 'destructive',
    })
    if (!confirmed) return
    pendingRef.current.add(row.id)
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(row.updatedAt),
          () => deleteCrud(options.apiPath, { id: row.id, body: { id: row.id } }),
        ),
        context: { formId: contextId, resourceId: row.id },
        mutationPayload: { id: row.id },
      })
      flash(options.successMessage, 'success')
      options.onSettled()
    } catch (err) {
      // A stale-version 409 is already on the shared conflict bar (useGuardedMutation).
      if (extractOptimisticLockConflict(err)) {
        options.onSettled()
        return
      }
      flash(translateAthletesError(err, t, options.errorFallbackKey), 'error')
    } finally {
      pendingRef.current.delete(row.id)
    }
  }, [confirm, contextId, runMutation, t])

  return { deleteRow, ConfirmDialogElement }
}
