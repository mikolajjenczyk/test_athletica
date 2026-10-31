import { Migration } from '@mikro-orm/migrations';
import { buildEncryptionMapBackfillSql } from '@open-mercato/shared/lib/encryption/migration-backfill';
import { defaultEncryptionMaps } from '../encryption';

export class Migration20261028131631_athletes extends Migration {

  override name = 'Migration20261028131631';

  override up(): void | Promise<void> {
    this.addSql(`create table "athletes_players" ("id" uuid not null default gen_random_uuid(), "team_id" uuid not null, "first_name" text not null, "last_name" text not null, "birth_date" text not null, "position_id" uuid null, "joined_at" date not null, "is_active" boolean not null default true, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "athletes_players_team_idx" on "athletes_players" ("tenant_id", "organization_id", "team_id");`);

    this.addSql(`create table "athletes_positions" ("id" uuid not null default gen_random_uuid(), "name" text not null, "sort_order" int not null default 0, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "athletes_positions_scope_idx" on "athletes_positions" ("tenant_id", "organization_id");`);

    this.addSql(`create table "athletes_teams" ("id" uuid not null default gen_random_uuid(), "name" text not null, "is_active" boolean not null default true, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "athletes_teams_scope_idx" on "athletes_teams" ("tenant_id", "organization_id");`);

    // MVP: one active team per club (D206); names unique per club among live rows.
    this.addSql(`create unique index "athletes_teams_one_active_uq" on "athletes_teams" ("tenant_id", "organization_id") where "is_active" = true and "deleted_at" is null;`);
    this.addSql(`create unique index "athletes_teams_name_uq" on "athletes_teams" ("tenant_id", "organization_id", "name") where "deleted_at" is null;`);
    this.addSql(`create unique index "athletes_positions_name_uq" on "athletes_positions" ("tenant_id", "organization_id", "name") where "deleted_at" is null;`);

    // Existing tenants get the player encryption map; new tenants receive it at creation.
    for (const map of defaultEncryptionMaps) this.addSql(buildEncryptionMapBackfillSql(map));
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "athletes_players" cascade;`);
    this.addSql(`drop table if exists "athletes_positions" cascade;`);
    this.addSql(`drop table if exists "athletes_teams" cascade;`);
  }

}
