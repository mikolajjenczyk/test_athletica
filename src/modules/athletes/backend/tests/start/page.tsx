import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import TestStartForm from '../../../components/TestStartForm'

export default function AthletesTestStartPage() {
  return (
    <Page>
      <PageBody>
        {/* `useSearchParams` (the preselected test) needs a Suspense boundary in the App Router. */}
        <React.Suspense fallback={null}>
          <TestStartForm />
        </React.Suspense>
      </PageBody>
    </Page>
  )
}
