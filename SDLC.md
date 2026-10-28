# Software delivery process

## Purpose

This file documents how work flows from ticket to merged PR in this repository. The agent skills configured in `.ai/agentic.config.json` enforce the process; humans read it here. PRs target `main`; issues and PRs live in github, with every tracker operation the skills run defined in `.ai/trackers/github.md` (edit that file to extend or override tracker behavior).

Work enters through two paths: a free-form task brief handed to an agent, or a filed ticket. Both converge on the same review loop, the same validation gate, and the same merge gates.

Before intake, the work is shaped: `om-brainstorm` turns a single idea or question into a routing decision and a brief, and the spec skills (`om-spec-writing`, `om-auto-write-spec`) turn a feature into a design document in `.ai/specs` before anything is built. Those steps feed the table below; they are not the ticket flow itself. The spec gate in `AGENTS.md` (Axis 3) decides when a spec is required.

## Roles

- **Author** — the human or agent who writes the change. Owns the ticket from claim to a merge-ready PR.
- **Reviewer** — reads the diff and approves or requests changes. May be a human or the `om-auto-review-pr` skill; the `om-code-review` checklist, `CODE_REVIEW.md`, and `.ai/review-checklist.md` apply either way. The reviewer is also the second person a high-risk change needs and signs off the spec when a feature requires one; a team that names a tech lead or an architect puts them here.
- **Designer** — owns the flow and its states before the code exists, and the design contract the UI review reads back. May be a human, `om-ux-shape` for shaping, `om-ux-design` for detailed screens from a specification, or `om-ux-review-pr` for the pass over a PR's screens.
- **Maintainer** — owns branch protection, the config, this document, and the installed skills with their repo-local overrides under `.ai/skills/`; arbitrates when gates conflict. Acts as the release manager unless the team names one.

## Ticket lifecycle

