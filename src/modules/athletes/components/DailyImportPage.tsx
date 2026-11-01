"use client"

import * as React from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { FileSpreadsheet } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { Button } from '@open-mercato/ui/primitives/button'
import { ImportPreview } from './ImportPreview'
import { RpeImportDetails } from './RpeImportDetails'
import { DAILY_HREF, DailyImportDesktopOnly } from './DailyShared'
import { parseDailyImportKind } from '../lib/dailyImportUi'
import type { RpePreviewResponse } from '../lib/dailyImportView'
import type { ImportCommitBase } from './ImportPreview'

/** "Wgraj plik RPE" (J-001): `?kind=rpe` — the only kind of phase 1. */
export default function DailyImportPage() {
  const t = useT()
  const searchParams = useSearchParams()
  const kind = parseDailyImportKind(searchParams?.get('kind'))

  if (!kind) {
    return (
      <EmptyState
        icon={<FileSpreadsheet className="size-6" aria-hidden="true" />}
        title={t('athletes.dailyImport.errors.invalidKind')}
        actions={(
          <Button asChild variant="outline">
            <Link href={DAILY_HREF}>{t('athletes.dailyImport.actions.backToDaily')}</Link>
          </Button>
        )}
      />
    )
  }

  return (
    <DailyImportDesktopOnly>
      <ImportPreview<RpePreviewResponse, ImportCommitBase>
        kind={kind}
        title={t('athletes.dailyImport.page.titleRpe')}
        missingCountLabel={t('athletes.daily.rpeMissing')}
        backHref={DAILY_HREF}
        renderDetails={(preview) => <RpeImportDetails preview={preview} />}
      />
    </DailyImportDesktopOnly>
  )
}
