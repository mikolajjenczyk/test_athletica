"use client"

import * as React from 'react'
import Link from 'next/link'
import { FileSpreadsheet, RotateCcw, Save } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { FileUploadArea } from '@open-mercato/ui/primitives/file-upload'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { formatDisplayDate } from '@open-mercato/ui/primitives/date-format'
import { NameAssignmentPanel } from './NameAssignmentPanel'
import {
  DAILY_IMPORT_ACCEPT,
  DAILY_IMPORT_MAX_BYTES,
  dailyImportErrorKey,
  missingColumnKeys,
  pruneAssignments,
  serializeAssignments,
  unassignedNames,
  type AssignablePlayer,
  type NameAssignments,
} from '../lib/dailyImportUi'

/** The kind-independent part of a daily-data preview (RPE now, wellbeing in phase 2). */
export type ImportPreviewBase = {
  kind: string
  fileName: string
  teamId: string
  period: { from: string; to: string } | null
  counts: {
    rows: number
    saved: number
    corrected: number
    unchanged: number
    rejected: number
    missing: number
    assignedNames: number
  }
  rejected: Array<{ line: number; reason: string }>
  unknownNames: Array<{ name: string; rowCount: number }>
  ignoredColumns: string[]
  players: AssignablePlayer[]
}

export type ImportCommitBase = {
  importId: string
  teamId: string
  periodFrom: string
  periodTo: string
  saved: number
  corrected: number
  unchanged: number
  rejected: number
  assignedNames: number
  rejectedRows: Array<{ line: number; reason: string }>
}

export type ImportPreviewProps<P extends ImportPreviewBase, C extends ImportCommitBase> = {
  /** `kind` form field of the preview/commit routes. */
  kind: string
  /** Heading, e.g. "Wgraj plik RPE". */
  title: string
  /** Label of `counts.missing`, e.g. "Brak RPE" (phase 2: "Brak odpowiedzi"). */
  missingCountLabel: string
  /** Kind-specific detail: rows table, gaps, corrections. */
  renderDetails: (preview: P) => React.ReactNode
  /** Slot for an extra kind-specific panel (e.g. "which survey counts" in phase 2). */
  renderExtraPanel?: (preview: P) => React.ReactNode
  /** "Dane dzienne" — the success summary links back here. */
  backHref: string
  onCommitted?: (result: C) => void
  previewPath?: string
  commitPath?: string
}

type ImportError = { messageKey: string; columnKeys: string[] }

type RequestFailure = Error & { status: number; body: Record<string, unknown> | null }

function requestFailure(status: number, body: Record<string, unknown> | null): RequestFailure {
  const error = new Error(typeof body?.error === 'string' ? body.error : `Request failed (${status})`) as RequestFailure
  error.status = status
  error.body = body
  return error
}

/** Multipart POST through the shared `apiCall` (no content-type: the browser sets the boundary). */
async function postImportForm<T>(path: string, form: FormData): Promise<T> {
  const call = await apiCall<T & Record<string, unknown>>(path, { method: 'POST', body: form })
  if (!call.ok || !call.result) throw requestFailure(call.status, (call.result as Record<string, unknown> | null) ?? null)
  return call.result
}

function toImportError(err: unknown, fallbackKey: string): ImportError {
  const failure = err as Partial<RequestFailure> | null
  const source = { ...(failure?.body ?? {}), status: failure?.status ?? (err as { status?: number } | null)?.status }
  return { messageKey: dailyImportErrorKey(source, fallbackKey), columnKeys: missingColumnKeys(failure?.body ?? null) }
}

type TeamOption = { value: string; label: string }

/**
 * Shared daily-data import flow (REQ-001…REQ-003, REQ-013): file picker (.xlsx/.csv) → preview
 * (nothing saved) → name assignment → "Zapisz" → summary. Generic over the kind: the RPE page
 * renders its rows via `renderDetails`, phase 2 adds wellbeing plus `renderExtraPanel`.
 */
