import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { AccountsTable } from '../../../components/AccountsTable'
import { AccountDesktopOnly } from '../../../components/AccountDesktopOnly'

export default function AthletesClubAccountsPage() {
  return (
    <Page>
      <PageBody>
        <AccountDesktopOnly>
          <AccountsTable />
        </AccountDesktopOnly>
      </PageBody>
    </Page>
  )
}
