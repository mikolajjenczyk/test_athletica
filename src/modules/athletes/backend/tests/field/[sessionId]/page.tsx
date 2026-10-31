import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import FieldMode from '../../../../components/FieldMode'

export default function AthletesTestFieldPage({ params }: { params?: { sessionId?: string } }) {
  const sessionId = params?.sessionId
  if (!sessionId) return null

  return (
    <Page>
      <PageBody>
        <FieldMode sessionId={sessionId} />
      </PageBody>
    </Page>
  )
}
