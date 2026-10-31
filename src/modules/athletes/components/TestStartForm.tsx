"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ClipboardList } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CrudForm, type CrudField, type CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { createCrud, fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { Button } from '@open-mercato/ui/primitives/button'
import { formatPersonName, useHideNames } from './PersonName'
import { rethrowTranslated } from './ClubShared'
import {
  TESTS_HREF,
  TestsLoadErrorMessage,
  testFieldHref,
  toTestsLoadError,
  type TestsLoadError,
} from './TestsShared'
import { todayIsoDate } from '../lib/testUi'
import type { PlayerListItem } from './PlayersTable'

const TEST_SESSION_ENTITY_ID = 'athletes:athletes_test_session'

type StartFormValues = {
  testDefinitionId: string
  kind: 'team' | 'individual'
  teamId?: string
  playerId?: string
  testedOn: string
}

type StartOptions = { tests: CrudFieldOption[]; teams: CrudFieldOption[]; players: PlayerListItem[] }

type OptionsResponse = { items: CrudFieldOption[] }

type StartResponse = { id: string; reused: boolean; status: 'open' | 'finished'; testedOn: string; updatedAt: string | null }

async function fetchActivePlayers(): Promise<PlayerListItem[]> {
  const data = await fetchCrudList<PlayerListItem>('athletes/players', {
    page: 1,
    pageSize: 100,
    isActive: 'true',
    sortField: 'joinedAt',
    sortDir: 'asc',
  })
  return data.items ?? []
}

/** "Rozpocznij test" (REQ-002): only the test, the team or one player, and the date. */
export default function TestStartForm() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const presetTestId = searchParams?.get('testDefinitionId') ?? ''
  const [hideNames] = useHideNames()
  const [options, setOptions] = React.useState<StartOptions | null>(null)
  const [error, setError] = React.useState<TestsLoadError | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    setError(null)
    Promise.all([
      readApiResultOrThrow<OptionsResponse>('/api/athletes/options/tests?activeOnly=true&limit=200'),
      readApiResultOrThrow<OptionsResponse>('/api/athletes/options/teams?limit=200'),
      fetchActivePlayers(),
    ])
      .then(([tests, teams, players]) => {
        if (!cancelled) setOptions({ tests: tests?.items ?? [], teams: teams?.items ?? [], players })
      })
      .catch((err: unknown) => { if (!cancelled) setError(toTestsLoadError(err, t, 'athletes.tests.errors.loadOptions')) })
    return () => { cancelled = true }
  }, [reloadToken, t])

  const playerOptions = React.useMemo<CrudFieldOption[]>(() => (options?.players ?? [])
    .map((player) => ({ value: player.id, label: formatPersonName(player.firstName, player.lastName, hideNames) }))
    .sort((a, b) => a.label.localeCompare(b.label)), [hideNames, options])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'testDefinitionId',
      label: t('athletes.tests.start.fields.test'),
      type: 'select',
      required: true,
      options: options?.tests ?? [],
      placeholder: t('athletes.tests.start.fields.testPlaceholder'),
    },
    {
      id: 'kind',
      label: t('athletes.tests.start.fields.kind'),
      type: 'select',
      required: true,
      options: [
        { value: 'team', label: t('athletes.tests.start.kind.team') },
        { value: 'individual', label: t('athletes.tests.start.kind.individual') },
      ],
    },
    {
      id: 'teamId',
      label: t('athletes.tests.start.fields.team'),
      type: 'select',
      required: true,
      options: options?.teams ?? [],
      placeholder: t('athletes.tests.start.fields.teamPlaceholder'),
      visibleWhen: { field: 'kind', equals: 'team' },
    },
    {
      id: 'playerId',
      label: t('athletes.tests.start.fields.player'),
      type: 'select',
      required: true,
      options: playerOptions,
      placeholder: t('athletes.tests.start.fields.playerPlaceholder'),
      visibleWhen: { field: 'kind', equals: 'individual' },
    },
    {
      id: 'testedOn',
      label: t('athletes.tests.start.fields.testedOn'),
      type: 'date',
      required: true,
      maxDate: new Date(),
      description: t('athletes.tests.start.fields.testedOnHint'),
    },
  ], [options, playerOptions, t])

  const initialValues = React.useMemo<Partial<StartFormValues>>(() => {
    const tests = options?.tests ?? []
    const teams = options?.teams ?? []
    return {
      testDefinitionId: tests.some((test) => test.value === presetTestId) ? presetTestId : tests.length === 1 ? tests[0].value : '',
      kind: 'team',
      teamId: teams.length === 1 ? teams[0].value : '',
      playerId: '',
      testedOn: todayIsoDate(),
    }
  }, [options, presetTestId])

  if (error) return <TestsLoadErrorMessage error={error} onRetry={() => setReloadToken((value) => value + 1)} />
  if (!options) return <LoadingMessage label={t('athletes.tests.start.loading')} />
  if (options.tests.length === 0) {
    return (
      <EmptyState
        icon={<ClipboardList className="size-6" aria-hidden="true" />}
        title={t('athletes.tests.start.noActiveTests.title')}
        description={t('athletes.tests.start.noActiveTests.description')}
        actions={(
          <Button asChild variant="outline">
            <Link href={TESTS_HREF}>{t('athletes.tests.actions.backToCatalog')}</Link>
          </Button>
        )}
      />
    )
  }

  return (
    <CrudForm<StartFormValues>
      title={t('athletes.tests.start.title')}
      titleHeadingLevel={1}
      backHref={TESTS_HREF}
      entityId={TEST_SESSION_ENTITY_ID}
      injectionSpotId="crud-form:athletes.athletes_test_session"
      fields={fields}
      initialValues={initialValues}
      submitLabel={t('athletes.tests.start.submit')}
      cancelHref={TESTS_HREF}
      onSubmit={async (values) => {
        const kind = values.kind === 'individual' ? 'individual' : 'team'
        let created: StartResponse | null = null
        try {
          const call = await createCrud<StartResponse>('athletes/test-sessions', {
            testDefinitionId: String(values.testDefinitionId ?? ''),
            kind,
            ...(kind === 'team' ? { teamId: String(values.teamId ?? '') } : { playerId: String(values.playerId ?? '') }),
            testedOn: String(values.testedOn ?? ''),
          })
          created = call.result
        } catch (err) {
          rethrowTranslated(err, t, 'athletes.tests.errors.start')
        }
        if (!created?.id) throw new Error(t('athletes.tests.errors.start'))
        const message = created.reused ? t('athletes.tests.start.flash.reused') : t('athletes.tests.start.flash.started')
        router.push(withFlash(testFieldHref(created.id), message, created.reused ? 'info' : 'success'))
      }}
    />
  )
}
