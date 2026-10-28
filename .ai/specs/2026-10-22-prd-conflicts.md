# Conflicts found while writing the PRD of 22.10

Companion file to `2026-10-22-prd.md`. It lists every contradiction found across the brief, the decision files, the canvas, the client material, the paused specs, the talk tracks and the code branches.

The rule applied to each one: a later decision wins over an earlier one it contradicts, and a numbered decision wins over brief or canvas prose. A client wish counts as a client decision only when the client wrote or said it as one. When the rule does not settle a conflict, it is marked **Tom** or **client**.

## Settled by the rule

| # | Topic | Earlier source | Later source that wins |
|---|---|---|---|
| C1 | Wellbeing in the first version | D236, D241 „po MVP”; canvas MoSCoW "Could"; talk track v2 | D286, D332, D345: in, coach only |
| C2 | Wellbeing scale | D286, D345 "1–5 for all six"; brief N17; client brief §6.6 | D353: the sheet's own scales, sleep in hours |
| C3 | RPE scale | 14.10 page "1–10 per day" | D334: 0–10 per session (the client to confirm, because the founder said 1–10 on 21.10) |
| C4 | Players' files | D208, D282 upload only; canvas "one file per player" | D335 automatic read with upload as fallback; D301 one file per team |
| C5 | Season goal | D227, N12 „po MVP”; talk track v2 | D336: a simple „Plan sezonu” in the first version |
| C6 | Pulpit order | D201, D229 tasks first; client notes of 20.10; talk track v2 | D285, D308, D389: daily data first, then „Zwróć uwagę”, then „Testy” |
| C7 | Name of the AI text | „Wskazówki” (D328, D330f, D283's legend) | D339: „Obserwacje AI” everywhere |
| C8 | Accepting AI text | D265: one decision for the whole reading | D375, D376: one per observation; D366: reasons optional |
| C9 | Training ideas in notes | D356, R28: a list for the coach | D368: no filter; ordinary notes |
| C10 | AI lines on the Pulpit | D354: 1–3 lines | D366: only what the row does not already say, at least two sources; D385: placed under the row |
| C11 | „Wynik nieporównywalny” | D194, D248: in the first version | D260: one method per test, no marking |
| C12 | CMJ name | D380 „z zamachem ramion” | D392 „z rękami na biodrach” |
| C13 | Results export | brief: PDF only (Q86 open) | D350: CSV/Excel as „wkrótce”, low priority |
| C14 | PDF | `user-jobs.md` and D21: no PDF | D173: PDF of an approved report |
| C15 | Report preview of the template | D172 | D224: removed |
| C16 | CSV import in the lo-fi | D78: a fake popup | D177, D266, D271: real import with a preview |
| C17 | Morning survey rule | D316: the first survey of the day | D330g: marked morning or answered before 12:00 |
| C18 | „Rytm testów” | glossary and J20: out of the MVP | D256: a read-only view in the MVP |
| C19 | Default period | D32 „Cała historia” | D163: the Pulpit shows the last 6 months |
| C20 | Paused spec 1 and draft PRs #5 and #6 | reopen, a fixed 42-day retest, „Otwórz test”, „Termin minął”, admin-editable thresholds, internet required, an injury carried to the next test | D60, D61, D71, D99, D160, D169, D253, D349. The PRs need rework |
| C21 | Absence reasons for the director | spec 1, spec 4 | D69, D109, D264 |
| C22 | `parental_consent_at` field in the phase 1 code | spec 1 | D332: consent is the club's matter. The field can go |
| C23 | Real-coach tests | brief "Next": a test with 2–3 outside people | D364: only after the lo-fi is complete; D384: do not wait for real data |
| C24 | Team risk | code: at least 3 players | D333: more than half of the players with data |
| C25 | Personas | canvas P56–P61 | `personas.md`, confirmed by Tom on 21.10 |
| C26 | Briefs | the AI brief of 8.10 and the manual brief of 9.10 (ids reused with other meanings) | D244: `product-brief.md` is the one brief; never merge ids by number |
| C27 | Averaged percentage | D191: removed (client note T8) | D221, D261: a labelled helper, positive means better |
| C28 | Growth | D296 „po MVP”; canvas "Won't" | D337, D393: the AI may name „okres szybkiego wzrostu” at 7 cm a year or more, with numbers |
| C29 | Colour in the lo-fi | D298: black and white | D386: Apzumi DS colours. Warning colours stay hi-fi only |

## Needs Tom (also in the PRD, Open Questions → For Tom)

| # | Topic | The two sides | My pick |
|---|---|---|---|
| T1 | AI training direction | D209 (direction plus a marked „polecane ćwiczenia” slot) against D240 (no training content). D240 names D209 as replaced, but the talk track of 21.10 told the client D209, and a memory note of Tom's still records D209 | D240 for the first version; D209 waits for Q59 |
| T2 | Smallest phone text | D322: 14 px against D387, D390: 13 px | 14 px on the phone |
| T3 | Legal review of minors' wellbeing | canvas gate against D332, D352 | Keep the review as a dependency outside the product |
| T4 | Cap on AI lines on the Pulpit | D233: 3 against D385: no cap | Keep 3 |
| T5 | A decision per observation in the lo-fi | D375, D376 against rev-050 and rev-051 („Zapisz w karcie / Ukryj na dziś”) | Keep D375, D376 |
| T6 | The administrator's start page | platform-primitives spec: „Pulpit” against D204 and the flow audit: „Profil klubu” | „Profil klubu” |
| T7 | Club scope for invited users | D33: an operator sets it by hand, against R07: the administrator invites | A technical decision when the specs restart |
| T8 | Records | D154: only above the threshold, against D273: any better result (Q54) | Ask the client |
| T9 | „Rozwój” on the player card | D199 „Dziś” and „Rozwój”, against rev-051 tabs Dziś · Wyniki · Porównania · Sesje · … | Read „Rozwój” as covered by „Wyniki”; confirm |
| T10 | Retest rhythm | D71: 7 and 8 weeks, against the founder: about 6 weeks | Keep „Powtarzaj co” per test; ask the client for values |

## Needs the client

| # | Topic | Detail |
|---|---|---|
| K1 | The deck's scope against the first version | percentiles, athlete and parent reports and accounts, many teams, full security (deck p.7, p.8, p.12, p.18) against D206, D210, D237, D352 (A05, Q15) |
| K2 | Who sees wellbeing | D345: the director sees none, against the client brief's proposal that he sees only how many answered (Q82) |
| K3 | „Test gotowości (CMJ)” and „Notatki” | asked for on 14.10 and 21.10; kept as demos (Q80, Q84, Q88) |
| K4 | Comparison over time and a choice of period | asked for on 14.10; D211 has no period choice; „Porównania” stays a tab (D394) |
| K5 | The name „Test gotowości” | the client says „test gotowości”; the glossary bans „gotowość” except in this one name (D380, Q74) |

## Documents that lag behind the decisions

These need a refresh. None of them changes a decision.
- `product-brief.md` stops at D359. It lacks D360–D397: D368 against R28, D375 against Now 7, D385 against Now 8, D350 against Q86. Its Later list still holds "daily wellness from every player", and N17 still says 1–5.
- `current-decisions.md`: `build_current.py` marks a decision superseded whenever a later row names it, even when that row only refines or extends it. Wrongly shown as superseded: D188, D201 (partly), D210 (partly), D229, D231, D269, D272, D278, D286, D297, D302, D315, D323, D326, D336, D356, D357. Rows D309a, D330a–k and D356a are not parsed.
- `user-jobs.md`: no jobs for the RPE file, the AI decision, re-approval, the PDF or goals. It still uses „Tak zobaczy to dyrektor” and „Terminy testów”, and lists wellbeing as out of scope.
- `specs/README.md`: still says the specs are frozen and that the prototype is rev-036.
- `glossary.md`: rows for D195, D201 and D220 lag.
- Talk tracks (v2 of 21.10, and 16.10 in the worktree `lofi-rev036`): stale. Do not use them as sources.
