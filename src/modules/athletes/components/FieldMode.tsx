"use client"

import * as React from 'react'
import Link from 'next/link'
import { ArrowRight, ChevronLeft, ChevronRight, CircleCheck, Delete, Flag, WifiOff } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { formatDisplayDate } from '@open-mercato/ui/primitives/date-format'
import { PersonName, formatPersonName, useHideNames } from './PersonName'
import {
  TESTS_HREF,
  TestsLoadErrorMessage,
  fetchTestDefinitions,
  testViewHref,
  toTestsLoadError,
  type TestsLoadError,
} from './TestsShared'
import {
  TEST_REASON_CODES,
  applyKeypadKey,
  buildRecordBody,
  buildRoster,
  countSaved,
  createIdempotencyKey,
  decimalSeparator,
  describeTestResult,
  emptyFieldEntry,
  formatTestName,
  formatTestValue,
  isFieldEntryEmpty,
  nextPlayerWithMissing,
  reasonLabelKey,
  recordFingerprint,
  sanitizeTrialText,
  type FieldEntry,
  type RosterPlayer,
  type TestDefinitionListItem,
  type TestReasonCode,
  type TestResultListItem,
  type TestSessionListItem,
} from '../lib/testUi'

type Translate = ReturnType<typeof useT>

type FieldData = {
  session: TestSessionListItem
  definition: TestDefinitionListItem
  roster: RosterPlayer[]
}

type FinishSummary = {
  recorded: number
  notPerformed: number
  empty: number
  invalidAttempt: number
  joinedLater: number
  playersTotal: number
}

type FinishResponse = {
  ok: boolean
  id: string
  status: 'open' | 'finished'
  alreadyFinished: boolean
  summary: FinishSummary
}

type RecordResponse = { ok: boolean; replayed: boolean; result: TestResultListItem }

type ApiErrorBody = { error?: string; issues?: Array<{ message?: string }> }

/** Shown when the connection is lost: who was being entered when it happened (if anyone). */
type ConnectionLoss = { unsavedPlayerId: string | null }

const KEYPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'separator', '0', 'backspace'] as const

const PAGE_SIZE = 100
const MAX_PAGES = 10

async function fetchSession(sessionId: string): Promise<TestSessionListItem | null> {
  const data = await fetchCrudList<TestSessionListItem>('athletes/test-sessions', { id: sessionId, page: 1, pageSize: 1 })
  return data.items?.[0] ?? null
}

async function fetchSessionPlayers(session: TestSessionListItem): Promise<RosterPlayer[]> {
  if (session.kind === 'individual') {
    if (!session.playerId) return []
    const data = await fetchCrudList<RosterPlayer>('athletes/players', { ids: session.playerId, page: 1, pageSize: 1 })
    return data.items ?? []
  }
  const items: RosterPlayer[] = []
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const data = await fetchCrudList<RosterPlayer>('athletes/players', {
      page,
      pageSize: PAGE_SIZE,
      teamId: session.teamId ?? undefined,
      isActive: 'true',
      sortField: 'joinedAt',
      sortDir: 'asc',
    })
    items.push(...(data.items ?? []))
    if (page >= (data.totalPages ?? 1)) break
  }
  return items
}

async function fetchSessionResults(sessionId: string): Promise<TestResultListItem[]> {
  const data = await readApiResultOrThrow<{ items: TestResultListItem[] }>(
    `/api/athletes/test-results?sessionId=${encodeURIComponent(sessionId)}&limit=500`,
  )
  return data?.items ?? []
}

function translateApiError(body: ApiErrorBody | null, t: Translate, fallbackKey: string): string {
  const candidates = [body?.error, ...(body?.issues ?? []).map((issue) => issue.message)]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && /^athletes\.(errors|validation)\.[A-Za-z0-9_.]+$/.test(candidate)) return t(candidate)
  }
  return t(fallbackKey)
}

