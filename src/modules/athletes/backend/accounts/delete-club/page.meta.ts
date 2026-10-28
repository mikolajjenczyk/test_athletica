export const metadata = {
  requireAuth: true,
  requireFeatures: ['athletes.club.manage'],
  pageTitle: 'Usuń dane klubu',
  pageTitleKey: 'athletes.clubDelete.title',
  pageGroup: 'Klub',
  pageGroupKey: 'athletes.club',
  navHidden: true,
  breadcrumb: [
    { label: 'Status konta', labelKey: 'athletes.nav.accounts', href: '/backend/accounts' },
    { label: 'Usuń dane klubu', labelKey: 'athletes.clubDelete.title' },
  ],
}
