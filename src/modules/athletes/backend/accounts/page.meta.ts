export const metadata = {
  requireAuth: true,
  requireFeatures: ['auth.users.list', 'athletes.club.manage'],
  pageTitle: 'Status konta',
  pageTitleKey: 'athletes.nav.accounts',
  pageGroup: 'Klub',
  pageGroupKey: 'athletes.club',
  pageOrder: 30,
  icon: 'user-check',
  breadcrumb: [
    { label: 'Status konta', labelKey: 'athletes.nav.accounts' },
  ],
}
