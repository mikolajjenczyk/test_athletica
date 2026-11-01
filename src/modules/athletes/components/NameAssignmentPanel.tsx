"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { formatPersonName, useHideNames } from './PersonName'
import {
  SKIP_ASSIGNMENT,
  availablePlayersFor,
  type AssignablePlayer,
  type NameAssignments,
} from '../lib/dailyImportUi'

export type NameAssignmentPanelProps = {
  unknownNames: ReadonlyArray<{ name: string; rowCount: number }>
  players: ReadonlyArray<AssignablePlayer>
  assignments: NameAssignments
  onChange: (name: string, playerId: string | null) => void
  disabled?: boolean
  /** Moves focus to the first unassigned name once (after the first preview). */
  autoFocus?: boolean
}

/**
 * "Nazwiska bez dopasowania" (REQ-002): for each name of the file the roster could not match, a
 * select of team players not matched by name in this import and not chosen for another name
 * (each player once), plus "Pomiń" — the name's rows are then rejected.
 */
export function NameAssignmentPanel({ unknownNames, players, assignments, onChange, disabled, autoFocus }: NameAssignmentPanelProps) {
  const t = useT()
  const [hideNames] = useHideNames()
  const firstUnassignedRef = React.useRef<HTMLButtonElement | null>(null)
  const focusedRef = React.useRef(false)

  const firstUnassigned = unknownNames.find((entry) => !assignments[entry.name])?.name ?? null

  React.useEffect(() => {
    if (!autoFocus || focusedRef.current || !firstUnassignedRef.current) return
    focusedRef.current = true
    firstUnassignedRef.current.focus()
  }, [autoFocus, firstUnassigned])

  if (unknownNames.length === 0) return null

  const playerLabel = (player: AssignablePlayer) => formatPersonName(player.firstName, player.lastName, hideNames)

  return (
    <section aria-label={t('athletes.dailyImport.assign.title')} className="space-y-3 rounded-lg border border-border p-4">
      <SectionHeader title={t('athletes.dailyImport.assign.title')} count={unknownNames.length} />
      <p className="text-sm text-muted-foreground">{t('athletes.dailyImport.assign.description')}</p>
      <ul className="space-y-2">
        {unknownNames.map((entry) => {
          const options = availablePlayersFor(entry.name, players, assignments)
            .slice()
            .sort((a, b) => playerLabel(a).localeCompare(playerLabel(b)))
          const value = assignments[entry.name] ?? SKIP_ASSIGNMENT
          const label = t('athletes.dailyImport.assign.selectLabel', { name: entry.name })
          return (
            <li key={entry.name} className="flex flex-wrap items-center gap-3">
              <span className="min-w-0 flex-1 text-sm">
                <span className="font-medium" data-person-name="">„{entry.name}”</span>{' '}
                <span className="text-muted-foreground">
                  {t('athletes.dailyImport.assign.rowCount', { count: entry.rowCount })}
                </span>
              </span>
              <Select
                value={value}
                disabled={disabled}
                onValueChange={(next) => onChange(entry.name, next === SKIP_ASSIGNMENT ? null : next)}
              >
                <SelectTrigger
                  ref={entry.name === firstUnassigned ? firstUnassignedRef : undefined}
                  className="w-72"
                  aria-label={label}
                >
                  <SelectValue placeholder={t('athletes.dailyImport.assign.placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SKIP_ASSIGNMENT}>{t('athletes.dailyImport.assign.skip')}</SelectItem>
                  {options.map((player) => (
                    <SelectItem key={player.id} value={player.id}>{playerLabel(player)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </li>
          )
        })}
      </ul>
      {players.every((player) => player.matchedByName) ? (
        <p className="text-sm text-muted-foreground">{t('athletes.dailyImport.assign.noPlayersLeft')}</p>
      ) : null}
    </section>
  )
}

export default NameAssignmentPanel
