import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import TestResultsTable from '../../../components/TestResultsTable'

export default function AthletesTestViewPage({ params }: { params?: { definitionId?: string } }) {
  const definitionId = params?.definitionId
  if (!definitionId) return null

  return (
    <Page>
      <PageBody>
        <TestResultsTable definitionId={definitionId} />
      </PageBody>
    </Page>
  )
}
