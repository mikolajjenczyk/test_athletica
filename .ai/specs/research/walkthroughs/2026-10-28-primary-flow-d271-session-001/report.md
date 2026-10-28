# Walkthrough: przepływ główny D271, PRD Atletica AI, 2026-10-28

[ASSUMPTION] Podstawą jest wyłącznie PRD (`[DOCUMENT]`, głównie relacja założyciela klienta) i jedna liczba z desk research. Nikt z prawdziwych użytkowników nie był słuchany. Wszystko poniżej to hipotezy `[SYNTHETIC]` i nie spełnia Definition of Ready.

Najmocniejsza powtarzalna hipoteza: **dyrektor zostaje z nieaktualnym albo wycofanym raportem, a nikt mu o tym nie mówi** (waga 6, rozrzut ±0). Po poprawce jednej liczby raport przechodzi w „Wymaga ponownego zatwierdzenia” i PDF znika. PRD nie mówi jednak, co widzi dyrektor, który został o raporcie powiadomiony albo już go pobrał. Równie mocna, remisowa: **trener i dyrektor nie wiedzą, co z tekstu trenera i z uzasadnienia opartego na samopoczuciu trafia do dyrektora** (6, ±0). Następny prawdziwy krok to test z 2–3 trenerami (D364) i krótka rozmowa z jednym dyrektorem akademii. Pytania są w tabeli „Do potwierdzenia”.

Stance: simulate (produkt klienta, jego użytkownicy są dziś nieosiągalni; wynik to plan wywiadów)
Panel: 2 runs × 3 personas; run 1: P01, P02, P03; run 2: P04, P05, P06
Basis: `.ai/specs/2026-10-22-prd.md`: Executive Summary, Problem Statement, User Personas, Stories 1, 6, 8–12, Design & UX, Out of scope. Poziomy dowodu: `[DOCUMENT]` (PRD, relacja założyciela, nie obserwacja), `[BENCHMARK]` (95% praktyków używa Excela, nie trenerzy klienta). Wycinek przekazany personom: `subject-d271.md` (przepływ, opisy ekranów, zasady, słowniczek; bez założeń A0n, ryzyk, celów i otwartych pytań).
Panel snapshot: `.ai/specs/research/walkthroughs/2026-10-28-primary-flow-d271-session-001/personas.md`
Session: `.ai/specs/research/walkthroughs/2026-10-28-primary-flow-d271-session-001/`; przedmiot `.ai/specs/2026-10-22-prd.md`, przepływ „Primary flow (acceptance scenario, D271)”
Composition: założona. PRD nie podaje proporcji segmentów. Trzy segmenty z sekcji User Personas, po jednej personie na przebieg. Dyrektor zajmuje miejsce „obojętnego” (marginalność to `[ASSUMPTION]`). Segment „trener słabo technologiczny” pochodzi z jednego zdania PRD, więc P02 i P05 to ten sam głos dwa razy. Oba są oznaczone jako persony założeniowe.
Saturation: not reached. W ostatnich trzech wywiadach (P04–P06) ok. 4 z ok. 40 tematów było nowych (przypominanie zawodnikom, dzień z jedną z dwóch sesji, sortowanie listy luk, liczba luk widoczna dla dyrektora). To powyżej progu 1/20. Kolejne przebiegi coś by jeszcze dodały, ale materiał jest wąski, więc lepiej iść do prawdziwych ludzi.
Parity: no real interviews to compare (katalog `research/` nie zawiera żadnych notatek z wywiadów)
Elapsed: persony i wycinek ok. 8 min; wywiady i przejścia (6 subagentów równolegle) ok. 2 min; konsolidacja ok. 10 min; parity: nie dotyczy
Not askable of this panel: A05 (oczekiwania klienta co do zakresu; segment założyciela), A10 (techniczny dostęp do arkuszy), A11 (czy dane dzienne ściągają trenera codziennie: dotyczy przepływu „Poranek”, nie D271), Q15 (kto podpisuje zakres). A01, A04, A07 i Q07 zostały zadane trenerom; odpowiedzi są pod tabelą „Do potwierdzenia”.

