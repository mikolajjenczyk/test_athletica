import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import ClubProfile from '../../components/ClubProfile'

export default async function AthletesClubProfilePage() {
  const { t } = await resolveTranslations()
  return (
    <Page>
      <PageHeader title={t('athletes.club.page.title')} description={t('athletes.club.page.description')} />
      <PageBody>
        <ClubProfile />
      </PageBody>
    </Page>
  )
}
