import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

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