export function ImportPreview<P extends ImportPreviewBase, C extends ImportCommitBase>({
  kind,
  title,
  missingCountLabel,
  renderDetails,
  renderExtraPanel,
  backHref,
  onCommitted,
  previewPath = '/api/athletes/daily-imports/preview',
  commitPath = '/api/athletes/daily-imports/commit',
}: ImportPreviewProps<P, C>) {
  const t = useT()
  const locale = useLocale()
  const { runMutation } = useGuardedMutation<{ formId: string; resourceId: string }>({ contextId: `athletes.daily-import.${kind}` })

  const [file, setFile] = React.useState<File | null>(null)
  const [teams, setTeams] = React.useState<TeamOption[] | null>(null)
  const [teamId, setTeamId] = React.useState('')
  const [assignments, setAssignments] = React.useState<NameAssignments>({})
  const [preview, setPreview] = React.useState<P | null>(null)
  const [committed, setCommitted] = React.useState<C | null>(null)
  const [busy, setBusy] = React.useState<'preview' | 'recompute' | 'commit' | null>(null)
  const [error, setError] = React.useState<ImportError | null>(null)
  const [announcement, setAnnouncement] = React.useState('')
  const [autoFocusNames, setAutoFocusNames] = React.useState(false)
  const requestSeq = React.useRef(0)

  React.useEffect(() => {
    let cancelled = false
    readApiResultOrThrow<{ items?: TeamOption[] }>('/api/athletes/options/teams?limit=200')
      .then((data) => {
        if (cancelled) return
        const items = data?.items ?? []
        setTeams(items)
        if (items.length === 1) setTeamId(items[0].value)
      })
      // The API defaults to the club's only team; a failed option load just hides the choice.
      .catch(() => { if (!cancelled) setTeams([]) })
    return () => { cancelled = true }
  }, [])

  const needsTeam = (teams?.length ?? 0) > 1
  const teamMissing = needsTeam && !teamId

  const buildForm = React.useCallback((selected: File, nextAssignments: NameAssignments) => {
    const form = new FormData()
    form.set('kind', kind)
    form.set('file', selected, selected.name)
    if (teamId) form.set('teamId', teamId)
    const serialized = serializeAssignments(nextAssignments)
    if (serialized) form.set('assignments', serialized)
    return form
  }, [kind, teamId])

  const runPreview = React.useCallback(async (selected: File, nextAssignments: NameAssignments, mode: 'preview' | 'recompute') => {
    const seq = ++requestSeq.current
    setBusy(mode)
    setError(null)
    setAnnouncement(t(mode === 'preview' ? 'athletes.dailyImport.preview.loading' : 'athletes.dailyImport.preview.recomputing'))
    try {
      const result = await postImportForm<P>(previewPath, buildForm(selected, nextAssignments))
      if (seq !== requestSeq.current) return
      setPreview(result)
      setAssignments(pruneAssignments(nextAssignments, result.unknownNames, result.players))
      if (mode === 'preview') setAutoFocusNames(result.unknownNames.length > 0)
      setAnnouncement(t('athletes.dailyImport.preview.ready', { rows: result.counts.rows, rejected: result.counts.rejected }))
    } catch (err) {
      if (seq !== requestSeq.current) return
      const importError = toImportError(err, 'athletes.dailyImport.errors.previewFailed')
      setError(importError)
      if (mode === 'preview') setPreview(null)
      setAnnouncement(t(importError.messageKey))
    } finally {
      if (seq === requestSeq.current) setBusy(null)
    }
  }, [buildForm, previewPath, t])

  const handleFiles = React.useCallback((files: File[]) => {
    const selected = files[0] ?? null
    requestSeq.current += 1
    setFile(selected)
    setPreview(null)
    setCommitted(null)
    setAssignments({})
    setError(null)
    setBusy(null)
    setAutoFocusNames(false)
  }, [])

  const handleAssignment = React.useCallback((name: string, playerId: string | null) => {
    if (!file) return
    const next = { ...assignments, [name]: playerId }
    setAssignments(next)
    void runPreview(file, next, 'recompute')
  }, [assignments, file, runPreview])

  const handleCommit = React.useCallback(async () => {
    if (!file || !preview || busy) return
    setBusy('commit')
    setError(null)
    setAnnouncement(t('athletes.dailyImport.commit.saving'))
    try {
      const result = await runMutation({
        operation: () => postImportForm<C>(commitPath, buildForm(file, assignments)),
        context: { formId: `athletes.daily-import.${kind}`, resourceId: preview.teamId },
        // The guard sees the import metadata, never the file's rows or names.
        mutationPayload: { kind, teamId: preview.teamId, fileName: preview.fileName },
      })
      setCommitted(result)
      setPreview(null)
      const message = t('athletes.dailyImport.commit.success', {
        saved: result.saved,
        corrected: result.corrected,
        unchanged: result.unchanged,
        rejected: result.rejected,
      })
      setAnnouncement(message)
      flash(message, 'success')
      onCommitted?.(result)
    } catch (err) {
      const importError = toImportError(err, 'athletes.dailyImport.errors.commitFailed')
      setError(importError)
      setAnnouncement(t(importError.messageKey))
      flash(t(importError.messageKey), 'error')
    } finally {
      setBusy(null)
    }
  }, [assignments, buildForm, busy, commitPath, file, kind, onCommitted, preview, runMutation, t])

  const reset = React.useCallback(() => {
    requestSeq.current += 1
    setFile(null)
    setPreview(null)
    setCommitted(null)
    setAssignments({})
    setError(null)
    setBusy(null)
    setAutoFocusNames(false)
  }, [])

  const formatDate = (value: string) => formatDisplayDate(value, locale) ?? value
  const periodText = (period: { from: string; to: string } | null) => period
    ? t('athletes.dailyImport.preview.periodValue', { from: formatDate(period.from), to: formatDate(period.to) })
    : t('athletes.dailyImport.preview.noPeriod')

  const unassigned = preview ? unassignedNames(preview.unknownNames, assignments) : { names: [], rowCount: 0 }
  const canCommit = !!preview && !!file && busy === null && !teamMissing

  return (
    <div className="space-y-6">
      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {preview ? (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{preview.fileName}</span>
              {' · '}
              {periodText(preview.period)}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{t('athletes.dailyImport.page.description')}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={backHref}>{t('athletes.dailyImport.actions.cancel')}</Link>
          </Button>
          {!committed ? (
            <Button type="button" onClick={() => { void handleCommit() }} disabled={!canCommit} aria-busy={busy === 'commit' || undefined}>
              <Save className="size-4" aria-hidden="true" />
              {busy === 'commit' ? t('athletes.dailyImport.commit.saving') : t('athletes.dailyImport.actions.commit')}
            </Button>
          ) : null}
        </div>
      </div>

      {committed ? (
        <Alert status="success">
          <AlertTitle>{t('athletes.dailyImport.commit.title')}</AlertTitle>
          <AlertDescription>
            <div className="space-y-3">
              <p>{periodText({ from: committed.periodFrom, to: committed.periodTo })}</p>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                <div><dt className="text-muted-foreground">{t('athletes.dailyImport.counts.saved')}</dt><dd className="font-medium">{committed.saved}</dd></div>
                <div><dt className="text-muted-foreground">{t('athletes.dailyImport.counts.corrected')}</dt><dd className="font-medium">{committed.corrected}</dd></div>
                <div><dt className="text-muted-foreground">{t('athletes.dailyImport.counts.unchanged')}</dt><dd className="font-medium">{committed.unchanged}</dd></div>
                <div><dt className="text-muted-foreground">{t('athletes.dailyImport.counts.rejected')}</dt><dd className="font-medium">{committed.rejected}</dd></div>
              </dl>
              {committed.rejectedRows.length > 0 ? (
                <RejectedList rows={committed.rejectedRows} />
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <Link href={backHref}>{t('athletes.dailyImport.actions.backToDaily')}</Link>
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={reset}>
                  <RotateCcw className="size-4" aria-hidden="true" />
                  {t('athletes.dailyImport.actions.another')}
                </Button>
              </div>
            </div>
          </AlertDescription>
        </Alert>
      ) : (
        <section aria-label={t('athletes.dailyImport.file.sectionLabel')} className="space-y-4">
          {needsTeam ? (
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium" aria-hidden="true">{t('athletes.dailyImport.file.team')}</span>
              <Select value={teamId || undefined} onValueChange={(value) => { setTeamId(value); setPreview(null) }} disabled={busy !== null}>
                <SelectTrigger className="w-72" aria-label={t('athletes.dailyImport.file.team')}>
                  <SelectValue placeholder={t('athletes.dailyImport.file.teamPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {(teams ?? []).map((team) => <SelectItem key={team.value} value={team.value}>{team.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <FileUploadArea
            className="w-full"
            accept={DAILY_IMPORT_ACCEPT}
            multiple={false}
            maxSizeBytes={DAILY_IMPORT_MAX_BYTES}
            disabled={busy !== null}
            onFilesSelected={handleFiles}
            heading={t('athletes.dailyImport.file.heading')}
            description={t('athletes.dailyImport.file.description')}
            browseLabel={t('athletes.dailyImport.file.browse')}
          />
          {file ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-2 text-sm">
                <FileSpreadsheet className="size-4 text-muted-foreground" aria-hidden="true" />
                <span className="font-medium">{file.name}</span>
              </span>
              <Button
                type="button"
                variant={preview ? 'outline' : 'default'}
                onClick={() => { void runPreview(file, assignments, 'preview') }}
                disabled={busy !== null || teamMissing}
              >
                {preview ? t('athletes.dailyImport.actions.reloadPreview') : t('athletes.dailyImport.actions.preview')}
              </Button>
            </div>
          ) : null}
        </section>
      )}

      {error ? (
        <Alert status="error">
          <AlertTitle>{t(error.messageKey)}</AlertTitle>
          {error.columnKeys.length > 0 ? (
            <AlertDescription>
              {t('athletes.dailyImport.errors.missingColumnsList', { columns: error.columnKeys.map((key) => t(key)).join(', ') })}
            </AlertDescription>
          ) : (
            <AlertDescription>{t('athletes.dailyImport.errors.nothingSaved')}</AlertDescription>
          )}
        </Alert>
      ) : null}

      {busy === 'preview' ? <LoadingMessage label={t('athletes.dailyImport.preview.loading')} /> : null}

      {preview && !committed ? (
        <div className="space-y-6" aria-busy={busy === 'recompute' || undefined}>
          <section aria-label={t('athletes.dailyImport.preview.summaryLabel')} className="space-y-2">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4 lg:grid-cols-7">
              <div><dt className="text-muted-foreground">{t('athletes.dailyImport.counts.rows')}</dt><dd className="font-medium">{preview.counts.rows}</dd></div>
              <div><dt className="text-muted-foreground">{t('athletes.dailyImport.counts.new')}</dt><dd className="font-medium">{preview.counts.saved}</dd></div>
              <div><dt className="text-muted-foreground">{t('athletes.dailyImport.counts.corrected')}</dt><dd className="font-medium">{preview.counts.corrected}</dd></div>
              <div><dt className="text-muted-foreground">{t('athletes.dailyImport.counts.unchanged')}</dt><dd className="font-medium">{preview.counts.unchanged}</dd></div>
              <div><dt className="text-muted-foreground">{t('athletes.dailyImport.counts.rejected')}</dt><dd className="font-medium">{preview.counts.rejected}</dd></div>
              <div><dt className="text-muted-foreground">{missingCountLabel}</dt><dd className="font-medium">{preview.counts.missing}</dd></div>
              <div><dt className="text-muted-foreground">{t('athletes.dailyImport.counts.assignedNames')}</dt><dd className="font-medium">{preview.counts.assignedNames}</dd></div>
            </dl>
            <p className="text-sm text-muted-foreground">{t('athletes.dailyImport.preview.nothingSavedYet')}</p>
          </section>

          {unassigned.names.length > 0 ? (
            <Alert status="warning">
              <AlertDescription>
                {t('athletes.dailyImport.assign.unassignedWarning', { names: unassigned.names.length, rows: unassigned.rowCount })}
              </AlertDescription>
            </Alert>
          ) : null}

          <NameAssignmentPanel
            unknownNames={preview.unknownNames}
            players={preview.players}
            assignments={assignments}
            onChange={handleAssignment}
            disabled={busy !== null}
            autoFocus={autoFocusNames}
          />

          {renderExtraPanel ? renderExtraPanel(preview) : null}

          {renderDetails(preview)}

          {preview.rejected.length > 0 ? (
            <section aria-label={t('athletes.dailyImport.preview.rejectedTitle')} className="space-y-2">
              <SectionHeader title={t('athletes.dailyImport.preview.rejectedTitle')} count={preview.rejected.length} />
              <RejectedList rows={preview.rejected} />
            </section>
          ) : null}

          {preview.ignoredColumns.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('athletes.dailyImport.preview.ignoredColumns', { columns: preview.ignoredColumns.join(', ') })}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function RejectedList({ rows }: { rows: ReadonlyArray<{ line: number; reason: string }> }) {
  const t = useT()
  return (
    <ul className="space-y-1 text-sm">
      {rows.map((row, index) => (
        <li key={`${row.line}-${index}`}>
          {t('athletes.dailyImport.preview.rejectedLine', { line: row.line, reason: t(row.reason) })}
        </li>
      ))}
    </ul>
  )
}

export default ImportPreview
