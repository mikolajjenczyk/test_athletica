export const metadata = {
  requireAuth: true,
  requireFeatures: ['athletes.daily.import'],
  pageTitle: 'Wgraj plik RPE',
  pageTitleKey: 'athletes.dailyImport.page.titleRpe',
  pageGroup: 'Drużyna',
  pageGroupKey: 'athletes.nav.team',
  pageOrder: 21,
  navHidden: true,
  icon: 'file-spreadsheet',
  breadcrumb: [
    { label: 'Dane dzienne', labelKey: 'athletes.daily.page.title', href: '/backend/daily' },
    { label: 'Wgraj plik RPE', labelKey: 'athletes.dailyImport.page.titleRpe' },
  ],
}
