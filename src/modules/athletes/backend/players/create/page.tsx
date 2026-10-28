import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ClubDesktopOnly } from '../../../components/ClubShared'
import { PlayerCreateForm } from '../../../components/PlayerForm'

export default function AthletesCreatePlayerPage() {
  return (
    <Page>
      <PageBody>
        <ClubDesktopOnly>
          <PlayerCreateForm />
        </ClubDesktopOnly>
      </PageBody>
    </Page>
  )
}
