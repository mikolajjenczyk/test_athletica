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
]

export default features
