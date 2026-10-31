export const metadata = {
  requireAuth: true,
  requireFeatures: ['athletes.players.manage'],
  pageTitle: 'Dodaj zawodnika',
  pageTitleKey: 'athletes.players.create.title',
  pageGroup: 'Klub',
  pageGroupKey: 'athletes.club',
  pageOrder: 21,
  navHidden: true,
  icon: 'user-plus',
  breadcrumb: [
    { label: 'Zawodnicy', labelKey: 'athletes.players.page.title', href: '/backend/players' },
    { label: 'Dodaj zawodnika', labelKey: 'athletes.players.create.title' },
  ],
}
