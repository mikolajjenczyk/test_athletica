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
]

export default features
