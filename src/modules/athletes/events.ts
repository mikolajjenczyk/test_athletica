import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Payloads carry ids and scope only — never player names or birth dates.
 */
const events = [
  { id: 'athletes.team.created', label: 'Team Created', entity: 'team', category: 'crud' },
  { id: 'athletes.team.updated', label: 'Team Updated', entity: 'team', category: 'crud' },
  { id: 'athletes.team.deleted', label: 'Team Deleted', entity: 'team', category: 'crud' },
  { id: 'athletes.position.created', label: 'Position Created', entity: 'position', category: 'crud' },
  { id: 'athletes.position.updated', label: 'Position Updated', entity: 'position', category: 'crud' },
  { id: 'athletes.position.deleted', label: 'Position Deleted', entity: 'position', category: 'crud' },
  { id: 'athletes.player.created', label: 'Player Created', entity: 'player', category: 'crud' },
  { id: 'athletes.player.updated', label: 'Player Updated', entity: 'player', category: 'crud' },
  { id: 'athletes.player.deleted', label: 'Player Deleted', entity: 'player', category: 'crud' },
  { id: 'athletes.club.soft_deleted', label: 'Club Data Deleted', entity: 'club', category: 'lifecycle' },
  // E02: ids and scope only — never reasons, values or player names.
  { id: 'athletes.test_session.started', label: 'Test Session Started', entity: 'test_session', category: 'lifecycle' },
  { id: 'athletes.test_session.finished', label: 'Test Session Finished', entity: 'test_session', category: 'lifecycle' },
  { id: 'athletes.test_result.recorded', label: 'Test Result Recorded', entity: 'test_result', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'athletes',
  events,
})

export const emitAthletesEvent = eventsConfig.emit

export type AthletesEventId = typeof events[number]['id']

export default eventsConfig
