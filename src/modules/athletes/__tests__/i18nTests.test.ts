import { describe, expect, it } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import pl from '../i18n/pl.json'
import en from '../i18n/en.json'
import { TEST_REASON_CODES } from '../lib/testUi'

const MODULE_DIR = join(__dirname, '..')

/** Source files of the E02 test screens whose literal i18n keys must exist in both locales. */
const SOURCES = [
  'components/TestsShared.tsx',
  'components/TestCatalogTable.tsx',
  'components/TestStartForm.tsx',
  'components/FieldMode.tsx',
  'components/TestResultsTable.tsx',
  'lib/testUi.ts',
  'backend/tests/page.meta.ts',
  'backend/tests/start/page.meta.ts',
  'backend/tests/field/[sessionId]/page.meta.ts',
  'backend/tests/[definitionId]/page.meta.ts',
]

/** Keys built at run time (template literals). */
const DYNAMIC_KEYS = [
  ...TEST_REASON_CODES.map((reason) => `athletes.tests.reason.${reason}`),
  ...['recorded', 'notPerformed', 'empty', 'invalidAttempt', 'joinedLater'].map((key) => `athletes.tests.field.finish.counts.${key}`),
]

/** Feature, table and row-action IDs that look like keys but are never translated. */
const NOT_I18N = new Set([
  'athletes.tests.view',
  'athletes.tests.record',
  'athletes.tests.catalog',
  'athletes.tests.results',
  'athletes.tests.resume',
  'athletes.tests.start',
])

function literalKeys(): string[] {
  const keys = new Set<string>()
  for (const file of SOURCES) {
    const source = readFileSync(join(MODULE_DIR, file), 'utf8')
    for (const match of source.matchAll(/['"`](athletes\.[A-Za-z0-9_.]+[A-Za-z0-9_])['"`]/g)) {
      keys.add(match[1])
    }
  }
  return [...keys]
}

describe('athletes i18n — E02 test screens (step 1.10)', () => {
  const plDict = pl as Record<string, string>
  const enDict = en as Record<string, string>

  it('has the same keys in Polish and English', () => {
    expect(Object.keys(plDict).sort()).toEqual(Object.keys(enDict).sort())
  })

  it('translates every key the test screens use, in both locales', () => {
    const translatable = [...literalKeys(), ...DYNAMIC_KEYS].filter((key) => !NOT_I18N.has(key))
    const missing = translatable.filter((key) => !plDict[key] || !enDict[key])
    expect(missing).toEqual([])
    expect(translatable.length).toBeGreaterThan(100)
  })

  it('never leaves a translation empty or equal to its key', () => {
    for (const dict of [plDict, enDict]) {
      for (const [key, value] of Object.entries(dict)) {
        if (!key.startsWith('athletes.tests.')) continue
        expect(value.trim()).not.toBe('')
        expect(value).not.toBe(key)
      }
    }
  })

  it('keeps the placeholders of each test string identical across locales', () => {
    const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
    for (const key of Object.keys(plDict).filter((item) => item.startsWith('athletes.tests.'))) {
      expect([key, placeholders(enDict[key] ?? '')]).toEqual([key, placeholders(plDict[key])])
    }
  })
})
