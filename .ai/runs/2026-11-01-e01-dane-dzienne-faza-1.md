# E01 faza 1 — wgrywanie pliku RPE

Source doc: .ai/specs/2026-10-31-e01-dane-dzienne-zawodnikow.md
Base branch: chore/configure-agent-pipeline (decyzja użytkownika: tam jest moduł `athletes`; jak PR #27 i #28)
Engine: om-auto-create-pr (steps: 9, --loop: no)

## Goal

Trener wgrywa plik RPE (`.xlsx` lub `.csv`) ze swojego komputera, widzi przed zapisem odczytane sesje, braki („Brak RPE”), korekty i odrzucone wiersze, łączy nieznane nazwiska z niedopasowanymi zawodnikami drużyny i zapisuje dane bez duplikatów, z historią importów i cofnięciem ostatniego importu.

## Scope

- Spec Phase 1: REQ-001…REQ-004, REQ-007 (RPE), REQ-011, REQ-013 (zdarzenie `athletes.daily_import.committed`, wspólny komponent podglądu importu — właściciel), REQ-014; AC-001…AC-004, AC-007, AC-011, AC-013 (część), AC-014; TEST-001…TEST-004, TEST-006 (RPE), TEST-010, TEST-011, TEST-013 (import i undo).
- Moduł `src/modules/athletes/`; nowa zależność `exceljs` (zatwierdzona przez użytkownika 2026-11-01).
- Decyzja A (2026-10-31): administrator klubu jest nadzbiorem ról trenera i dyrektora — dostaje te same funkcje `athletes.daily.*` co trener.

## Non-goals

- Faza 2 (ankiety samopoczucia, szyfrowanie odpowiedzi, `athletes.wellbeing.view`) i faza 3 (Pulpit v1, `athletesDailyService`, `MiniChart`, wejścia na Pulpit).
- Aliasy nazwisk między importami (decyzja Q4); kolumny tekstowe z pliku (Q5).
- Przeniesienie importu CSV testów (E02 faza 2) na wspólny komponent — zrobi to E02 faza 2.

## Implementation Plan

### Phase 1: Wgrywanie pliku RPE

1. Zależność `exceljs` i parser plików (`lib/dailyFileParser.ts`): `.xlsx` (tylko wartości komórek, pierwszy arkusz) i `.csv` (`;`/`,`, UTF-8), nagłówki z prototypu + synonimy, limity 2 MB / 5000 wierszy, ochrona przed formułami i zip-bomb.
2. Encje `athletes_training_session`, `athletes_daily_import` + migracja (`yarn db:generate`, przegląd, bez stosowania).
3. Funkcje ACL `athletes.daily.import`, `athletes.daily.view` + szablony ról (trener; administrator klubu jako nadzbiór).
4. Logika podglądu: dopasowanie nazwisk w drużynie (normalizacja jak w E02), sesje drużyny i „Brak RPE”, korekty, odrzucenia z numerem i powodem, nieznane nazwiska.
5. Komenda `athletes.daily_import.commit` (atomowo, idempotentnie po kluczu (zawodnik, data, numer sesji), korekty z `previous_*`, przypisania nazwisk z walidacją, undo ostatniego importu) + zdarzenie `athletes.daily_import.committed`.
6. Trasy z `metadata` + OpenAPI: `POST /api/athletes/daily-imports/preview`, `POST /api/athletes/daily-imports/commit`, `POST /api/athletes/daily-imports/undo`, `GET /api/athletes/daily-imports`, `GET /api/athletes/training-sessions` (obciążenie wyliczane).
7. Wspólny komponent podglądu importu (miejsce na panel dodatkowy) i `NameAssignmentPanel`; strona `/backend/daily/import?kind=rpe` (tylko komputer).
8. Strona „Dane dzienne” (`/backend/daily`): zakładka RPE i historia importów z cofnięciem; i18n pl/en.
9. Testy jednostkowe i integracyjne (TEST-001…004, 006 RPE, 010, 011, 013).

## Risks

- Układ kolumn arkuszy klienta nieznany (D301) — nagłówki z prototypu + synonimy; prawdziwy tydzień (A07) do odbioru.
- Nowa zależność `exceljs` — tylko odczyt wartości, limity rozmiaru.
- Istniejące tenanty dostaną nowe funkcje ról po `yarn mercato auth sync-role-acls`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Wgrywanie pliku RPE

- [ ] 1.1 Zależność exceljs i parser plików
- [ ] 1.2 Encje i migracja
- [ ] 1.3 Funkcje ACL i role
- [ ] 1.4 Logika podglądu importu
- [ ] 1.5 Komenda zapisu importu, undo i zdarzenie
- [ ] 1.6 Trasy API i OpenAPI
- [ ] 1.7 Komponent podglądu, przypisanie nazwisk i strona importu
- [ ] 1.8 Strona „Dane dzienne” i tłumaczenia
- [ ] 1.9 Testy jednostkowe i integracyjne
