export const metadata = {
  requireAuth: true,
  requireFeatures: ['athletes.tests.view'],
  pageTitle: 'Widok testu',
  pageTitleKey: 'athletes.tests.view.title',
  pageGroup: 'Drużyna',
  pageGroupKey: 'athletes.nav.team',
  navHidden: true,
  icon: 'activity',
  breadcrumb: [
    { label: 'Zestaw testów', labelKey: 'athletes.tests.catalog.title', href: '/backend/tests' },
    { label: 'Widok testu', labelKey: 'athletes.tests.view.title' },
  ],
}
