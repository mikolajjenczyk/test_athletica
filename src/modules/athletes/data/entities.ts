import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

/**
 * A club is a `directory` organization; every row here carries its `organization_id`.
 * MVP: at most one active team per club (D206) — enforced by a partial unique index
 * in the migration and by the create/update commands (409).
 */
@Entity({ tableName: 'athletes_teams' })
@Index({ name: 'athletes_teams_scope_idx', properties: ['tenantId', 'organizationId'] })
export class AthletesTeam {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/** Club-defined position dictionary (D344). */
@Entity({ tableName: 'athletes_positions' })
@Index({ name: 'athletes_positions_scope_idx', properties: ['tenantId', 'organizationId'] })
export class AthletesPosition {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number = 0

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * A minor on the club's team. `first_name`, `last_name` and `birth_date` are encrypted
 * at rest (see `encryption.ts`), so `birth_date` is stored as text (ISO date) — a
 * ciphertext does not fit a `date` column.
 */
@Entity({ tableName: 'athletes_players' })
@Index({ name: 'athletes_players_team_idx', properties: ['tenantId', 'organizationId', 'teamId'] })
export class AthletesPlayer {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'team_id', type: 'uuid' })
  teamId!: string

  @Property({ name: 'first_name', type: 'text' })
  firstName!: string

  @Property({ name: 'last_name', type: 'text' })
  lastName!: string

  @Property({ name: 'birth_date', type: 'text' })
  birthDate!: string

  @Property({ name: 'position_id', type: 'uuid', nullable: true })
  positionId?: string | null

  @Property({ name: 'joined_at', type: 'date' })
  joinedAt!: string

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

export type TestDirection = 'higher_better' | 'lower_better'
export type TestCountingRule = 'best'
export type TestSessionKind = 'team' | 'individual'
export type TestSessionStatus = 'open' | 'finished'
export type TestResultState = 'recorded' | 'empty' | 'invalid_attempt' | 'not_performed' | 'joined_later'
export type TestReasonCode = 'absent' | 'excused' | 'other'

/**
 * A club's test (spec E02, REQ-001): copied from `lib/testTemplate.ts` by `template_key`
 * and read-only in the MVP. `clear_change_threshold` / `threshold_source` belong to Apzumi
 * (D99) and are never written through the API. Numeric columns come back as strings.
 */
@Entity({ tableName: 'athletes_test_definitions' })
@Index({ name: 'athletes_test_definitions_scope_idx', properties: ['tenantId', 'organizationId'] })
@Unique({ name: 'athletes_test_definitions_template_key_uq', properties: ['tenantId', 'organizationId', 'templateKey'] })
export class AthletesTestDefinition {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'template_key', type: 'text' })
  templateKey!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  variant?: string | null

  @Property({ type: 'text' })
  unit!: string

  @Property({ type: 'text' })
  direction!: TestDirection

  @Property({ type: 'integer' })
  attempts!: number

  @Property({ name: 'counting_rule', type: 'text', default: 'best' })
  countingRule: TestCountingRule = 'best'

  @Property({ name: 'clear_change_threshold', type: 'numeric', precision: 12, scale: 4, nullable: true })
  clearChangeThreshold?: string | null

  @Property({ name: 'threshold_source', type: 'text', nullable: true })
  thresholdSource?: string | null

  @Property({ name: 'repeat_every_weeks', type: 'integer', default: 6 })
  repeatEveryWeeks: number = 6

  @Property({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number = 0

  @Property({ name: 'is_active', type: 'boolean', default: false })
  isActive: boolean = false

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * One test on one date for a team (or, from phase 2, one player). At most one `open`
 * session per team and definition — a partial unique index in the migration; the start
 * command returns the open one instead of creating a second.
 */
@Entity({ tableName: 'athletes_test_sessions' })
@Index({ name: 'athletes_test_sessions_definition_idx', properties: ['tenantId', 'organizationId', 'testDefinitionId', 'testedOn'] })
export class AthletesTestSession {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'test_definition_id', type: 'uuid' })
  testDefinitionId!: string

  @Property({ type: 'text' })
  kind!: TestSessionKind

  @Property({ name: 'team_id', type: 'uuid', nullable: true })
  teamId?: string | null

  @Property({ name: 'player_id', type: 'uuid', nullable: true })
  playerId?: string | null

  @Property({ name: 'tested_on', type: 'date' })
  testedOn!: string

  @Property({ type: 'text', default: 'open' })
  status: TestSessionStatus = 'open'

  @Property({ name: 'finished_at', type: Date, nullable: true })
  finishedAt?: Date | null

  @Property({ name: 'started_by_user_id', type: 'uuid', nullable: true })
  startedByUserId?: string | null

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/** One attempt of one player; `value` is null when the attempt is invalid or not entered. */
@Entity({ tableName: 'athletes_test_trials' })
@Index({ name: 'athletes_test_trials_session_idx', properties: ['tenantId', 'organizationId', 'sessionId', 'playerId'] })
export class AthletesTestTrial {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'session_id', type: 'uuid' })
  sessionId!: string

  @Property({ name: 'player_id', type: 'uuid' })
  playerId!: string

  @Property({ name: 'attempt_no', type: 'integer' })
  attemptNo!: number

  @Property({ type: 'numeric', precision: 12, scale: 4, nullable: true })
  value?: string | null

  @Property({ name: 'is_invalid', type: 'boolean', default: false })
  isInvalid: boolean = false

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * One player's result in one session: the best valid trial (R02) or a gap state — never
 * 0 for a gap (R12). `reason_code` is a fixed code without health data (N17) and is only
 * returned to callers with `athletes.tests.record` (D109).
 */
@Entity({ tableName: 'athletes_test_results' })
@Index({ name: 'athletes_test_results_history_idx', properties: ['tenantId', 'organizationId', 'playerId', 'testDefinitionId', 'testedOn'] })
@Unique({ name: 'athletes_test_results_idempotency_uq', properties: ['tenantId', 'organizationId', 'idempotencyKey'] })
export class AthletesTestResult {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'session_id', type: 'uuid' })
  sessionId!: string

  @Property({ name: 'player_id', type: 'uuid' })
  playerId!: string

  @Property({ name: 'test_definition_id', type: 'uuid' })
  testDefinitionId!: string

  @Property({ name: 'tested_on', type: 'date' })
  testedOn!: string

  @Property({ type: 'numeric', precision: 12, scale: 4, nullable: true })
  value?: string | null

  @Property({ type: 'text' })
  state!: TestResultState

  @Property({ name: 'reason_code', type: 'text', nullable: true })
  reasonCode?: TestReasonCode | null

  @Property({ name: 'is_makeup', type: 'boolean', default: false })
  isMakeup: boolean = false

  @Property({ name: 'counts_in_team_average', type: 'boolean', default: true })
  countsInTeamAverage: boolean = true

  @Property({ name: 'corrected_at', type: Date, nullable: true })
  correctedAt?: Date | null

  @Property({ name: 'idempotency_key', type: 'text' })
  idempotencyKey!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
