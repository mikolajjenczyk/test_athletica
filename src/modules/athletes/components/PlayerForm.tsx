"use client"

import * as React from 'react'
import Link from 'next/link'
import { Users } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CrudForm, type CrudField, type CrudFieldOption, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { createCrud, deleteCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { Button } from '@open-mercato/ui/primitives/button'
import { formatPersonName, useHideNames } from './PersonName'
import { CLUB_HREF, PLAYERS_HREF, PLAYER_ENTITY_ID, rethrowTranslated, translateAthletesError } from './ClubShared'
import type { PlayerListItem } from './PlayersTable'

type Translate = ReturnType<typeof useT>

export type PlayerFormValues = {
  id?: string
  teamId: string
  firstName: string
  lastName: string
  birthDate: string
  positionId?: string | null
  joinedAt: string
  isActive: boolean
  // CrudForm derives the expected-version header from this for update AND delete.
  updatedAt?: string | null
}

type OptionsResponse = { items: CrudFieldOption[] }

type PlayerOptions = { teams: CrudFieldOption[]; positions: CrudFieldOption[] }

function todayIso(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function usePlayerOptions(t: Translate) {
  const [options, setOptions] = React.useState<PlayerOptions | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => {
    let cancelled = false
    Promise.all([
      readApiResultOrThrow<OptionsResponse>('/api/athletes/options/teams?limit=200'),
      readApiResultOrThrow<OptionsResponse>('/api/athletes/options/positions?limit=200'),
    ])
      .then(([teams, positions]) => {
        if (!cancelled) setOptions({ teams: teams?.items ?? [], positions: positions?.items ?? [] })
      })
      .catch((err: unknown) => { if (!cancelled) setError(translateAthletesError(err, t, 'athletes.players.errors.options')) })
    return () => { cancelled = true }
  }, [t])
  return { options, error }
}

function usePlayerFields(t: Translate, options: PlayerOptions | null, namesLocked: boolean): CrudField[] {
  return React.useMemo<CrudField[]>(() => {
    const today = new Date()
    const nameHint = namesLocked ? t('athletes.players.form.namesHiddenHint') : undefined
    return [
      {
        id: 'firstName',
        label: t('athletes.players.form.firstName'),
        type: 'text',
        required: true,
        maxLength: 60,
        readOnly: namesLocked,
        description: nameHint,
      },
      {
        id: 'lastName',
        label: t('athletes.players.form.lastName'),
        type: 'text',
        required: true,
        maxLength: 60,
        readOnly: namesLocked,
        description: nameHint,
      },
      {
        id: 'birthDate',
        label: t('athletes.players.form.birthDate'),
        type: 'date',
        required: true,
        maxDate: today,
      },
      {
        id: 'teamId',
        label: t('athletes.players.form.team'),
        type: 'select',
        required: true,
        options: options?.teams ?? [],
        placeholder: t('athletes.players.form.teamPlaceholder'),
      },
      {
        id: 'positionId',
        label: t('athletes.players.form.position'),
        type: 'select',
        options: options?.positions ?? [],
        placeholder: t('athletes.players.form.positionPlaceholder'),
        description: t('athletes.players.form.positionHint'),
      },
      {
        id: 'joinedAt',
        label: t('athletes.players.form.joinedAt'),
        type: 'date',
        required: true,
        maxDate: today,
      },
      {
        id: 'isActive',
        label: t('athletes.players.form.isActive'),
        type: 'checkbox',
        description: t('athletes.players.form.isActiveHint'),
      },
    ]
  }, [namesLocked, options, t])
}

function usePlayerGroups(t: Translate): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    { id: 'person', title: t('athletes.players.form.groups.person'), column: 1, fields: ['firstName', 'lastName', 'birthDate'] },
    { id: 'club', title: t('athletes.players.form.groups.club'), column: 2, fields: ['teamId', 'positionId', 'joinedAt', 'isActive'] },
  ], [t])
}

function toPayload(values: PlayerFormValues, includeNames: boolean) {
  return {
    teamId: String(values.teamId ?? ''),
    ...(includeNames
      ? { firstName: String(values.firstName ?? '').trim(), lastName: String(values.lastName ?? '').trim() }
      : {}),
    birthDate: String(values.birthDate ?? ''),
    // An emptied select arrives as undefined/''; send an explicit null so the API clears it.
    positionId: typeof values.positionId === 'string' && values.positionId ? values.positionId : null,
    joinedAt: String(values.joinedAt ?? ''),
    isActive: values.isActive !== false,
  }
}

function NoTeamState() {
  const t = useT()
  return (
    <EmptyState
      icon={<Users className="size-6" aria-hidden="true" />}
      title={t('athletes.players.empty.noTeamTitle')}
      description={t('athletes.players.empty.noTeamDescription')}
      actions={(
        <Button asChild variant="outline">
          <Link href={CLUB_HREF}>{t('athletes.players.empty.goToClub')}</Link>
        </Button>
      )}
    />
  )
}

