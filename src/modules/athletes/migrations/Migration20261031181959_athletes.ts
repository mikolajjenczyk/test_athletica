import { Migration } from '@mikro-orm/migrations';

export class Migration20261031181959_athletes extends Migration {

  override name = 'Migration20261031181959';

  override up(): void | Promise<void> {
    this.addSql(`create table "athletes_test_definitions" ("id" uuid not null default gen_random_uuid(), "template_key" text not null, "name" text not null, "variant" text null, "unit" text not null, "direction" text not null, "attempts" int not null, "counting_rule" text not null default 'best', "clear_change_threshold" numeric(12,4) null, "threshold_source" text null, "repeat_every_weeks" int not null default 6, "sort_order" int not null default 0, "is_active" boolean not null default false, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "athletes_test_definitions_scope_idx" on "athletes_test_definitions" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "athletes_test_definitions" add constraint "athletes_test_definitions_template_key_uq" unique ("tenant_id", "organization_id", "template_key");`);

    this.addSql(`create table "athletes_test_results" ("id" uuid not null default gen_random_uuid(), "session_id" uuid not null, "player_id" uuid not null, "test_definition_id" uuid not null, "tested_on" date not null, "value" numeric(12,4) null, "state" text not null, "reason_code" text null, "is_makeup" boolean not null default false, "counts_in_team_average" boolean not null default true, "corrected_at" timestamptz null, "idempotency_key" text not null, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "athletes_test_results_history_idx" on "athletes_test_results" ("tenant_id", "organization_id", "player_id", "test_definition_id", "tested_on");`);
    this.addSql(`alter table "athletes_test_results" add constraint "athletes_test_results_idempotency_uq" unique ("tenant_id", "organization_id", "idempotency_key");`);

    this.addSql(`create table "athletes_test_sessions" ("id" uuid not null default gen_random_uuid(), "test_definition_id" uuid not null, "kind" text not null, "team_id" uuid null, "player_id" uuid null, "tested_on" date not null, "status" text not null default 'open', "finished_at" timestamptz null, "started_by_user_id" uuid null, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "athletes_test_sessions_definition_idx" on "athletes_test_sessions" ("tenant_id", "organization_id", "test_definition_id", "tested_on");`);

    this.addSql(`create table "athletes_test_trials" ("id" uuid not null default gen_random_uuid(), "session_id" uuid not null, "player_id" uuid not null, "attempt_no" int not null, "value" numeric(12,4) null, "is_invalid" boolean not null default false, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "athletes_test_trials_session_idx" on "athletes_test_trials" ("tenant_id", "organization_id", "session_id", "player_id");`);

    // One open session per team and test (spec E02); the start command returns it instead of a second.
    this.addSql(`create unique index "athletes_test_sessions_one_open_uq" on "athletes_test_sessions" ("tenant_id", "organization_id", "team_id", "test_definition_id") where "status" = 'open' and "deleted_at" is null;`);
    // One live result per (session, player) and one live trial per attempt; undo soft-deletes them.
    this.addSql(`create unique index "athletes_test_results_session_player_uq" on "athletes_test_results" ("tenant_id", "organization_id", "session_id", "player_id") where "deleted_at" is null;`);
    this.addSql(`create unique index "athletes_test_trials_attempt_uq" on "athletes_test_trials" ("tenant_id", "organization_id", "session_id", "player_id", "attempt_no") where "deleted_at" is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "athletes_test_trials" cascade;`);
    this.addSql(`drop table if exists "athletes_test_results" cascade;`);
    this.addSql(`drop table if exists "athletes_test_sessions" cascade;`);
    this.addSql(`drop table if exists "athletes_test_definitions" cascade;`);
  }

}
