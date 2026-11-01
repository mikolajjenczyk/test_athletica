import { Migration } from '@mikro-orm/migrations';

export class Migration20261101070919_athletes extends Migration {

  override name = 'Migration20261101070919';

  override up(): void | Promise<void> {
    this.addSql(`create table "athletes_daily_imports" ("id" uuid not null default gen_random_uuid(), "kind" text not null, "team_id" uuid not null, "file_name" text not null, "file_hash" text not null, "period_from" date not null, "period_to" date not null, "saved" int not null default 0, "corrected" int not null default 0, "unchanged" int not null default 0, "rejected" int not null default 0, "assigned_names" int not null default 0, "rejected_rows" jsonb not null, "undo_state" jsonb null, "imported_by_user_id" uuid null, "undone_at" timestamptz null, "undone_by_user_id" uuid null, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "athletes_daily_imports_hash_idx" on "athletes_daily_imports" ("tenant_id", "organization_id", "file_hash");`);
    this.addSql(`create index "athletes_daily_imports_kind_idx" on "athletes_daily_imports" ("tenant_id", "organization_id", "kind", "created_at");`);

    this.addSql(`create table "athletes_training_sessions" ("id" uuid not null default gen_random_uuid(), "player_id" uuid not null, "session_date" date not null, "session_no" int not null, "kind" text null, "minutes" int null, "rpe" int null, "previous_minutes" int null, "previous_rpe" int null, "corrected_at" timestamptz null, "import_id" uuid not null, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "athletes_training_sessions_import_idx" on "athletes_training_sessions" ("tenant_id", "organization_id", "import_id");`);
    this.addSql(`create index "athletes_training_sessions_date_idx" on "athletes_training_sessions" ("tenant_id", "organization_id", "session_date");`);
    this.addSql(`create index "athletes_training_sessions_player_idx" on "athletes_training_sessions" ("tenant_id", "organization_id", "player_id", "session_date");`);

    // One live session per (club, player, date, session number) — REQ-003; undo soft-deletes inserted rows.
    this.addSql(`create unique index "athletes_training_sessions_key_uq" on "athletes_training_sessions" ("tenant_id", "organization_id", "player_id", "session_date", "session_no") where "deleted_at" is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "athletes_training_sessions" cascade;`);
    this.addSql(`drop table if exists "athletes_daily_imports" cascade;`);
  }

}
