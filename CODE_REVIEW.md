# Code review rules

These are the review rules for **my-om-app**, a standalone Open Mercato application (Next.js App Router, TypeScript, MikroORM, Jest + Playwright, Yarn). `om-code-review` (and therefore `om-auto-review-pr`) applies this file automatically, together with its built-in checklist and the module checklist in [`.ai/review-checklist.md`](.ai/review-checklist.md). This file sets priorities and severity; the module checklist holds the detailed per-surface checks — do not duplicate them here, extend them there.

## Review priorities

Review in this order and stop treating lower tiers as blockers once a higher tier fails:

1. **Tenant isolation and security.** Every read and write is scoped by a trusted `tenantId` + `organizationId` derived from the request context, never from the payload; missing scope fails closed. Only an installed contract may use system scope (`organizationId: null`). Server-side authorization uses ACL feature IDs (`requireFeatures`, per-method route `metadata`), never role-name checks or UI-only hiding. No secrets, transcripts, ciphertext, or plaintext PII in responses, logs, events, or indexes.
2. **Correctness and data integrity.** Domain writes go through commands with undo; side effects (events, cache invalidation, indexing, queues, external calls) happen after commit. Editable records expose `updatedAt` and enforce optimistic locking end to end, including a surfaced 409. Races use a constraint, lock, or atomic claim — never check-then-create.
3. **Contracts.** Any change to a surface listed in [`BACKWARD_COMPATIBILITY.md`](BACKWARD_COMPATIBILITY.md) follows its required path. An unflagged break is a blocker.
4. **Completeness of the vertical slice.** A changed module is reviewed as a whole slice — entity, validator, command, API route + `openApi`, ACL/setup, page/navigation, i18n, tests — not file by file.
5. **Quality and consistency.** Design system, localization, accessibility states, readability.

## Repo-specific checks

- **Module layout.** App code lives in `src/modules/<id>/`; entities only in `src/modules/<id>/data/entities.ts`; modules are activated in `src/modules.ts` with `from: '@app'`.
- **No cross-module ORM relations.** Link to other modules (including installed `@open-mercato/*` modules) by scalar IDs, snapshots, events, enrichers, extensions, or optional DI.
- **Framework primitives over hand-rolled code.** Use `makeCrudRoute`, commands, `CrudForm`, `DataTable`, DI, events, and UMES extension points. Raw admin `fetch`/`<form>`, ad hoc crypto, cache, or queues, and direct mutations where a helper exists are findings.
- **API routes** export per-method `metadata` and an `openApi` definition; validators (zod) cover every query/body trust boundary and never accept `tenantId`/`organizationId` from the client.
- **Generated and vendored files are read-only.** Any diff in `.mercato/generated/**`, `node_modules/`, or an already-shipped migration is a blocker. Discovery changes (routes, pages, events, widgets, agents, tools, workflows, `src/modules.ts`) must be accompanied by `yarn generate` output.
- **Migrations.** Produced by `yarn db:generate`, scoped to the intended change, with a matching snapshot; additive only (see `BACKWARD_COMPATIBILITY.md`). The PR states that they were reviewed and not applied as part of validation.
- **Strings and colors.** Every user-visible string goes through module `i18n/<locale>.json`; no hard-coded status colors or raw palette values — use shared UI and semantic tokens. `yarn ds:check` must pass.
- **UI states.** New or changed pages cover loading, empty, error, permission-denied, validation, conflict, and keyboard/a11y behavior.
- **Tests.** New behavior ships with Jest coverage (allowed/denied ACL, two tenant scopes, stale version where applicable); user flows worth keeping get Playwright coverage under `.ai/qa/tests`.
- **Lessons.** When a change touches an area tagged in `.ai/lessons.md`, check the change against the matching lesson.

## Validation gate

The PR must pass, in order: `yarn generate`, `yarn typecheck`, `yarn lint`, `yarn ds:check`, `yarn test`, `yarn build`. A red gate is a blocker finding reported together with the full review, not instead of it.

## Severity

| Severity | Use for | Effect |
|---|---|---|
| **Blocker** | Tenant leak or missing scope, broken authorization, secret exposure, data loss/corruption, unflagged contract break, edited generated/shipped files, red validation gate | Request changes; must be fixed before merge |
| **Major** | Missing command/undo/optimistic-lock path, side effects before commit, missing migration or `yarn generate`, missing tests for new behavior, missing UI states or i18n on a user-facing change | Request changes |
| **Minor** | Inconsistency with surrounding code, naming, small design-system drift, incomplete edge-case tests | Comment; may merge with a follow-up |
| **Nit** | Style or wording preferences | Optional; never blocks |

Every finding names the file and line, the concrete failure scenario, and the expected fix. Nits and minors left unaddressed become follow-up issues via `om-followup-issue-from-pr` rather than extra review cycles.
