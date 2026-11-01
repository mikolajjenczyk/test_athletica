"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { AccessDeniedMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { translateAthletesError } from './ClubShared'
import type { TestDefinitionListItem } from '../lib/testUi'

/** Stable host IDs and routes of the E02 test screens. */
export const TEST_DEFINITION_ENTITY_ID = 'athletes:athletes_test_definition'
export const TEST_RESULT_ENTITY_ID = 'athletes:athletes_test_result'

export const TESTS_HREF = '/backend/tests'
export const TESTS_START_HREF = '/backend/tests/start'

export function testStartHref(testDefinitionId?: string | null): string {
  return testDefinitionId ? `${TESTS_START_HREF}?testDefinitionId=${encodeURIComponent(testDefinitionId)}` : TESTS_START_HREF
}

export function testFieldHref(sessionId: string): string {
  return `${TESTS_HREF}/field/${encodeURIComponent(sessionId)}`
}

export function testViewHref(definitionId: string): string {
  return `${TESTS_HREF}/${encodeURIComponent(definitionId)}`
}

type Translate = ReturnType<typeof useT>

/** A load failure that keeps the HTTP status, so a 403 renders as "permission denied". */
export type TestsLoadError = { message: string; forbidden: boolean }

export function toTestsLoadError(err: unknown, t: Translate, fallbackKey: string): TestsLoadError {
  const status = (err as { status?: number } | null)?.status
  if (status === 403) return { message: t('athletes.tests.errors.forbidden'), forbidden: true }
  return { message: translateAthletesError(err, t, fallbackKey), forbidden: false }
}

export function TestsLoadErrorMessage({ error, onRetry }: { error: TestsLoadError; onRetry?: () => void }) {
  const t = useT()
  if (error.forbidden) {
    return (
      <AccessDeniedMessage
        label={t('athletes.tests.errors.forbidden')}
        description={t('athletes.tests.errors.forbiddenDescription')}
      />
    )
  }
  return (
    <ErrorMessage
      label={error.message}
      action={onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>{t('athletes.tests.actions.retry')}</Button>
      ) : undefined}
    />
  )
}

/**
 * UI visibility only — every API enforces `athletes.tests.record` on its own. Wildcard-aware
 * (`athletes.*`, `*`).
 */
export function useTestsPermissions(): { canRecord: boolean; isLoading: boolean } {
  const [state, setState] = React.useState({ canRecord: false, isLoading: true })
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const call = await apiCall<{ granted?: unknown[] }>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features: ['athletes.tests.record'] }),
        })
        if (cancelled) return
        const granted = Array.isArray(call.result?.granted) ? call.result.granted.map((value) => String(value)) : []
        setState({ canRecord: call.ok && hasAllFeatures(['athletes.tests.record'], granted), isLoading: false })
      } catch {
        if (!cancelled) setState({ canRecord: false, isLoading: false })
      }
    })()
    return () => { cancelled = true }
  }, [])
  return state
}

/** The club catalog is at most 12 definitions (R17), so one page covers it. */
export async function fetchTestDefinitions(params: { id?: string; activeOnly?: boolean } = {}): Promise<TestDefinitionListItem[]> {
  const data = await fetchCrudList<TestDefinitionListItem>('athletes/test-definitions', {
    page: 1,
    pageSize: 100,
    sortField: 'sortOrder',
    sortDir: 'asc',
    ...(params.id ? { id: params.id } : {}),
    ...(params.activeOnly ? { activeOnly: 'true' } : {}),
  })
  return data.items ?? []
}