| Stage | What happens | Driven by | Done when |
|---|---|---|---|
| Discovery | An idea, question, or itch is talked through before any artifact exists: the problem is questioned, alternatives (including building nothing) are weighed, and the conversation ends in a routing decision — an answer, a filed ticket, a brief for a spec, or a direct change. | `om-brainstorm` or a human | Conversation routed; a brief written when the work continues |
| Intake | A ticket or task brief is filed in github with enough detail to act on: what is wrong or wanted, for whom, and what done looks like. `om-prepare-issue` files it. | Anyone, `om-prepare-issue` | Ticket exists |
| Triage | Confirm the issue is real, still unfixed on `main`, and not already claimed or covered by an open PR. Read-only; stops the chain cleanly when there is nothing to do. | `om-verify-in-repo` or a human | Confirmed actionable, or closed as no-action |
| Claim | The author claims the ticket so concurrent agents back off. See the claim protocol below. | `om-fix` / `om-auto-create-pr`, or a human | Claim visible on the ticket |
| Design | For a user-facing change, the flow and its states are settled before the code exists: what the screen does when empty, loading, in error, and without permission, and what the change deliberately does not do. Detailed screens may be designed from the specification with repository components; only an accepted version becomes its `Prototype:` reference. A ticket that touches no UI skips this stage. | `om-ux-shape`, optionally `om-ux-design` when chosen, or a human designer | The flow and its states are decided, or the ticket is not user-facing |
| Implement | Locate the minimal change surface (`om-root-cause`, read-only), then implement the change with regression tests and run the validation gate. Task briefs without a ticket go through `om-auto-create-pr`, which plans, implements phase by phase in an isolated worktree, and runs the same gate. | `om-root-cause` + `om-fix`, `om-auto-create-pr`, or a human author | Change complete, validation gate green |
| PR | Commit, push, and open a PR against `main`. On a hand-worked branch, `om-check-and-commit` runs the gate, fixes obvious drift, and pushes when green. | `om-open-pr`, `om-auto-create-pr`, or `om-check-and-commit` | Open PR |
| Review loop | The reviewer reads the diff against the `om-code-review` checklist and approves or requests changes. Requested changes are addressed (`om-auto-continue-pr` resumes agent PRs from the tracking plan, and adopts a PR that has none by reconstructing the plan from the PR's own context) and the PR is re-reviewed until approved. A user-facing change also gets a design pass: `om-ux-review-pr` walks the changed screens and reports findings ranked by user impact. That pass is advisory — it informs the review, it does not hold the merge. | `om-auto-review-pr` (single PR), `om-review-prs` (sweep), `om-ux-review-pr` (design pass), or a human | Approving review submitted |
| Merge | `om-merge-buddy` reports, read-only, which PRs can merge now and which are close but blocked. `om-approve-merge-pr` re-checks every gate, approves, and squash-merges. | `om-merge-buddy` + `om-approve-merge-pr`, or a human | PR squash-merged into `main` |
| Post-merge housekeeping | Close issues the merged PR fixes; comment on issues whose PRs were closed without merging; turn leftover asks or review comments into tracked follow-up issues. | `om-close-fixed-issues`, `om-followup-issue-from-pr` | Tracker reconciled, follow-ups filed |

After merge, this process stops. Deployment, smoke tests, monitoring, and rollback belong to the repository's release process (Railway, see `railway.toml`), not to this document: the Maintainer — or a release manager, when the team names one — drafts the changelog with `om-auto-update-changelog` and reconciles the tracker with `om-close-fixed-issues`, and `om-pipeline-retro` reads finished runs to rank what second passes cost. Merge is where this document ends; delivering the change to users is a separate process the team owns.

## Labels and QA

Pipeline labels are **disabled** in this repository (`labels.enabled: false`) and the QA gate is **off** (`qaGate: false`). Skills skip every label operation and say so in their PR summaries; PR state is read from reviews, CI, and comments instead. Manual QA of user-facing changes is still welcome — `om-prepare-test-env` boots the app and `om-auto-qa-pr` walks it in a browser — but it does not gate merge. To turn either on, update `.ai/agentic.config.json` and re-run `om-setup-agent-pipeline`, which creates the label taxonomy and regenerates this section.

## The claim protocol

Before mutating an issue or PR, an agent claims it: it assigns itself and posts a claim comment saying what it is doing (the `in-progress` label is part of the claim only when labels are enabled). Any agent that finds an existing claim backs off instead of colliding.

A claim means **actively working**. Once an agent's work is finished and fully reported — review submitted, comments posted — the claim is released even if the agent still intends to report the CI outcome; watching CI is not a claim and blocks nobody, so another agent or a human may act on the PR freely.

The claim is released when the work finishes — on success and on failure alike. A stale claim with no recent activity may be cleared by the maintainer.

### Reporting is decoupled from CI

Agents submit reviews and post comments **as soon as their work is done**, without waiting for CI to go green. A review submitted while checks are still running says so in its body: branch protection holds the actual merge, and the approval covers the code, not a green run. The CI outcome arrives afterwards as a follow-up comment.

The wait for that outcome is bounded by `ci.maxWaitMinutes` (40). When it expires with checks still running, the agent stops waiting, runs the local validation gate as its own evidence, posts that together with the still-pending check names and an explicit statement that no further follow-up is coming, and finishes.

A red signal does not short-circuit the review either. A failing required check or a conflicted head is collected as a **blocker finding** and reported together with the full code review, never instead of it. Such a verdict is still "changes requested" — completeness changed, the gate did not.

None of this touches the merge gates. Reporting early is safe; merging early is not — required checks still gate every merge, and the merge tooling refuses until they are genuinely green.

## The automation contract

The `om-auto-*` skills run this process unattended and are chainable: each accepts the artifact the previous one produced (an issue id, a spec path, or a PR number from the `PR: #<number> (link: <url>)` reference line every PR-producing skill emits), and each detects work already started — an open PR referencing the issue or plan — and continues on it rather than opening a duplicate. A completed autonomous run leaves a **ready** (non-draft) PR with a run-summary comment and, for user-facing changes, screenshots from the working app attached as PR evidence. Draft PRs are reserved for explicitly incomplete states: spec-only design PRs, interrupted hand-offs, or autonomous defaults flagged for human confirmation.

## Validation gate

Every PR passes the full validation gate before review sign-off, in this order:

- `yarn generate`
- `yarn typecheck`
- `yarn lint`
- `yarn ds:check`
- `yarn test`
- `yarn build`

Any non-zero exit fails the gate and blocks the PR. The implementing skills run the gate before opening a PR, and `om-check-and-commit` runs it before pushing a hand-worked branch. Integration coverage runs separately with `yarn test:integration:ephemeral`. Migrations are never applied to validate a change. The command list lives in `.ai/agentic.config.json`; when it changes, update it there and in this section together.

## Amending this process

This document and `.ai/agentic.config.json` describe the same process: change them together, and re-run the `om-setup-agent-pipeline` skill when the toolchain or label taxonomy changes.

The design contract the Design and Review stages read is set up once: `om-ux-setup` extracts it from the repository and is re-run when the design system changes.

Per-skill deviations — extra review rules, a different PR body template, an added gate step — belong in a repo-local skill of the same name at `.ai/skills/<skill-name>/SKILL.md`, which takes precedence over the installed skill (and can `@`-import or reference it to extend rather than replace it); local rules win, but a repo-local skill cannot grant what the installed skill's safety rules forbid.