## 🎯 Scope and limits

Przepływ D271, cztery kroki, przejście **narracyjne** po opisie z PRD. Nie oglądano żadnego ekranu ani prototypu. Prototyp rev-053 istnieje w `.ai/prototypes/discovery/`, ale nie był przechodzony. Trenerzy przechodzili kroki 1–4, przy czym krok 4 oceniali z pozycji „co dostanie dyrektor”. Dyrektorzy szczegółowo przechodzili tylko krok 4. Nie przechodzono: wpisywania testów („Tryb boisko”), Pulpitu, przepływu porannego ani konfiguracji klubu. Miejsca, których PRD nie opisuje, są zapisane jako brakujące przypadki. Nie dopowiadano ekranów.

## 🔍 Barriers that repeated (worst first, ties marked)

Ranking według wagi. Pozycje 1–2 remisują ze sobą. Pozycje 3–4 remisują ze sobą oraz z przypadkami o wadze 4 i 3±1 w kolejnych sekcjach.

### 1. Pod presją trener zatwierdza i przyjmuje bez czytania podstawy, więc ponowne zatwierdzenie chroni tylko na papierze

[SYNTHETIC]

Waga: 4; rozrzut: ±0; persony: P01, P02 (run 1); P04, P05 (run 2). P04 deklaruje, że się powstrzyma, ale przyznaje, że kliknięcie go kusi.
Gdzie: krok 3 („Przyjmij”, „Zatwierdź i pokaż dyrektorowi”) i odwrócona presja D2 („Wymaga ponownego zatwierdzenia”). Pod presją dyrektora wszyscy czterej trenerzy sprawdzają tylko liczby testów, a wniosków nie śledzą do danych (P01, P02, P05). Ponowne zatwierdzenie robią odruchowo, bez listy rzeczy do przeczytania (P02, P05). „Przyjmij” znaczy u nich „widziałem daty”, a nie „sprawdziłem” (P05, P02, P01 „odruchowo pod kciukiem”). W wywiadach te same persony mówiły, że każdy wniosek musi dać się prześledzić. Ten rozjazd między deklaracją a działaniem to właśnie wynik.
Dotyka: R18 (ponowne zatwierdzenie), D375/D376 (decyzja per obserwacja), Story 11 („nothing reaches him unchecked”), A04.
Sprawdzenie: test z 2–3 trenerami na prototypie, zadanie „dyrektor prosi o raport dziś, masz 5 minut”. Mierzymy, czy otwierają „Na jakich danych” przed „Zatwierdź”, i ile czasu trwa ponowne zatwierdzenie po zmianie jednej liczby.

### 2. „Trzy dni z rzędu” przy jednej luce: trener odrzuca obserwację i traci zaufanie

[SYNTHETIC]

Waga: 4; rozrzut: ±0; persony: P01, P02 (run 1); P04, P05 (run 2).
Gdzie: krok 2–3, presja D1(ii). Każdy trener zmienił decyzję. P01 i P04 wybierają „Popraw”, a jeśli tekst dalej mówi o trendzie, „Odrzuć”. P02 i P05 wybierają od razu „Odrzuć”, bo poprawianie na telefonie jest dla nich za drogie. P01 mówi o utracie zaufania do aplikacji szybciej niż do Excela.
Dotyka: R20 (jeden wynik to fakt, dwa to zmiana, trzy to trend), R12. Hipoteza: jedno zdanie AI, które pomija lukę, kosztuje zaufanie do całego modułu. U trenerów słabo technologicznych kończy się odrzuceniem zamiast poprawki.
Sprawdzenie: w teście z trenerami pokazać dwie wersje obserwacji, poprawną według R20 i „trend z dziurą”. Rejestrujemy decyzję i komentarz. Do rozmowy z Tomem: czy R20 jest egzekwowane w promptach, czy tylko w specyfikacji.

### 3. „Znaczenie zmiany wymaga oceny” przerzuca ocenę na czytającego

