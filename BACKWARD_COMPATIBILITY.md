# Backward compatibility

This file lists what **my-om-app** treats as a protected contract surface and how changes to each must be handled. Review skills check diffs against it; implementation skills warn before a change violates it.

It covers the surfaces **this application owns** — code under `src/modules/<id>/` with `from: '@app'`, and app-level configuration. The installed Open Mercato framework's own contracts (auto-discovery conventions, type interfaces, import paths, generated registries, DI names of installed modules) are defined upstream in [`.ai/guides/upstream/BACKWARD_COMPATIBILITY.md`](.ai/guides/upstream/BACKWARD_COMPATIBILITY.md); the app must consume those contracts as published and never patch them (`node_modules/`, `.mercato/generated/**` are read-only). Where the two files overlap, the upstream classification applies.

Changing only tenant/organization scoping is not by itself a contract change.

## Change protocol

1. **Additive by default.** Add new routes, fields, IDs, and columns alongside the old ones instead of renaming or removing.
2. **Deprecate before removing.** Mark the old surface `@deprecated` (JSDoc, OpenAPI `deprecated: true`, or a comment next to the ID) with the replacement, and keep it working for at least one release of this app.
3. **Migrate data, not just code.** A removed or renamed persisted identifier (feature ID, event ID, column) ships with a data migration.
4. **Document it.** The PR body has a "Backward compatibility" section naming the surface, the classification below, and the migration path. A change that alters a contract surface needs a covering spec in `.ai/specs/` with a "Migration & Backward Compatibility" section.
5. **Security exception.** When the surface itself is the vulnerability, the upstream Emergency Security Exception applies: steps 1–2 may be skipped, step 4 may not, and a maintainer signs off by name.

## Protected surfaces

| Surface | Where it lives | Classification | Breaking change | Required path |
|---|---|---|---|---|
| Module IDs | `src/modules.ts` entries with `from: '@app'`, module folder names | FROZEN | Renaming or removing an enabled module ID | New module + data migration; never rename in place |
| API routes and response shapes | `src/modules/<id>/api/**` (+ `openApi` exports), `src/app/api/**` | STABLE | Removing/renaming a route, method, or response field; narrowing a field's type; making an optional request field required | Add a new field or route; deprecate the old one in OpenAPI; remove after one release |
| Database schema | `src/modules/<id>/data/entities.ts`, `src/modules/<id>/migrations/**` | ADDITIVE-ONLY | Dropping/renaming a column or table, narrowing a type, adding a non-null column without default, editing a shipped migration | New migration only; add with default, backfill, then deprecate; never edit a shipped migration |
| Event IDs and payloads | `src/modules/<id>/events.ts` (e.g. `example.todo.created`) | FROZEN (IDs), ADDITIVE (payload) | Renaming/removing an event ID; removing or retyping a payload field | Emit the new event alongside the old one; add payload fields only |
| ACL feature IDs | `src/modules/<id>/acl.ts`, grants in `setup.ts` | FROZEN | Renaming/removing a feature ID, changing `dependsOn` so existing grants lose access | New ID + data migration of role grants |
| Notification type IDs | `src/modules/<id>/notifications.ts` | FROZEN | Renaming/removing a type ID | New type; keep handlers for the old one until stored notifications age out |
| Widget/injection spot, `DataTable` `extensionTableId`, `CrudForm` entity, enricher, and search entity IDs | `src/modules/<id>/widgets/**`, `extension-points.ts`, `search.ts`, backend pages | FROZEN | Renaming/removing an ID or narrowing its context | Add the new ID and keep the old one registered |
| DI service names | `src/modules/<id>/di.ts`, `src/di.ts` | STABLE | Renaming/removing a registration or changing its interface incompatibly | Register the new name; keep the old as an alias |
| AI agent, tool, and UI part IDs | `src/modules/<id>/ai-agents.ts`, `ai-tools.ts`, `agents/**` | FROZEN (IDs), STABLE (input schemas) | Renaming/removing an ID; making a tool input required or narrower | New ID or optional input; deprecate the old one |
| Workflow and activity IDs | `src/modules/<id>/workflows.ts` | FROZEN | Renaming/removing an ID that running instances reference | New ID; keep the old definition until in-flight instances finish |
| CLI commands and flags | `src/modules/<id>/cli.ts`, `package.json` scripts used by docs/CI (`generate`, `db:*`, `test:*`, `mercato`) | STABLE | Removing/renaming a command or flag, changing its default behavior | Keep the old name as an alias with a deprecation message |
| Page URLs | `src/modules/<id>/backend/**`, `frontend/**`, `src/app/**` | STABLE | Removing/renaming a user-reachable URL | Redirect from the old URL |
| Configuration and environment | `.env` keys read by the app (e.g. `OM_ENABLE_ENTERPRISE_MODULES*`), `docker-compose*.yml`, `railway*.toml` | STABLE | Removing/renaming an env var or changing its default meaning | Read both names during a transition; document it in the PR |
| Translation keys | `src/modules/<id>/i18n/<locale>.json` | ADDITIVE | Removing a key still referenced by code or another module's override | Remove only unused keys |

## Not a contract

- Internal helpers under `src/modules/<id>/lib/**` that no other module imports.
- Example and demo modules not enabled in `src/modules.ts` (currently `example`, `example_customers_sync`, `ratelimit_probe`); they become contracts the moment they are enabled.
- Test fixtures, `.ai/**` agent tooling, and generated files (regenerate them; do not version-manage them by hand).
