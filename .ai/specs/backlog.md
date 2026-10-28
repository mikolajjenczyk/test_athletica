# Backlogs

## .ai/specs/2026-10-22-prd.md
Backlog source: .ai/specs/2026-10-22-prd.md
Tracker: [mikolajjenczyk/test_athletica](https://github.com/mikolajjenczyk/test_athletica/issues)
Last filed: 2026-10-28

| Id | Issue | Title | Epic / Story | Depends on | Adopted |
|---|---|---|---|---|---|
| E01 | [#1](https://github.com/mikolajjenczyk/test_athletica/issues/1) | Dane dzienne zawodników | — | — | no |
| E02 | [#2](https://github.com/mikolajjenczyk/test_athletica/issues/2) | Testy i wyniki | — | — | no |
| E03 | [#3](https://github.com/mikolajjenczyk/test_athletica/issues/3) | Zawodnik i drużyna | — | — | no |
| E04 | [#4](https://github.com/mikolajjenczyk/test_athletica/issues/4) | Obserwacje AI i decyzje trenera | — | — | no |
| E05 | [#5](https://github.com/mikolajjenczyk/test_athletica/issues/5) | Raporty i widok dyrektora | — | — | no |
| E06 | [#6](https://github.com/mikolajjenczyk/test_athletica/issues/6) | Cele, zalecenia i klub | — | — | no |
| E07 | [#7](https://github.com/mikolajjenczyk/test_athletica/issues/7) | Później (zaparkowane) | — | — | no |
| E01-S01 | [#8](https://github.com/mikolajjenczyk/test_athletica/issues/8) | Dzienne RPE i samopoczucie z arkusza wgranego z komputera, luki nazwane przed zapisem | #1 | — | no |
| E01-S01-T01 | [#23](https://github.com/mikolajjenczyk/test_athletica/issues/23) | Format wgrywanego arkusza i jego odczyt (D301) | #8 | — | no |
| E01-S02 | [#9](https://github.com/mikolajjenczyk/test_athletica/issues/9) | Pulpit: obciążenie, samopoczucie, „Zwróć uwagę” | #1 | #8 | no |
| E02-S01 | [#10](https://github.com/mikolajjenczyk/test_athletica/issues/10) | „Tryb boisko” na telefonie, także bez zasięgu | #2 | — | no |
| E02-S02 | [#11](https://github.com/mikolajjenczyk/test_athletica/issues/11) | Poprawki, uzupełnienia, CSV, stany luk | #2 | #10 | no |
| E02-S03 | [#12](https://github.com/mikolajjenczyk/test_athletica/issues/12) | Terminy testów i brakujące wyniki | #2 | #10 | no |
| E03-S01 | [#13](https://github.com/mikolajjenczyk/test_athletica/issues/13) | Karta zawodnika: „Dziś” i własna historia | #3 | #8, #10 | no |
| E03-S02 | [#14](https://github.com/mikolajjenczyk/test_athletica/issues/14) | Strona drużyny | #3 | #13 | no |
| E04-S01 | [#15](https://github.com/mikolajjenczyk/test_athletica/issues/15) | Obserwacja AI z danymi z datami | #4 | #13 | no |
| E04-S01-T01 | [#24](https://github.com/mikolajjenczyk/test_athletica/issues/24) | Wybór dostawcy AI w UE (Q17) | #15 | — | no |
| E04-S02 | [#16](https://github.com/mikolajjenczyk/test_athletica/issues/16) | Przyjmij / popraw / odrzuć każdą obserwację | #4 | #15 | no |
| E04-S03 | [#17](https://github.com/mikolajjenczyk/test_athletica/issues/17) | Praca trenera zostaje przy awarii AI | #4 | #15 | no |
| E05-S01 | [#18](https://github.com/mikolajjenczyk/test_athletica/issues/18) | Zatwierdzenie raportu i PDF dla dyrektora | #5 | #16 | no |
| E05-S01-T01 | [#25](https://github.com/mikolajjenczyk/test_athletica/issues/25) | Wybór renderera PDF | #18 | — | no |
| E05-S02 | [#19](https://github.com/mikolajjenczyk/test_athletica/issues/19) | Widok dyrektora: stan testów i raporty | #5 | #18 | no |
| E06-S01 | [#20](https://github.com/mikolajjenczyk/test_athletica/issues/20) | Cele drużyny i „Plan sezonu” | #6 | — | no |
| E06-S02 | [#21](https://github.com/mikolajjenczyk/test_athletica/issues/21) | Zalecenia powiązane z testami i ich ocena | #6 | #10 | no |
| E06-S03 | [#22](https://github.com/mikolajjenczyk/test_athletica/issues/22) | Administrator zaprasza ludzi i zakłada drużynę | #6 | — | no |
| E06-S03-T01 | [#26](https://github.com/mikolajjenczyk/test_athletica/issues/26) | Zaproszenia administratora bez operatora (C20) | #22 | — | no |

### Kolejność specyfikacji i implementacji (2026-10-28)

Bramka: wg PRD (D360) specyfikacje techniczne czekają na zatwierdzenie zakresu przez klienta (Q15). Każdy epik to nowa zdolność (schemat, API), więc wymaga specyfikacji `om-spec-writing` przed kodem; implementacja faza po fazie przez `om-auto-implement-spec` lub `om-implement-spec`. Historie P1 są ostatnimi fazami swoich specyfikacji. Do porównania z D258 (kolejność specyfikacji z repo discovery, niedostępna tutaj).

| # | Specyfikacja | Historie | Skille przy implementacji | Blokuje specyfikację |
|---|---|---|---|---|
| 1 | E06 — klub, cele i zalecenia: `2026-10-28-e06-cele-zalecenia-klub.md` (Draft) | faza 1: E06-S03, E06-S03-T01 (#22, #26); faza 2: E06-S01 cele drużyny/zawodnika i plan (#20); faza 3 po SPEC 2: cel testu (#20) i E06-S02 zalecenia (#21) | om-module-scaffold, om-data-model-design, om-system-extension, om-backend-ui-design | Q-001 (Q15); faza 1: weryfikacja `auth`; faza 3: Q-002 + bramka SPEC 2 |
| 2 | Testy i wyniki | E02-S01 → S02 → S03 (#10, #11, #12) | om-module-scaffold, om-backend-ui-design, om-integration-builder (CSV) | Q60 tylko treść testów |
| 3 | Dane dzienne: wgrywanie arkuszy | E01-S01, E01-S01-T01 (#8, #23) | om-integration-builder, om-data-model-design (R23) | D334, D301; A07 przed odbiorem |
| 4 | Karta zawodnika i strona drużyny | E03-S01 → S02 (#13, #14) | om-backend-ui-design, om-module-scaffold | brak (Q64 nieblokujące) |
| 5 | Obserwacje AI i decyzje trenera | E04-S01, E04-S01-T01 → S02 → S03 (#15, #24, #16, #17) | om-create-ai-agent, om-module-scaffold | Q17; pytania 1 i 5 do Toma |
| 6 | Raporty, PDF i widok dyrektora | E05-S01, E05-S01-T01 → S02 (#18, #25, #19) | om-module-scaffold, om-backend-ui-design | R19 vs R21 (Tom); Q82 |
| 7 | Pulpit | E01-S02 (#9) | om-backend-ui-design | zależy od 2–6; pytanie 4 do Toma, „Odśwież” po Q81 |
| 8 | ~~Zalecenia~~ — przeniesione do SPEC 1 (E06, faza 3) | E06-S02 (#21) | — | — |

Ścieżka krytyczna do scenariusza D271: 1 (fazy 1–2) → (2 ∥ 3) → 4 → 5 → 6; faza 3 SPEC 1 (cel testu, zalecenia) wchodzi po SPEC 2. Pulpit (7) nie jest potrzebny do D271; pierwsza wersja Pulpitu (kafle + „Zwróć uwagę”) może wejść jako ostatnia faza SPEC 3, jeśli priorytetem jest A11. SPEC 1–4 można pisać od razu po Q15; SPEC 5–6 zostają w `Draft` do odpowiedzi Toma i klienta. Aktualizacja 2026-10-28: SPEC 1 objął cały E06 (decyzja: jedna specyfikacja, trzy fazy).
