export const metadata = {
  requireAuth: true,
  requireFeatures: ['athletes.tests.record'],
  pageTitle: 'Rozpocznij test',
  pageTitleKey: 'athletes.tests.start.title',
  pageGroup: 'Drużyna',
  pageGroupKey: 'athletes.nav.team',
  pageOrder: 31,
  navHidden: true,
  icon: 'flag',
  breadcrumb: [
    { label: 'Zestaw testów', labelKey: 'athletes.tests.catalog.title', href: '/backend/tests' },
    { label: 'Rozpocznij test', labelKey: 'athletes.tests.start.title' },
  ],
}