[SYNTHETIC]

Waga: 3; rozrzut: ±1; persony: P02 (run 1); P05, P06 (run 2).
Gdzie: krok 2 (karta zawodnika) i krok 4 (podsumowanie dla dyrektora). Trenerzy z małej akademii chcieli prostej odpowiedzi („czyjej oceny? mojej?”). Dyrektor nie wie, co z tym powiedzieć zarządowi.
Dotyka: D259, D273 (werdykt tylko ze źródłowym progiem), Q64 (brak uzasadnionych progów).
Sprawdzenie: w teście zapytać trenera i dyrektora, co zrobią po przeczytaniu tego zdania. Do klienta: Q64, czyli czy są progi „Wyraźna zmiana od” dla sześciu testów.

## 📋 Missing cases that repeated

### Nieaktualny lub wycofany raport u dyrektora

[SYNTHETIC]

Waga: 6; rozrzut: ±0; persony: P01, P02, P03 (run 1); P04, P05, P06 (run 2).
Trenerzy pytają, czy dyrektor dowie się, że pobrany PDF jest nieaktualny (P01, P04, P05), i co widzi w chwili, gdy raport czeka na ponowne zatwierdzenie (P02). Dyrektorzy nie mają wtedy nic do pokazania, nawet poprzedniej wersji z dopiskiem (P03), i nie rozumieją, co się zmieniło (P06). W D2 wszyscy dyrektorzy dzwonią do trenera. Trzech trenerów i tak pisze osobno do dyrektora. Dotyka R18 i Story 11.
Sprawdzenie: rozmowa z dyrektorem akademii. „Co robi pan z PDF po pobraniu (przesyła, drukuje, trzyma)? Co powinno się stać, gdy raport zmienia się po pobraniu?”

### Raport zbiorczy i obraz drużyny w ścieżce D271

[SYNTHETIC]

Waga: 4; rozrzut: ±0; persony: P01, P03 (run 1); P04, P06 (run 2).
Ścieżka D271 kończy się raportem jednego zawodnika. Dyrektor pyta o akademię („zaległe: N, odpowiada X”). Trener po testach nie zrobi 25 raportów osobno (P01). Brak widoku całej drużyny „kto odstaje” (P04). PRD ma raport drużyny (Story 11) i stronę drużyny (Story 7), ale nie ma ich w scenariuszu akceptacyjnym, więc to prawdopodobnie luka scenariusza, nie produktu.
Sprawdzenie: dyrektor: „Czego potrzebuje pan dzień po testach: statusu drużyny czy raportów zawodników?” Tom: czy D271 powinien kończyć się raportem drużyny.

### Brak stanu „na później” dla obserwacji AI

[SYNTHETIC]

Waga: 4; rozrzut: ±0; persony: P01, P02 (run 1); P04, P05 (run 2).
Trzy minuty przed treningiem żaden trener nie kliknął „Przyjmij”, „Popraw” ani „Odrzuć”. Wszyscy odłożyli decyzję. Dwóch i tak podeszło do zawodnika (P01, P04). PRD zna tylko te trzy decyzje (D375, D376). Decyzje zapadają wieczorem, a to dotyka zakładanej porannej pętli (A11) i proponowanej North Star metryki („decyzje na aktualnych danych”).
Sprawdzenie: w pilocie lub teście zarejestrować porę decyzji o obserwacjach. Trenera zapytać: „Co robisz z sygnałem o zawodniku kilka minut przed treningiem?”

### Odrzucony wiersz przy imporcie: co z nim zrobić

[SYNTHETIC]

Waga: 4; rozrzut: ±0; persony: P01, P02 (run 1); P04, P05 (run 2).
Podgląd pokazuje numer i powód (R22), ale nie mówi, czy poprawić wiersz w aplikacji, czy w arkuszu klubu i odświeżyć. Nie mówi też, czy po zapisie stanie się luką. Na telefonie numer wiersza nic nie mówi (P05).
Sprawdzenie: jeden prawdziwy wypełniony tydzień arkusza (A07). W teście zadanie: „napraw odrzucony wiersz”.

