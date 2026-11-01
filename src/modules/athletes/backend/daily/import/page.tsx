import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import DailyImportPage from '../../../components/DailyImportPage'

export default function AthletesDailyImportPage() {
  return (
    <Page>
      <PageBody>
        {/* `useSearchParams` (`?kind=`) needs a Suspense boundary in the App Router. */}
        <React.Suspense fallback={null}>
          <DailyImportPage />
        </React.Suspense>
      </PageBody>
    </Page>
  )
}
