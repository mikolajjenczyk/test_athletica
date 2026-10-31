"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

/**
 * "Ukryj nazwiska" (REQ-005, D184): a per-user, per-browser view preference, NOT a
 * security control — API responses are unchanged. Every screen of the athletes module
 * renders person names only through `PersonName` / `formatPersonName`, so one toggle covers all.
 */
const STORAGE_KEY_PREFIX = 'athletes.hideNames'
const CHANGE_EVENT = 'athletes:hide-names-changed'

// `PersonName` renders once per table row, so the user id is fetched once per page load
// (same `/api/auth/feature-check` hop as the shared `useCurrentUserId`) and reused.
let currentUserIdPromise: Promise<string> | null = null
function loadCurrentUserId(): Promise<string> {
  if (!currentUserIdPromise) {
    currentUserIdPromise = apiCall<{ userId?: string }>('/api/auth/feature-check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ features: [] }),
    })
      .then((res) => (res.ok && typeof res.result?.userId === 'string' ? res.result.userId : ''))
      .catch(() => '')
  }
  return currentUserIdPromise
}

function storageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}.${userId}`
}

function readHideNames(userId: string): boolean {
  if (!userId) return false
  try {
    return window.localStorage.getItem(storageKey(userId)) === '1'
  } catch {
    return false
  }
}

export function useHideNames(): [boolean, (next: boolean) => void] {
  // Server render and first client render agree on `false`; the stored value applies after mount.
  const [hidden, setHidden] = React.useState(false)
  const userIdRef = React.useRef('')
  React.useEffect(() => {
    let cancelled = false
    const sync = () => setHidden(readHideNames(userIdRef.current))
    void loadCurrentUserId().then((userId) => {
      if (cancelled) return
      userIdRef.current = userId
      sync()
    })
    window.addEventListener(CHANGE_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      cancelled = true
      window.removeEventListener(CHANGE_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])
  const update = React.useCallback((next: boolean) => {
    const userId = userIdRef.current
    if (userId) {
      try {
        window.localStorage.setItem(storageKey(userId), next ? '1' : '0')
      } catch {
        // Storage unavailable (private mode): keep the preference for this page only.
      }
    }
    setHidden(next)
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }, [])
  return [hidden, update]
}

/** Initials only when names are hidden ("Anna Nowak" → "A. N."). */
export function formatPersonName(firstName: string | null | undefined, lastName: string | null | undefined, hidden: boolean): string {
  const first = (firstName ?? '').trim()
  const last = (lastName ?? '').trim()
  if (!hidden) return `${first} ${last}`.trim()
  return [first, last].filter(Boolean).map((part) => `${part.charAt(0).toLocaleUpperCase()}.`).join(' ')
}

/** Splits a single display name (e.g. an `auth` user name) into first/last for formatting. */
export function formatDisplayName(name: string | null | undefined, hidden: boolean): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  return formatPersonName(parts.slice(0, -1).join(' ') || parts[0], parts.length > 1 ? parts[parts.length - 1] : '', hidden)
}

export function PersonName({ firstName, lastName }: { firstName?: string | null; lastName?: string | null }) {
  const [hidden] = useHideNames()
  return <span data-person-name="">{formatPersonName(firstName, lastName, hidden)}</span>
}

export function HideNamesToggle() {
  const t = useT()
  const [hidden, setHidden] = useHideNames()
  return (
    <SwitchField
      checked={hidden}
      onCheckedChange={setHidden}
      label={t('athletes.hideNames.label', 'Ukryj nazwiska')}
      description={t('athletes.hideNames.description', 'Tylko widok na tym urządzeniu — nie zmienia danych ani uprawnień.')}
    />
  )
}
