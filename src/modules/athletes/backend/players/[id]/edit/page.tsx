import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ClubDesktopOnly } from '../../../../components/ClubShared'
import { PlayerEditForm } from '../../../../components/PlayerForm'

export default function AthletesEditPlayerPage({ params }: { params?: { id?: string } }) {
  const id = params?.id
  if (!id) return null

  return (
    <Page>
      <PageBody>
        <ClubDesktopOnly>
          <PlayerEditForm id={id} />
        </ClubDesktopOnly>
      </PageBody>
    </Page>
  )
}
