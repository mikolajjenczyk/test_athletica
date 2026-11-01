export const metadata = {
  requireAuth: true,
  requireFeatures: ['athletes.tests.record'],
  pageTitle: 'Tryb boisko',
  pageTitleKey: 'athletes.tests.field.title',
  pageGroup: 'Drużyna',
  pageGroupKey: 'athletes.nav.team',
  navHidden: true,
  icon: 'timer',
  breadcrumb: [
    { label: 'Zestaw testów', labelKey: 'athletes.tests.catalog.title', href: '/backend/tests' },
    { label: 'Tryb boisko', labelKey: 'athletes.tests.field.title' },
  ],
}
