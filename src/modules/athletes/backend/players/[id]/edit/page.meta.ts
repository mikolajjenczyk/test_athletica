export const metadata = {
  requireAuth: true,
  requireFeatures: ['athletes.players.manage'],
  pageTitle: 'Edytuj zawodnika',
  pageTitleKey: 'athletes.players.edit.title',
  pageGroup: 'Klub',
  pageGroupKey: 'athletes.club',
  navHidden: true,
  icon: 'pen-line',
  breadcrumb: [
    { label: 'Zawodnicy', labelKey: 'athletes.players.page.title', href: '/backend/players' },
    { label: 'Edytuj zawodnika', labelKey: 'athletes.players.edit.title' },
  ],
}
