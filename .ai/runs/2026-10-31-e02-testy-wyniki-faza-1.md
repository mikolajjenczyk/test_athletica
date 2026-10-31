# E02 faza 1 — katalog testów, „Tryb boisko”, widok testu

Source doc: .ai/specs/2026-10-28-e02-testy-i-wyniki.md
Base branch: chore/configure-agent-pipeline (decyzja użytkownika 2026-10-31: tam jest moduł `athletes` i zweryfikowana faza 1 E06; `main` ich nie ma; tak jak PR #27)
Engine: om-auto-create-pr (steps: 11, --loop: no)

## Goal

Trener prowadzi test drużyny na telefonie w „Tryb boisko” (tylko z połączeniem), wynik to najlepsza ważna próba z jednostką i znakiem „sprawdź”, a widok testu i serwis `athletesTestResultsService` pokazują wyniki z datą, jednostką, stanem luki i „Brak wcześniejszego pomiaru”; każdy klub ma katalog 12 testów z szablonu, tylko do odczytu w MVP.

## Scope

- Spec Phase 1: REQ-001…REQ-006, REQ-010 (stany luk przy wpisie), REQ-013; AC-001…AC-006, AC-010, AC-013; TEST-001…TEST-006, TEST-010, TEST-012, TEST-013.
- Moduł `src/modules/athletes/` (ten sam co E06): encje, szablon, subskrybent, setup, ACL, komendy, trasy, serwis w DI, strony, i18n.
- Testy: jednostkowe w `src/modules/athletes/**/__tests__/`, integracyjne w `.ai/qa/tests/athletes/TC-ATH-005…`.

## Non-goals

- Faza 2 (korekty, wyniki nadrobione, testy indywidualne, import CSV) i faza 3 (terminy, liczniki) — bramki: E01 faza 1, E06 faza 2.
- Edycja katalogu przez administratora (po MVP, Q-006).
- Tryb offline (zastąpione D349/NFR-005 — decyzja ostateczna).
- Pulpit („Test w trakcie” na Pulpicie należy do SPEC 7; tu tylko na stronie zestawu testów).

## Implementation Plan

### Phase 1: Katalog testów i „Tryb boisko”

1. Encje `athletes_test_definition`, `athletes_test_session`, `athletes_test_trial`, `athletes_test_result` + migracja (`yarn db:generate`, przegląd, bez stosowania) + szablon `lib/testTemplate.ts` (12 testów z prototypu, progi puste — Q-005).
2. Kopia szablonu: subskrybent `directory.organization.created` i `seedDefaults` (idempotentnie po `(org, template_key)`).
3. Funkcje ACL `athletes.tests.view`, `athletes.tests.record` + szablony ról (trener: view+record; dyrektor i administrator: view).
4. Walidatory i komendy: start sesji (jedna `open` na drużynę i test; daty D162/D307), zapis prób zawodnika (najlepsza próba R02, stany luk R12, powód bez danych o zdrowiu, klucz idempotencji), zakończenie sesji z podsumowaniem (D202); undo; zdarzenia `athletes.test_session.*`, `athletes.test_result.recorded`.
5. Trasy: `GET /api/athletes/test-definitions`, `GET /api/athletes/options/tests`, `POST /api/athletes/test-sessions`, `POST /api/athletes/test-sessions/finish`, `POST /api/athletes/test-results/record`, `GET /api/athletes/test-results` (bez powodów dla samego `.view`) + OpenAPI.
6. `athletesTestResultsService` w DI: historia zawodnika/drużyny, „sprawdź” (> 10% od ostatniego wyniku lub innej próby, D372), „Brak wcześniejszego pomiaru”.
7. Strona „Zestaw testów” (`/backend/athletes/tests`, tylko odczyt, „Test w trakcie · Wróć do testu”, „Rozpocznij test”) i „Rozpocznij test” (`/backend/athletes/tests/start`).
8. „Tryb boisko” (`/backend/athletes/tests/field/[sessionId]`): duża klawiatura 48 px, powody jako przyciski, „Dalej”, blokada bez połączenia, „Zakończ test” z podsumowaniem.
9. Widok testu (`/backend/athletes/tests/[definitionId]`, tylko odczyt).
10. i18n pl/en dla nowych tekstów.
11. Testy: jednostkowe (komendy, serwis, szablon) i integracyjne TC-ATH-005…TC-ATH-008 (TEST-001…006, 010, 012, 013).

## Risks

- `athletes.tests.*` to nowe funkcje ACL — istniejące role klubowe dostaną je przez `defaultRoleFeatures` dopiero po `yarn mercato auth sync-role-acls` (lub setup) w istniejących tenantach.
- Szablon testów tymczasowy (Q-005, Q60) — treść podmieniana później po `template_key`.
- Brak offline: bez zasięgu trener wraca do kartki (świadoma decyzja).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Katalog testów i „Tryb boisko”

- [x] 1.1 Encje, migracja i szablon testów — 191c3c1
- [x] 1.2 Kopia szablonu do klubów (subskrybent, seedDefaults) — a834c24
- [ ] 1.3 Funkcje ACL i role
- [ ] 1.4 Walidatory i komendy sesji oraz wyników
- [ ] 1.5 Trasy API i OpenAPI
- [ ] 1.6 Serwis athletesTestResultsService
- [ ] 1.7 Strony „Zestaw testów” i „Rozpocznij test”
- [ ] 1.8 Strona „Tryb boisko”
- [ ] 1.9 Widok testu
- [ ] 1.10 Tłumaczenia pl/en
- [ ] 1.11 Testy jednostkowe i integracyjne