### Wyniki testów nie mają miejsca w kroku 1

[SYNTHETIC]

Waga: 3; rozrzut: ±1; persony: P01, P02 (run 1); P05 (run 2).
Krok 1 dotyczy tylko arkuszy RPE i samopoczucia. Trener z wynikami w osobnym pliku (P01) albo na kartce lub w telefonie ze stopera (P02, P05) nie wie, którędy wyniki wchodzą do tej ścieżki. PRD ma to w Story 3–4 (Tryb boisko, CSV), poza scenariuszem D271. To luka scenariusza akceptacyjnego.
Sprawdzenie: Tom, czy D271 zakłada wyniki już w systemie. Trener: „Gdzie były wyniki ostatnich testów, zanim trafiły do raportu?”

### Edge cases importu: nieobecny vs niewypełnił, ankieta po 12:00

[SYNTHETIC]

Waga: 2; rozrzut: ±0; persony: P01 (run 1); P04 (run 2).
„Brak RPE” nie odróżnia zawodnika nieobecnego lub kontuzjowanego od takiego, który nie wypełnił arkusza. Nie wiadomo też, czy ankieta po 12:00 bez oznaczenia „poranna” to „Brak odpowiedzi”. Dotyka R12, D316 i D330g.
Sprawdzenie: prawdziwy tydzień arkusza (A07). Trener: „Jak dziś odróżniasz nieobecnego od niewypełnionego?”

## ⚠️ Contradictions with the brief

### Co z tekstu trenera i uzasadnienia trafia do dyrektora

[SYNTHETIC]

Waga: 6; rozrzut: ±0; persony: P01, P02, P03 (run 1); P04, P05, P06 (run 2).
Story 12 mówi: dyrektor nie widzi „coach's free text anywhere”. Story 8 (R21) i FR-004 mówią: tekst trenera jest oznaczony osobno, „the PDF included”. Trenerzy nie wiedzą, czy ich poprawki z „Popraw” trafiają do dyrektora (P01, P02, P04). Jednocześnie wniosek oparty na samopoczuciu (R19) traci widoczną podstawę u dyrektora. Trener i tak tłumaczy go ustnie (P01). Dyrektor musi wierzyć, że tekst samopoczucia nie używa (P03), a podsumowanie może być ubogie (P06). P04 prosi o podgląd „tak zobaczy to dyrektor” przed zatwierdzeniem.
Sprawdzenie: Tom powinien doprecyzować R19 i R21 („wolny tekst trenera” a tekst raportu trenera). W teście trener porównuje szkic z widokiem dyrektora i mówi, czego się spodziewał.

### Nazwisko trenera przy zaległościach: najcenniejsze dla dyrektora, źródło lęku trenera

[SYNTHETIC]

Waga: 4 (trenerzy) + 2 (dyrektorzy); rozrzut: ±0; persony: P01, P02 (run 1); P04, P05 (run 2) jako niepokój; P03 (run 1) i P06 (run 2) jako sygnał rozstrzygający.
D190 i D203 każą nazwać odpowiedzialnego trenera. Dla dyrektorów to jedyny sygnał, który w D1(ii) zastąpił telefon do trenera. Trenerzy boją się, że zaległość wynikająca z niewypełnienia arkusza przez zawodnika albo z danych, których nie zbierają, wyjdzie jako ich wina. P02 reaguje silnym niepokojem. P04 uważa to za nieuczciwe. „Co liczy się jako zaległe” nie jest dla nich jasne. Dotyka FR-006 (liczniki mówią, co liczą) i Q29.
Sprawdzenie: dyrektor: „Co według pana znaczy ‘zaległe’?” Trener: „Pokażę ci licznik zaległości z twoim nazwiskiem. Co z niego wynika?”

### „Najpierw dane dzienne, testy niżej” jest odwrócone dla dyrektora i małej akademii

[SYNTHETIC]

