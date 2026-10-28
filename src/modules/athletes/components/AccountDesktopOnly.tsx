"use client"

import * as React from 'react'
import { Monitor } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'

/** Club admin screens are desktop-only (D344): below 1024 px show a notice instead. */
export function AccountDesktopOnly({ children }: { children: React.ReactNode }) {
  const t = useT()
  return (
    <>
      <div className="lg:hidden">
        <EmptyState
          icon={<Monitor className="size-6" aria-hidden="true" />}
          title={t('athletes.accounts.desktopOnly.title', 'Użyj komputera')}
          description={t(
            'athletes.accounts.desktopOnly.description',
            'Ekrany administratora klubu działają na ekranie o szerokości co najmniej 1024 px.',
          )}
        />
      </div>
      <div className="hidden lg:block">{children}</div>
    </>
  )
}