export function PlayerCreateForm() {
  const t = useT()
  const { options, error } = usePlayerOptions(t)
  const fields = usePlayerFields(t, options, false)
  const groups = usePlayerGroups(t)
  const successRedirect = React.useMemo(
    () => withFlash(PLAYERS_HREF, t('athletes.players.flash.created'), 'success'),
    [t],
  )
  const initialValues = React.useMemo<Partial<PlayerFormValues>>(() => ({
    teamId: options?.teams.length === 1 ? options.teams[0].value : '',
    firstName: '',
    lastName: '',
    birthDate: '',
    positionId: null,
    joinedAt: todayIso(),
    isActive: true,
  }), [options])

  if (error) return <ErrorMessage label={t('athletes.players.errors.options')} description={error} />
  if (!options) return <LoadingMessage label={t('athletes.players.form.loading')} />
  if (options.teams.length === 0) return <NoTeamState />

  return (
    <CrudForm<PlayerFormValues>
      title={t('athletes.players.create.title')}
      titleHeadingLevel={1}
      backHref={PLAYERS_HREF}
      entityId={PLAYER_ENTITY_ID}
      injectionSpotId="crud-form:athletes.athletes_player"
      fields={fields}
      groups={groups}
      initialValues={initialValues}
      submitLabel={t('athletes.players.create.submit')}
      cancelHref={PLAYERS_HREF}
      successRedirect={successRedirect}
      onSubmit={async (values) => {
        try {
          await createCrud('athletes/players', toPayload(values, true))
        } catch (err) {
          rethrowTranslated(err, t, 'athletes.players.errors.save')
        }
      }}
    />
  )
}

export function PlayerEditForm({ id }: { id: string }) {
  const t = useT()
  const [hideNames] = useHideNames()
  const { options, error: optionsError } = usePlayerOptions(t)
  const [record, setRecord] = React.useState<PlayerListItem | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [err, setErr] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)
  // REQ-005: with "Ukryj nazwiska" on, names stay masked and read-only; saving keeps the stored names.
  const fields = usePlayerFields(t, options, hideNames)
  const groups = usePlayerGroups(t)
  const successRedirect = React.useMemo(
    () => withFlash(PLAYERS_HREF, t('athletes.players.flash.saved'), 'success'),
    [t],
  )
  const deleteRedirect = React.useMemo(
    () => withFlash(PLAYERS_HREF, t('athletes.players.flash.deleted'), 'success'),
    [t],
  )

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setErr(null)
      setIsNotFound(false)
      try {
        const data = await fetchCrudList<PlayerListItem>('athletes/players', { ids: String(id), pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) {
          if (!cancelled) setIsNotFound(true)
          return
        }
        if (!cancelled) setRecord(item)
      } catch (error: unknown) {
        if (cancelled) return
        if ((error as { status?: number }).status === 404) setIsNotFound(true)
        else setErr(translateAthletesError(error, t, 'athletes.players.errors.load'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [id, t])

  const initialValues = React.useMemo<Partial<PlayerFormValues>>(() => {
    if (!record) return { id, updatedAt: null }
    return {
      id: record.id,
      teamId: record.teamId,
      firstName: hideNames ? formatPersonName(record.firstName, null, true) : record.firstName,
      lastName: hideNames ? formatPersonName(null, record.lastName, true) : record.lastName,
      birthDate: record.birthDate,
      positionId: record.positionId,
      joinedAt: record.joinedAt,
      isActive: record.isActive,
      updatedAt: record.updatedAt,
    }
  }, [hideNames, id, record])

  if (isNotFound) {
    return (
      <RecordNotFoundState
        label={t('athletes.players.errors.notFound')}
        backHref={PLAYERS_HREF}
        backLabel={t('athletes.players.actions.backToList')}
      />
    )
  }
  if (err) return <ErrorMessage label={err} />
  if (optionsError) return <ErrorMessage label={t('athletes.players.errors.options')} description={optionsError} />

  return (
    <CrudForm<PlayerFormValues>
      title={t('athletes.players.edit.title')}
      titleHeadingLevel={1}
      backHref={PLAYERS_HREF}
      entityId={PLAYER_ENTITY_ID}
      injectionSpotId="crud-form:athletes.athletes_player"
      fields={fields}
      groups={groups}
      initialValues={initialValues}
      submitLabel={t('athletes.players.edit.submit')}
      cancelHref={PLAYERS_HREF}
      successRedirect={successRedirect}
      deleteRedirect={deleteRedirect}
      isLoading={loading || !options}
      loadingMessage={t('athletes.players.form.loading')}
      onSubmit={async (values) => {
        try {
          await updateCrud('athletes/players', { id, ...toPayload(values, !hideNames) })
        } catch (error) {
          rethrowTranslated(error, t, 'athletes.players.errors.save')
        }
      }}
      onDelete={async () => {
        try {
          await deleteCrud('athletes/players', { id, body: { id } })
        } catch (error) {
          rethrowTranslated(error, t, 'athletes.players.errors.delete')
        }
      }}
    />
  )
}