Waga: 3; rozrzut: ±1; persony: P02, P03 (run 1); P06 (run 2).
D285 ustawia dane dzienne nad testami. Dyrektor pyta najpierw o testy. Trener małej akademii ma tylko testy, bo nie wie, czy ktoś zbiera RPE. Kolejność „otwórz raport” zamiast „najpierw liczniki” też jest odwrotna niż u dyrektora (P03).
Sprawdzenie: dyrektor na prototypie: pierwsze kliknięcie po otwarciu. Klient: czy małe akademie zbierają RPE i samopoczucie.

### „Dane do” rozstrzyga o zaufaniu, bo zatwierdzony nie znaczy aktualny

[SYNTHETIC]

Waga: 2; rozrzut: ±0; persony: P03 (run 1); P06 (run 2). P04 sprawdza „Dane do” przed zatwierdzeniem.
Obaj dyrektorzy deklarują, że zatwierdzenie im wystarcza. Gdy „Dane do” jest stare, obaj dzwonią do trenera. Aplikacja tylko przesuwa moment telefonu. Trzy daty na liście to za dużo (P03, raz). Dotyka D396 i D268.
Sprawdzenie: dyrektor: „Po czym na pierwszej stronie poznaje pan, że raport jest aktualny?”

### „Co możesz rozważyć” na granicy zakazu treści treningowych

[SYNTHETIC]

Waga: 2; rozrzut: ±0; persony: P01 (run 1); P04 (run 2).
Trenerzy głównego segmentu czytają tę sekcję podejrzliwie. Jeśli „rozważ” zabrzmi jak „zmniejsz obciążenie”, będzie to decyzja treningowa, której nie zaakceptują. Dotyka R11, D240, N11 oraz pytania 1 do Toma (D209 a D240).
Sprawdzenie: w teście pokazać trzy przykładowe teksty „Co możesz rozważyć” i zapytać, które przekraczają granicę.

### Segment słabo technologiczny: nie ma arkuszy, nie zna skrótów, chce jednego przycisku

[SYNTHETIC]

Waga: 2; rozrzut: ±0; persony: P02 (run 1); P05 (run 2). ⚠️ Obie persony zbudowano z jednego zdania PRD, to jeden głos dwa razy.
„Jakie arkusze? Ja ich nie mam” (silne zagubienie w kroku 1). RPE, AU i „Benchmark” to angielskie skróty, a persona ma pracować „all Polish”. Pięć kroków zamiast jednego przycisku. Tekst AI na telefonie zostaje nieprzeczytany. Dotyka D380/D392 (nazwy po polsku) i NFR-009. Ustalenie mówi więcej o luce w materiale niż o użytkownikach.
Sprawdzenie: jeden prawdziwy wywiad z trenerem małej akademii. Zrekrutować przez klienta. Pytanie: „Pokaż, jak zapisałeś ostatnie testy.”

## 🔍 Outliers

P05 (run 2) jest jedyną personą, która mówi wprost, że ponowne zatwierdzenie to „bezpiecznik tylko na papierze”, i deklaruje, że długi tekst AI „puści bez czytania”. Średnia panelu to zaciera. Jeśli trener małej akademii rzeczywiście istnieje w pilocie, pętla „AI, przegląd, decyzja trenera” (D230) może u niego działać jak samo „AI”, tylko z podpisem trenera.

P06 (run 2), dyrektor z miejsca „obojętnego”, deklaruje temat jako marginalny. Pod presją zebrania dzwoni jednak do trenera w 2 z 3 wariantów. Obojętność nie oznacza tu braku działania.

## 🔁 Seen once, not reported as a finding

