import type { TestDirection } from '../data/entities'

/**
 * Apzumi test template (spec E02, REQ-001, D213): twelve definitions copied into every
 * club by `template_key`. The first six (in `sortOrder`) are active.
 *
 * TEMPORARY content (Q-005, waits for Q60/Q64): names, units and attempts come from the
 * lo-fi prototype rev-053; the "clear change" thresholds are empty on purpose — the UI
 * says the meaning of a change needs assessment. Changing a definition later is a
 * template sync by `templateKey`, never a rename of the key.
 *
 * Names are Polish first (FR-005) and are catalog data, not UI strings.
 */
export type TestTemplateEntry = {
  templateKey: string
  name: string
  variant: string | null
  unit: string
  direction: TestDirection
  attempts: number
  repeatEveryWeeks: number
  sortOrder: number
  isActive: boolean
  clearChangeThreshold: string | null
  thresholdSource: string | null
}

type Entry = Omit<TestTemplateEntry, 'sortOrder' | 'isActive' | 'repeatEveryWeeks' | 'clearChangeThreshold' | 'thresholdSource'>

const ACTIVE: Entry[] = [
  { templateKey: 'cmj', name: 'Skok pionowy z rękami na biodrach (CMJ)', variant: null, unit: 'cm', direction: 'higher_better', attempts: 3 },
  { templateKey: 'sprint_10m', name: 'Sprint 10 m', variant: 'start wysoki', unit: 's', direction: 'lower_better', attempts: 3 },
  { templateKey: 'yoyo_ir1', name: 'Yo-Yo Intermittent Recovery, poziom 1 (IR1)', variant: null, unit: 'm', direction: 'higher_better', attempts: 1 },
  { templateKey: 'broad_jump', name: 'Skok w dal z miejsca', variant: null, unit: 'cm', direction: 'higher_better', attempts: 3 },
  { templateKey: 'cod_5_10_5', name: 'Zmiana kierunku (5-10-5)', variant: null, unit: 's', direction: 'lower_better', attempts: 2 },
  { templateKey: 'squat_1rm', name: 'Siła nóg (1RM, przysiad)', variant: null, unit: 'kg', direction: 'higher_better', attempts: 3 },
]

const INACTIVE: Entry[] = [
  { templateKey: 'squat_jump', name: 'Skok z przysiadu (SJ)', variant: null, unit: 'cm', direction: 'higher_better', attempts: 3 },
  { templateKey: 'drop_jump_rsi', name: 'Skok po zeskoku (DJ) i RSI', variant: null, unit: 'cm', direction: 'higher_better', attempts: 3 },
  { templateKey: 'cmj_single_leg', name: 'Skok pionowy jednonóż (CMJ)', variant: null, unit: 'cm', direction: 'higher_better', attempts: 3 },
  { templateKey: 'flying_sprint_20m', name: 'Sprint lotny 20 m', variant: null, unit: 's', direction: 'lower_better', attempts: 3 },
  { templateKey: 'cod_505', name: 'Zmiana kierunku (505)', variant: null, unit: 's', direction: 'lower_better', attempts: 2 },
  { templateKey: 'imtp', name: 'Izometryczne ciągnięcie w pół-przysiadzie (IMTP)', variant: null, unit: 'N', direction: 'higher_better', attempts: 3 },
]

/** Default "Powtarzaj co" (Q5, D71). */
export const DEFAULT_REPEAT_EVERY_WEEKS = 6

export const TEST_TEMPLATE: readonly TestTemplateEntry[] = [...ACTIVE, ...INACTIVE].map((entry, index) => ({
  ...entry,
  repeatEveryWeeks: DEFAULT_REPEAT_EVERY_WEEKS,
  sortOrder: index + 1,
  isActive: index < ACTIVE.length,
  clearChangeThreshold: null,
  thresholdSource: null,
}))
