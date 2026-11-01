export const features = [
  { id: 'athletes.players.view', title: 'View team and players', module: 'athletes' },
  {
    id: 'athletes.players.manage',
    title: 'Manage players',
    module: 'athletes',
    dependsOn: ['athletes.players.view'],
  },
  {
    id: 'athletes.club.manage',
    title: 'Manage club profile, team, positions and accounts',
    module: 'athletes',
    dependsOn: ['athletes.players.view'],
  },
  { id: 'athletes.tests.view', title: 'View tests and results', module: 'athletes' },
  {
    id: 'athletes.tests.record',
    title: 'Run tests and record results (sees reasons)',
    module: 'athletes',
    dependsOn: ['athletes.tests.view'],
  },
  // E01: daily data (RPE). Coach and club admin only — the director has none (REQ-011).
  { id: 'athletes.daily.view', title: 'View daily data (training sessions, RPE, imports)', module: 'athletes' },
  {
    id: 'athletes.daily.import',
    title: 'Import daily-data files and undo the last import',
    module: 'athletes',
    dependsOn: ['athletes.daily.view'],
  },
]

export default features