- „Usuń szkic” obok „Zatwierdź”, brak opisu potwierdzenia: P01, P02 (run 1)
- Brak drogi zwrotnej od dyrektora do trenera: P01 (run 1)
- Częściowa poprawka zatwierdzonego raportu bez czytania całości: P01 (run 1)
- Trener nieosiągalny, kto go zastępuje przy zaległości: P03 (run 1)
- Za dużo dat na liście „Raporty”: P03 (run 1)
- Pierwszy test w aplikacji (jeden wynik), jak wygląda karta: P02 (run 1)
- Czy nieruszone obserwacje blokują raport: P05 (run 2)
- Sortowanie listy luk (30 zawodników × 2 sesje); dzień z jedną z dwóch sesji wypełnioną: P04 (run 2)
- Szybkie przypomnienie zawodnikom o arkuszu: P04 (run 2), oparte częściowo na epizodzie spoza linii persony
- Czy dyrektor widzi liczbę luk w danych zawodnika: P04 (run 2)

## 🧪 To confirm with real users

| # | Hypothesis | Persona ids / runs | Settles | Who to recruit | How |
|---|---|---|---|---|---|
| 1 | Dyrektor zostaje z nieaktualnym lub wycofanym PDF bez informacji | P01–P03 r1; P04–P06 r2 | R18, Story 11 | 1–2 dyrektorów akademii | Wywiad: co robi z PDF po pobraniu i czego oczekuje po zmianie raportu |
| 2 | Niejasne, co z tekstu trenera i z uzasadnienia trafia do dyrektora | P01–P03 r1; P04–P06 r2 | R19 vs R21/FR-004 | Tom (decyzja), 2–3 trenerów | Doprecyzować regułę; w teście trener porównuje szkic z widokiem dyrektora |
| 3 | Pod presją zatwierdzenie i przyjęcie bez czytania podstawy | P01, P02 r1; P04, P05 r2 | R18, A04, D375 | 2–3 trenerów (test D364) | Zadanie z limitem 5 min; czy otwierają „Na jakich danych” przed „Zatwierdź” |
| 4 | „Trzy dni z rzędu” przy luce prowadzi do odrzucenia i utraty zaufania | P01, P02 r1; P04, P05 r2 | R20, R12 | 2–3 trenerów | Dwie wersje obserwacji (zgodna z R20 i „trend z dziurą”); decyzja i komentarz |
| 5 | Brak raportu zbiorczego i obrazu drużyny w D271 | P01, P03 r1; P04, P06 r2 | D271, Story 7/11 | Dyrektor, Tom | Pytanie o potrzebę dzień po testach; decyzja o zakończeniu scenariusza |
| 6 | Brak stanu „na później”, decyzje zapadają wieczorem | P01, P02 r1; P04, P05 r2 | D375/D376, A11, North Star | Trenerzy w pilocie | Zarejestrować porę decyzji; pytanie o sygnał przed treningiem |
| 7 | Odrzucony wiersz bez ścieżki naprawy | P01, P02 r1; P04, P05 r2 | R22, A07 | Klient (prawdziwy tydzień), 2–3 trenerów | Prawdziwy arkusz; zadanie „napraw odrzucony wiersz” |
| 8 | Nazwisko przy zaległościach: wartość dla dyrektora, lęk trenera | P01, P02, P03 r1; P04, P05, P06 r2 | D190, D203, FR-006 | Dyrektor + trener | Co znaczy „zaległe”; reakcja trenera na licznik z nazwiskiem |
| 9 | Wyniki testów nie mają miejsca w kroku 1 | P01, P02 r1; P05 r2 | D271, Story 3–4 | Tom, trener | Czy D271 zakłada wyniki w systemie; gdzie były ostatnie wyniki |
| 10 | „Znaczenie zmiany wymaga oceny” przerzuca ocenę | P02 r1; P05, P06 r2 | D259, D273, Q64 | Trener, dyrektor, klient (progi) | Co zrobią po przeczytaniu; Q64 do klienta |
| 11 | „Dane dzienne najpierw” odwrócone dla dyrektora i małej akademii | P02, P03 r1; P06 r2 | D285 | Dyrektor, klient | Pierwsze kliknięcie dyrektora; czy małe akademie zbierają RPE |
| 12 | „Dane do” decyduje o zaufaniu dyrektora | P03 r1; P06 r2 | D396, D268 | Dyrektor | Po czym poznaje aktualność raportu |
| 13 | „Co możesz rozważyć” na granicy R11 | P01 r1; P04 r2 | R11, D240, pytanie 1 do Toma | 2–3 trenerów | Trzy przykładowe teksty; który przekracza granicę |
| 14 | Import: nieobecny vs niewypełnił; ankieta po 12:00 | P01 r1; P04 r2 | R12, D316, D330g, A07 | Klient (prawdziwy tydzień), trener | Jak dziś odróżnia; prawdziwe dane |
| 15 | Mała akademia: brak arkuszy, angielskie skróty, za dużo kroków (jeden głos dwa razy) | P02 r1; P05 r2 | D380/D392, NFR-009 | 1 trener małej akademii | „Pokaż, jak zapisałeś ostatnie testy” |