/** A thrown `fetch` (no HTTP answer at all) means the connection is gone. */
function isNetworkFailure(err: unknown): boolean {
  if (err instanceof TypeError) return true
  const name = (err as { name?: string } | null)?.name
  return name === 'NetworkError'
}

function describeResult(result: TestResultListItem, unit: string, locale: string, t: Translate): string {
  const described = describeTestResult(result, unit, locale)
  if (described.text !== null) return described.text
  const label = t(described.stateKey ?? 'athletes.tests.state.empty')
  return described.reasonKey ? `${label}: ${t(described.reasonKey)}` : label
}

/**
 * "Tryb boisko" (REQ-003…REQ-006, approved exception in the spec): a one-thumb entry screen
 * built from design-system buttons, inputs and tokens. "Dalej" saves one player with ONE
 * record call (client idempotency key, reused on retry). Online only: a lost connection blocks
 * the keypad and every button; the unsaved trials are dropped, never queued.
 */
export default function FieldMode({ sessionId }: { sessionId: string }) {
  const t = useT()
  const locale = useLocale()
  const [hideNames] = useHideNames()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation } = useGuardedMutation<{ formId: string; resourceId: string }>({ contextId: 'athletes-tests-field' })
  const separator = React.useMemo(() => decimalSeparator(locale), [locale])

  const [data, setData] = React.useState<FieldData | null>(null)
  const [results, setResults] = React.useState<Map<string, TestResultListItem>>(() => new Map())
  const [loadError, setLoadError] = React.useState<TestsLoadError | null>(null)
  const [notFound, setNotFound] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)

  const [currentId, setCurrentId] = React.useState<string | null>(null)
  const [entry, setEntry] = React.useState<FieldEntry>(() => emptyFieldEntry(1))
  const [activeAttempt, setActiveAttempt] = React.useState(0)
  const [reasonsOpen, setReasonsOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [finishing, setFinishing] = React.useState(false)
  const [entryError, setEntryError] = React.useState<string | null>(null)
  const [conflict, setConflict] = React.useState<string | null>(null)
  const [online, setOnline] = React.useState(true)
  const [connectionLoss, setConnectionLoss] = React.useState<ConnectionLoss | null>(null)
  const [checkingConnection, setCheckingConnection] = React.useState(false)
  const [announcement, setAnnouncement] = React.useState('')
  const [summary, setSummary] = React.useState<FinishResponse | null>(null)

  const keyCacheRef = React.useRef<Map<string, { fingerprint: string; key: string }>>(new Map())
  const inputRefs = React.useRef<Array<HTMLInputElement | null>>([])
  const entryRef = React.useRef(entry)
  entryRef.current = entry
  const currentIdRef = React.useRef(currentId)
  currentIdRef.current = currentId

  const attempts = Math.max(1, data?.definition.attempts ?? 1)
  const rosterIds = React.useMemo(() => (data?.roster ?? []).map((player) => player.id), [data])
  const savedIds = React.useMemo(() => new Set(results.keys()), [results])
  const savedCount = countSaved(rosterIds, savedIds)
  const totalCount = rosterIds.length
  const playersById = React.useMemo(() => new Map((data?.roster ?? []).map((player) => [player.id, player])), [data])

  const nameOf = React.useCallback((playerId: string | null): string => {
    const player = playerId ? playersById.get(playerId) : undefined
    return player ? formatPersonName(player.firstName, player.lastName, hideNames) : ''
  }, [hideNames, playersById])

  // --- Loading -------------------------------------------------------------
  React.useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setLoadError(null)
    setNotFound(false)
    void (async () => {
      try {
        const session = await fetchSession(sessionId)
        if (!session) {
          if (!cancelled) setNotFound(true)
          return
        }
        const [definitions, players, resultItems] = await Promise.all([
          fetchTestDefinitions({ id: session.testDefinitionId }),
          fetchSessionPlayers(session),
          fetchSessionResults(session.id),
        ])
        const definition = definitions[0]
        if (!definition) {
          if (!cancelled) setNotFound(true)
          return
        }
        if (cancelled) return
        const roster = buildRoster(players, session)
        const resultMap = new Map(resultItems.map((item) => [item.playerId, item]))
        setData({ session, definition, roster })
        setResults(resultMap)
        setConflict(null)
        const ids = roster.map((player) => player.id)
        setCurrentId((previous) => {
          if (previous && ids.includes(previous)) return previous
          return nextPlayerWithMissing(ids, new Set(resultMap.keys()), null) ?? ids[0] ?? null
        })
        setEntry(emptyFieldEntry(definition.attempts))
        setActiveAttempt(0)
      } catch (err) {
        if (cancelled) return
        if ((err as { status?: number }).status === 404) setNotFound(true)
        else setLoadError(toTestsLoadError(err, t, 'athletes.tests.errors.loadField'))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [reloadToken, sessionId, t])

  // --- Connection ----------------------------------------------------------
  const markConnectionLost = React.useCallback(() => {
    const playerId = currentIdRef.current
    const hadUnsaved = !isFieldEntryEmpty(entryRef.current)
    setConnectionLoss({ unsavedPlayerId: hadUnsaved ? playerId : null })
    // No offline mode (REQ-005): the trials that were not saved are dropped, not queued.
    setEntry((current) => emptyFieldEntry(current.values.length))
    setActiveAttempt(0)
    setReasonsOpen(false)
  }, [])

  const refreshResults = React.useCallback(async (): Promise<boolean> => {
    if (!data) return false
    try {
      const items = await fetchSessionResults(data.session.id)
      setResults(new Map(items.map((item) => [item.playerId, item])))
      return true
    } catch {
      return false
    }
  }, [data])
  const refreshResultsRef = React.useRef(refreshResults)
  refreshResultsRef.current = refreshResults

  React.useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setOnline(false)
      setConnectionLoss({ unsavedPlayerId: null })
    }
    const handleOffline = () => {
      setOnline(false)
      markConnectionLost()
    }
    const handleOnline = () => {
      setOnline(true)
      setConnectionLoss(null)
      setAnnouncement(t('athletes.tests.field.connection.restored'))
      // A lost answer may still have saved a player: re-read what the server has.
      void refreshResultsRef.current()
    }
    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    return () => {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  }, [markConnectionLost, t])

  const checkConnection = React.useCallback(async () => {
    setCheckingConnection(true)
    const ok = await refreshResults()
    setCheckingConnection(false)
    if (ok) {
      setOnline(true)
      setConnectionLoss(null)
      setAnnouncement(t('athletes.tests.field.connection.restored'))
    }
  }, [refreshResults, t])

  // --- Entry editing -------------------------------------------------------
  const sessionFinished = data?.session.status === 'finished' || summary !== null
  const blocked = !online || connectionLoss !== null || conflict !== null || sessionFinished
  const busy = saving || finishing
  const inputsDisabled = blocked || busy || entry.reason !== null

  const resetEntry = React.useCallback(() => {
    setEntry(emptyFieldEntry(attempts))
    setActiveAttempt(0)
    setReasonsOpen(false)
    setEntryError(null)
  }, [attempts])

  const focusAttempt = React.useCallback((index: number) => {
    setActiveAttempt(index)
    window.requestAnimationFrame(() => inputRefs.current[index]?.focus())
  }, [])

  const setAttemptText = React.useCallback((index: number, text: string) => {
    setEntryError(null)
    setEntry((current) => {
      const values = [...current.values]
      values[index] = sanitizeTrialText(text, separator)
      const invalid = [...current.invalid]
      invalid[index] = false
      return { ...current, values, invalid }
    })
  }, [separator])

  const pressKey = React.useCallback((key: string) => {
    if (inputsDisabled) return
    setEntryError(null)
    setEntry((current) => {
      const values = [...current.values]
      const invalid = [...current.invalid]
      values[activeAttempt] = applyKeypadKey(current.values[activeAttempt] ?? '', key, separator)
      invalid[activeAttempt] = false
      return { ...current, values, invalid }
    })
  }, [activeAttempt, inputsDisabled, separator])

  const toggleInvalidAttempt = React.useCallback(() => {
    if (inputsDisabled) return
    setEntryError(null)
    setEntry((current) => {
      const invalid = [...current.invalid]
      const values = [...current.values]
      invalid[activeAttempt] = !invalid[activeAttempt]
      if (invalid[activeAttempt]) values[activeAttempt] = ''
      return { ...current, values, invalid }
    })
    if (activeAttempt < attempts - 1) focusAttempt(activeAttempt + 1)
  }, [activeAttempt, attempts, focusAttempt, inputsDisabled])

  const chooseReason = React.useCallback((reason: TestReasonCode) => {
    setEntryError(null)
    setEntry((current) => current.reason === reason
      ? { ...current, reason: null }
      : { values: current.values.map(() => ''), invalid: current.invalid.map(() => false), reason })
  }, [])

  const goToPlayer = React.useCallback(async (playerId: string | null) => {
    if (!playerId || playerId === currentIdRef.current) return
    if (!isFieldEntryEmpty(entryRef.current)) {
      const ok = await confirm({
        title: t('athletes.tests.field.discard.title'),
        text: t('athletes.tests.field.discard.text', { name: nameOf(currentIdRef.current) }),
        confirmText: t('athletes.tests.field.discard.confirm'),
        variant: 'destructive',
      })
      if (!ok) return
    }
    setCurrentId(playerId)
    resetEntry()
  }, [confirm, nameOf, resetEntry, t])

  const stepPlayer = React.useCallback((direction: 1 | -1) => {
    if (rosterIds.length === 0) return
    const index = currentId ? rosterIds.indexOf(currentId) : -1
    const next = rosterIds[(index + direction + rosterIds.length) % rosterIds.length]
    void goToPlayer(next)
  }, [currentId, goToPlayer, rosterIds])

  // --- "Dalej" ----------------------------------------------------------------
  const moveToNextMissing = React.useCallback((saved: ReadonlySet<string>, fromId: string) => {
    const next = nextPlayerWithMissing(rosterIds, saved, fromId)
    if (next) {
      setCurrentId(next)
      resetEntry()
      return next
    }
    resetEntry()
    return null
  }, [resetEntry, rosterIds])

  const handleNext = React.useCallback(async () => {
    if (!data || !currentId || blocked || busy) return
    const outcome = buildRecordBody(entry)
    if (outcome.kind === 'invalidValue') {
      setEntryError(t('athletes.tests.field.errors.invalidValue', { attempt: outcome.attemptNo }))
      focusAttempt(outcome.attemptNo - 1)
      return
    }
    if (outcome.kind === 'empty') {
      const next = moveToNextMissing(savedIds, currentId)
      setAnnouncement(next
        ? t('athletes.tests.field.announce.skipped', { name: nameOf(currentId), next: nameOf(next) })
        : t('athletes.tests.field.announce.allSaved'))
      return
    }
    const fingerprint = recordFingerprint(currentId, outcome.body)
    const cached = keyCacheRef.current.get(currentId)
    const idempotencyKey = cached && cached.fingerprint === fingerprint ? cached.key : createIdempotencyKey()
    keyCacheRef.current.set(currentId, { fingerprint, key: idempotencyKey })

    setSaving(true)
    setEntryError(null)
    const playerId = currentId
    try {
      const payload = { sessionId: data.session.id, playerId, ...outcome.body, idempotencyKey }
      const call = await runMutation({
        operation: () => apiCall<RecordResponse & ApiErrorBody>('/api/athletes/test-results/record', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }),
        context: { formId: 'athletes-tests-field', resourceId: playerId },
        mutationPayload: payload,
      })
      if (call.ok && call.result?.result) {
        const saved = call.result.result
        keyCacheRef.current.delete(playerId)
        const nextResults = new Map(results)
        nextResults.set(playerId, saved)
        setResults(nextResults)
        const savedMessage = t('athletes.tests.field.announce.saved', {
          name: nameOf(playerId),
          result: describeResult(saved, data.definition.unit, locale, t),
        })
        const checkMessage = saved.checkFlag ? ` ${t('athletes.tests.field.announce.check')}` : ''
        const next = moveToNextMissing(new Set(nextResults.keys()), playerId)
        const nextMessage = next
          ? ` ${t('athletes.tests.field.announce.next', { name: nameOf(next) })}`
          : ` ${t('athletes.tests.field.announce.allSaved')}`
        setAnnouncement(`${savedMessage}${checkMessage}${nextMessage}`)
        return
      }
      const body = call.result as ApiErrorBody | null
      if (call.status === 409 && body?.error === 'athletes.errors.testSessionFinished') {
        setConflict(t('athletes.tests.field.conflict.finished'))
      } else if (call.status === 409 && body?.error === 'athletes.errors.testIdempotencyKeyReused') {
        keyCacheRef.current.delete(playerId)
        setEntryError(t('athletes.errors.testIdempotencyKeyReused'))
      } else if (call.status === 409) {
        setConflict(t('athletes.tests.field.conflict.changed'))
      } else if (call.status === 404) {
        setConflict(translateApiError(body, t, 'athletes.errors.testSessionNotFound'))
      } else {
        // Input stays so the coach can fix it or retry with the same key.
        setEntryError(translateApiError(body, t, 'athletes.tests.field.errors.save'))
      }
    } catch (err) {
      if (isNetworkFailure(err)) {
        markConnectionLost()
      } else {
        setEntryError(t('athletes.tests.field.errors.save'))
      }
    } finally {
      setSaving(false)
    }
  }, [blocked, busy, currentId, data, entry, focusAttempt, locale, markConnectionLost, moveToNextMissing, nameOf, results, runMutation, savedIds, t])

  // --- "Zakończ test" ----------------------------------------------------------
  const handleFinish = React.useCallback(async () => {
    if (!data || blocked || busy) return
    const missing = totalCount - savedCount
    const ok = await confirm({
      title: t('athletes.tests.field.finish.confirmTitle'),
      text: missing > 0
        ? t('athletes.tests.field.finish.confirmMissing', { count: missing })
        : t('athletes.tests.field.finish.confirmAll'),
      confirmText: t('athletes.tests.field.finish.action'),
    })
    if (!ok) return
    if (!isFieldEntryEmpty(entryRef.current)) resetEntry()
    setFinishing(true)
    try {
      const payload = { id: data.session.id, ...(data.session.updatedAt ? { updatedAt: data.session.updatedAt } : {}) }
      const call = await runMutation({
        operation: () => apiCall<FinishResponse & ApiErrorBody>('/api/athletes/test-sessions/finish', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }),
        context: { formId: 'athletes-tests-field', resourceId: data.session.id },
        mutationPayload: payload,
      })
      if (call.ok && call.result?.summary) {
        setSummary(call.result)
        setAnnouncement(t('athletes.tests.field.finish.done'))
        return
      }
      if (call.status === 409) setConflict(t('athletes.tests.field.conflict.changed'))
      else setEntryError(translateApiError(call.result, t, 'athletes.tests.field.errors.finish'))
    } catch (err) {
      if (isNetworkFailure(err)) markConnectionLost()
      else setEntryError(t('athletes.tests.field.errors.finish'))
    } finally {
      setFinishing(false)
    }
  }, [blocked, busy, confirm, data, markConnectionLost, resetEntry, runMutation, savedCount, t, totalCount])

  // --- Render --------------------------------------------------------------
  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('athletes.errors.testSessionNotFound')}
        backHref={TESTS_HREF}
        backLabel={t('athletes.tests.actions.backToCatalog')}
      />
    )
  }
  if (loadError) return <TestsLoadErrorMessage error={loadError} onRetry={() => setReloadToken((value) => value + 1)} />
  if (isLoading && !data) return <LoadingMessage label={t('athletes.tests.field.loading')} />
  if (!data) return null

  const testName = formatTestName(data.definition.name, data.definition.variant)
  const testDate = formatDisplayDate(data.session.testedOn, locale) ?? data.session.testedOn
  const liveRegion = (
    <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
  )

  if (summary) {
    const s = summary.summary
    return (
      <div className="mx-auto w-full max-w-xl space-y-4">
        {liveRegion}
        <h1 className="text-xl font-semibold">{t('athletes.tests.field.finish.title', { test: testName, date: testDate })}</h1>
        {summary.alreadyFinished ? <p className="text-sm text-muted-foreground">{t('athletes.tests.field.finish.alreadyFinished')}</p> : null}
        <dl className="grid grid-cols-2 gap-3" aria-label={t('athletes.tests.field.finish.summaryLabel')}>
          {[
            ['recorded', s.recorded],
            ['notPerformed', s.notPerformed],
            ['empty', s.empty],
            ['invalidAttempt', s.invalidAttempt],
            ['joinedLater', s.joinedLater],
          ].filter(([key, value]) => key === 'recorded' || key === 'notPerformed' || key === 'empty' || Number(value) > 0).map(([key, value]) => (
            <div key={String(key)} className="rounded-lg border bg-card p-3">
              <dt className="text-sm text-muted-foreground">{t(`athletes.tests.field.finish.counts.${String(key)}`)}</dt>
              <dd className="text-2xl font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-muted-foreground">{t('athletes.tests.field.finish.total', { count: s.playersTotal })}</p>
        <section className="space-y-2 rounded-lg border bg-muted/40 p-4" aria-labelledby="field-next-step">
          <h2 id="field-next-step" className="font-medium">{t('athletes.tests.field.finish.nextStepTitle')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('athletes.tests.field.finish.nextStep', { weeks: data.definition.repeatEveryWeeks })}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild className="min-h-12">
              <Link href={testViewHref(data.definition.id)}>{t('athletes.tests.actions.viewResults')}</Link>
            </Button>
            <Button asChild variant="outline" className="min-h-12">
              <Link href={TESTS_HREF}>{t('athletes.tests.actions.backToCatalog')}</Link>
            </Button>
          </div>
        </section>
      </div>
    )
  }

  if (data.session.status === 'finished') {
    return (
      <EmptyState
        icon={<Flag className="size-6" aria-hidden="true" />}
        title={t('athletes.tests.field.finishedState.title')}
        description={t('athletes.tests.field.finishedState.description')}
        actions={(
          <Button asChild variant="outline">
            <Link href={testViewHref(data.definition.id)}>{t('athletes.tests.actions.viewResults')}</Link>
          </Button>
        )}
      />
    )
  }

  if (totalCount === 0) {
    return (
      <EmptyState
        title={t('athletes.tests.field.noPlayers.title')}
        description={t('athletes.tests.field.noPlayers.description')}
        actions={(
          <Button asChild variant="outline">
            <Link href={TESTS_HREF}>{t('athletes.tests.actions.backToCatalog')}</Link>
          </Button>
        )}
      />
    )
  }

  const currentPlayer = currentId ? playersById.get(currentId) ?? null : null
  const currentResult = currentId ? results.get(currentId) ?? null : null
  const unsavedName = connectionLoss?.unsavedPlayerId ? nameOf(connectionLoss.unsavedPlayerId) : ''
  const controlsDisabled = blocked || busy

  return (
    <div className="mx-auto w-full max-w-xl space-y-4 pb-4">
      {liveRegion}
      {ConfirmDialogElement}

      <header className="space-y-1">
        <h1 className="text-lg font-semibold">
          {testName}
          {' · '}
          {testDate}
        </h1>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {t('athletes.tests.field.progress', { saved: savedCount, total: totalCount })}
        </p>
      </header>

      {connectionLoss || !online ? (
        <Alert status="warning" icon={<WifiOff className="size-4" aria-hidden="true" />}>
          <AlertTitle>{t('athletes.tests.field.connection.title')}</AlertTitle>
          <AlertDescription>
            <span>{t('athletes.tests.field.connection.saved', { saved: savedCount, total: totalCount })}</span>
            {unsavedName ? <span> {t('athletes.tests.field.connection.unsaved', { name: unsavedName })}</span> : null}
            <span> {t('athletes.tests.field.connection.blocked')}</span>
          </AlertDescription>
          {online ? (
            <div className="mt-2">
              <Button type="button" variant="outline" className="min-h-12" disabled={checkingConnection} onClick={() => { void checkConnection() }}>
                {t('athletes.tests.field.connection.check')}
              </Button>
            </div>
          ) : null}
        </Alert>
      ) : null}

      {conflict ? (
        <Alert status="error">
          <AlertTitle>{t('athletes.tests.field.conflict.title')}</AlertTitle>
          <AlertDescription>{conflict}</AlertDescription>
          <div className="mt-2">
            <Button type="button" variant="outline" className="min-h-12" onClick={() => setReloadToken((value) => value + 1)}>
              {t('athletes.tests.field.conflict.reload')}
            </Button>
          </div>
        </Alert>
      ) : null}

      <section className="space-y-3 rounded-lg border bg-card p-3" aria-labelledby="field-player-heading">
        <h2 id="field-player-heading" className="sr-only">{t('athletes.tests.field.playerSection')}</h2>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-12 shrink-0"
            aria-label={t('athletes.tests.field.previousPlayer')}
            disabled={controlsDisabled}
            onClick={() => stepPlayer(-1)}
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </Button>
          <Select value={currentId ?? undefined} onValueChange={(value) => { void goToPlayer(value) }} disabled={controlsDisabled}>
            <SelectTrigger className="h-12 min-w-0 flex-1" aria-label={t('athletes.tests.field.playerSelect')}>
              <SelectValue placeholder={t('athletes.tests.field.playerSelect')} />
            </SelectTrigger>
            <SelectContent>
              {data.roster.map((player) => (
                <SelectItem key={player.id} value={player.id} className="min-h-12">
                  {formatPersonName(player.firstName, player.lastName, hideNames)}
                  {' · '}
                  {savedIds.has(player.id) ? t('athletes.tests.field.playerSaved') : t('athletes.tests.field.playerMissing')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-12 shrink-0"
            aria-label={t('athletes.tests.field.nextPlayer')}
            disabled={controlsDisabled}
            onClick={() => stepPlayer(1)}
          >
            <ChevronRight className="size-5" aria-hidden="true" />
          </Button>
        </div>

        {currentPlayer ? (
          <p className="text-base font-medium">
            <PersonName firstName={currentPlayer.firstName} lastName={currentPlayer.lastName} />
          </p>
        ) : null}

        {currentResult ? (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <CircleCheck className="size-4 text-status-success-icon" aria-hidden="true" />
            <span>
              {t('athletes.tests.field.savedResult', { result: describeResult(currentResult, data.definition.unit, locale, t) })}
            </span>
            {currentResult.checkFlag ? (
              <StatusBadge variant="warning">{t('athletes.tests.check')}</StatusBadge>
            ) : null}
            <span className="text-muted-foreground">{t('athletes.tests.field.overwriteHint')}</span>
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-label={t('athletes.tests.field.trialsLabel')}>
          {entry.values.map((value, index) => {
            const inputId = `field-trial-${index + 1}`
            const invalid = entry.invalid[index]
            return (
              <div key={inputId} className="space-y-1">
                <label htmlFor={inputId} className="text-sm font-medium">
                  {t('athletes.tests.field.trial', { attempt: index + 1 })}
                  {invalid ? ` · ${t('athletes.tests.state.invalidAttempt')}` : ''}
                </label>
                <Input
                  ref={(element) => { inputRefs.current[index] = element }}
                  id={inputId}
                  value={value}
                  inputMode="none"
                  autoComplete="off"
                  className={cn('h-12', activeAttempt === index && !inputsDisabled ? 'border-primary' : undefined)}
                  inputClassName="text-lg"
                  trailing={<span className="text-sm text-muted-foreground">{data.definition.unit}</span>}
                  placeholder={invalid ? t('athletes.tests.field.invalidPlaceholder') : '—'}
                  disabled={inputsDisabled}
                  aria-invalid={entryError && activeAttempt === index ? true : undefined}
                  onFocus={() => setActiveAttempt(index)}
                  onChange={(event) => setAttemptText(index, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void handleNext()
                    }
                  }}
                />
              </div>
            )
          })}
        </div>

        {entry.reason ? (
          <p className="text-sm font-medium">
            {t('athletes.tests.field.reasonChosen', { reason: t(reasonLabelKey(entry.reason)) })}
          </p>
        ) : null}

        {entryError ? (
          <Alert status="error" size="sm">
            <AlertDescription>{entryError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={reasonsOpen || entry.reason ? 'secondary' : 'outline'}
            className="min-h-12"
            aria-expanded={reasonsOpen}
            aria-controls="field-reasons"
            disabled={controlsDisabled}
            onClick={() => setReasonsOpen((open) => !open)}
          >
            {t('athletes.tests.state.notPerformed')}
          </Button>
          <Button
            type="button"
            variant={entry.invalid[activeAttempt] ? 'secondary' : 'outline'}
            className="min-h-12"
            aria-pressed={entry.invalid[activeAttempt] ?? false}
            disabled={inputsDisabled}
            onClick={toggleInvalidAttempt}
          >
            {t('athletes.tests.state.invalidAttempt')}
          </Button>
        </div>

        {reasonsOpen ? (
          <div id="field-reasons" className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="group" aria-label={t('athletes.tests.field.reasonsLabel')}>
            {TEST_REASON_CODES.map((reason) => (
              <Button
                key={reason}
                type="button"
                variant={entry.reason === reason ? 'secondary' : 'outline'}
                className="min-h-12"
                aria-pressed={entry.reason === reason}
                disabled={controlsDisabled}
                onClick={() => chooseReason(reason)}
              >
                {t(reasonLabelKey(reason))}
              </Button>
            ))}
          </div>
        ) : null}

        <div className="grid grid-cols-3 gap-2" role="group" aria-label={t('athletes.tests.field.keypadLabel')}>
          {KEYPAD_KEYS.map((key) => (
            <Button
              key={key}
              type="button"
              variant="outline"
              className="min-h-12 text-lg"
              disabled={inputsDisabled}
              aria-label={key === 'backspace'
                ? t('athletes.tests.field.keypad.backspace')
                : key === 'separator'
                  ? t('athletes.tests.field.keypad.separator')
                  : undefined}
              // Keep the focus in the trial input so a screen reader hears the new value.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pressKey(key)}
            >
              {key === 'backspace'
                ? <Delete className="size-5" aria-hidden="true" />
                : key === 'separator'
                  ? separator
                  : key}
            </Button>
          ))}
        </div>

        <Button
          type="button"
          className="min-h-12 w-full text-base"
          disabled={controlsDisabled}
          aria-busy={saving}
          onClick={() => { void handleNext() }}
        >
          {saving ? t('athletes.tests.field.saving') : t('athletes.tests.field.next')}
          <ArrowRight className="size-5" aria-hidden="true" />
        </Button>
      </section>

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
        <Button asChild variant="ghost" className="min-h-12">
          <Link href={TESTS_HREF}>{t('athletes.tests.field.later')}</Link>
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-12"
          disabled={controlsDisabled}
          aria-busy={finishing}
          onClick={() => { void handleFinish() }}
        >
          <Flag className="size-4" aria-hidden="true" />
          {t('athletes.tests.field.finish.action')}
        </Button>
      </div>
    </div>
  )
}
