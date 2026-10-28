import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { ClubDeleteForm } from '../../../components/ClubDeleteForm'
import { AccountDesktopOnly } from '../../../components/AccountDesktopOnly'

export default async function AthletesClubDeletePage() {
  const { translate } = await resolveTranslations()
  return (
    <Page>
      <PageHeader
        title={translate('athletes.clubDelete.title', 'Usuń dane klubu')}
        description={translate('athletes.clubDelete.description', 'Zgrubne usunięcie danych klubu. Operator może je przywrócić.')}
      />
      <PageBody>
        <AccountDesktopOnly>
          <ClubDeleteForm />
        </AccountDesktopOnly>
      </PageBody>
    </Page>
  )
}