Założenia zadane panelowi (odpowiedzi `[SYNTHETIC]`, do potwierdzenia):
- **A01** (czas łączenia danych): żaden trener nie podał czasu („nie liczyłem”). Panel opisuje tylko, na czym polega żmudność: dopasowanie wiersza do zawodnika i sesji, dwie sesje, pisownia nazwisk. Sprawdzenie: trener pokazuje ostatni połączony plik.
- **A04** (przepisywanie szkiców AI): bez podstawy w materiale. Pod presją panel szkiców nie poprawia, tylko przyjmuje albo odrzuca. Wskazuje to raczej na niedoczytanie niż na przepisywanie. Sprawdzenie: Q05 (przykładowe podsumowania klienta) i test dwóch szkiców.
- **A07** (arkusze wypełniane codziennie): trenerzy głównego segmentu mówią o lukach „co tydzień”, bez liczb. Trenerzy małej akademii nie wiedzą, czy arkusze istnieją. Sprawdzenie: jeden prawdziwy wypełniony tydzień.
- **Q07** (jeden trener wpisuje i zatwierdza): w głównym segmencie zgodne. W małej akademii nie ma dziś żadnego zatwierdzania. Sprawdzenie: dyrektor, czy istnieje dziś ścieżka zatwierdzania.

## 📝 Interviews

Transkrypcje (pytanie, szybka reakcja i uczucie, odpowiedź przemyślana, presje, kroki przejścia, tematy, notatki prowadzącego):
- `transcripts/run-1-P01.md`, `transcripts/run-1-P02.md`, `transcripts/run-1-P03.md`
- `transcripts/run-2-P04.md`, `transcripts/run-2-P05.md`, `transcripts/run-2-P06.md`

Nie dołączono fragmentów badań, bo katalog `research/` był pusty. Odpowiedzi opierają się wyłącznie na liniach person. Flagi uziemienia: P01 Q2 (szablon Excela) oraz P04 Q1–Q2 (format tekstu dla dyrektora, przypominanie na grupie) dopowiadają epizody spoza linii person. Te odpowiedzi wyłączono z ustaleń.

Acquiescence: 4 „tak” na 15 odpowiedzi tak/nie z rozstrzygnięciem (ok. 27%). To poniżej połowy, więc bez nadmiernej zgody. 9 z 24 odpowiedzi to „brak podstawy”, co jest luką w materiale. Wszystkie „tak” pochodzą od trenerów głównego segmentu (P01, P04) i dotyczą łączenia danych w arkuszu, co PRD potwierdza.

Kontrola stronniczości: brak nadmiernej pozytywności (każde przejście ma tarcia, entuzjazmu nikt nie zgłasza). Żadna persona nie proponuje tego samego narzędzia. Zaangażowanie jest zróżnicowane (trenerzy główni centralnie, mała akademia okazjonalnie, dyrektorzy marginalnie). Jednorodność dotyczy materiału: segment małej akademii to jedno zdanie PRD, a wszystkie persony pochodzą z relacji jednego źródła, czyli założyciela.

## 📸 Evidence

Przejście narracyjne po wycinku PRD, bez ekranów i zrzutów. Katalog `screenshots/` jest pusty z założenia.
