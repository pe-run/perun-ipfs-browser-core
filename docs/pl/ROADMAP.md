# Stan MVP — 2026-11-16

Plan realizacji: A → B → C → D → E → F. Implementacja zakończona; zakres i ograniczenia opisuje ARCHITECTURE.md.

| Etap              | Stan                  | Wynik                                                                                                                                                                                         |
| ----------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A: HTTP/HTTPS     | Gotowe                | Okno Electron, WebContentsView, karty, pasek, wstecz/dalej, reload/stop, formularze, kontrolowane popupy, pobieranie, SQLite, historia i zakładki, start, trwałe ustawienie odtwarzania kart. |
| B: Kubo           | Gotowe                | Oficjalna binarka 0.43.1 ze sprawdzanym SHA-256, prywatne repo, trwały PeerID, socket Unix 0600, automatyczny start/gotowość/stop, obsługa błędów i awarii.                                   |
| C: IPFS/IPNS      | Gotowe                | protocol.handle, RPC cat/files/stat/name/resolve, strumienie, MIME, index.html, błędy, pojedynczy Range.                                                                                      |
| D: wspólny origin | Gotowe                | p2p://shared w trwałej sesji; test dwóch CID potwierdza localStorage, IndexedDB i BroadcastChannel oraz separację HTTP.                                                                       |
| E: retencja/P2P   | Gotowe w zakresie MVP | Cel 10 GB i Kubo GC (bez ścisłej gwarancji), ręczne piny i ich metadane, statystyki; drugi niezależny Kubo pobiera blok bez bramki.                                                           |
| F: Linux          | Gotowe                | Katalog uruchamialny, ZIP i DEB z Kubo, test gotowej binarki uruchomionej poza repo, dokumentacja.                                                                                            |

## Weryfikacja

- Node 24.22.3, Electron 45.3.3, Forge 8.0.1.
- TypeScript strict: bez błędów; lint/format: bez błędów.
- Vitest: 19 testów jednostkowych, 4 integracyjne — zaliczone.
- Playwright/Xvfb: 4 scenariusze przeglądarki oraz test pakietu. HTTP/HTTPS i walidacja certyfikatów, formularze, popupy, pobieranie na dysk, karty, historia i zakładki po restarcie; IPFS HTML/CSS/JS, nawigacja względna, IPNS, kopiowanie oryginalnego URL, współdzielenie magazynów, brak Node/IPC dla stron, piny i separacja HTTP; start i zatrzymanie dołączonego Kubo z pakietu.
- Integracja sprawdza bezpośredni transfer P2P między dwoma osobnymi repozytoriami, trwałość PeerID, Range, MIME, błędny CID, brak binarki, uszkodzone repo i zatrzymanie działającego procesu.
- Dystrybucja DEB zawiera oryginalny helper sandboxa z trybem 4755 i właścicielem root. Nie wykonano instalacji DEB do systemu: sudo wymaga hasła. Przetestowano binarkę z katalogu pakietu, nie samą procedurę apt.
- Host testowy ma AppArmor blokujący user namespaces. Użyto istniejącego systemowego helpera SUID Chrome w instalacji developerskiej i czasowo w katalogu testowanego pakietu. Nie wyłączano sandboxa. Przed tworzeniem artefaktów przywrócono oryginalny helper Electrona.
- Testy nie dowodzą globalnej dostępności publicznych CID ani propagacji DNSLink/IPNS w całym Internecie. Korzystają z lokalnych fixture'ów i rzeczywistego lokalnego P2P.

## Następny etap

1. Test instalacji/odinstalowania DEB na czystych Ubuntu/Debian oraz macierz dystrybucji z AppArmor i Wayland.
2. Poszerzenie testów multimediów, dużych plików, anulowania transferów, złożonych aplikacji IPFS i publicznego DNSLink/IPNS.
3. Uzgadnianie rejestru ręcznych pinów po twardej awarii pomiędzy RPC a SQLite; opcjonalne odzyskiwanie po awarii procesu aplikacji.
4. Dalsze zarządzanie cache dopiero po pomiarach; nie obiecywać ścisłych 10 GB przy samym StorageMax/GC.

Poza MVP pozostają konta, synchronizacja, profile P2P, CRDT, portfel, wyszukiwarka, PubSub, publikowanie ze stron, replikacja manifestów, aktualizator, rozszerzenia i inne systemy operacyjne. Nie zostały zaimplementowane.

Nazwa produktu została zmieniona na **Perun IPFS Browser**. Zachowano identyfikator pakietu i ścieżkę profilu dla zgodności z istniejącymi danymi.

Dodano instalację jednym poleceniem z docelowego publicznego GitHub przez scripts/install.sh (Ubuntu/Debian x86_64): automatyczny Node 24, budowanie DEB i instalacja apt.

Instalator: 5 testów przepływu budowania/instalacji i błędów (mockowane sudo), poprawny pełny build DEB przez --source . --build-only w czystym katalogu tymczasowym. Rzeczywistego apt install nie wykonano bez hasła sudo. Publiczny URL instalatora będzie dostępny po upublicznieniu repozytorium; obecnie repo pozostaje prywatne.

## 0.2 — import do IPFS

Gotowe: natywny wybór wielu plików lub katalogu, strumieniowy import RPC Kubo, automatyczny pin i zakładka, CID/adres do kopiowania i otwarcia, bezpośrednie adresy plików. Anulowanie wyboru i błędy są obsługiwane, zamknięcie aplikacji przerywa aktywne importy. Strony nie uzyskują nowego IPC ani RPC.
Zweryfikowano: UTF-8 i cudzysłowy w nazwach, plik binarny 3 MiB, puste katalogi, odrzucenie symlinków, błąd pliku, przerwanie sygnałem, trwałość pinu, rzeczywisty odbiór importu przez drugi węzeł P2P; Playwright sprawdza natywny dialog przez harness, import plików i katalogu, kopiowanie, otwarcie strony, anulowanie, błędy i trwałość zakładki/pinu po restarcie.

Logo Perun przeniesiono do resources/branding/perun.svg. SVG jest używany w pasku przeglądarki, stronie startowej i faviconie; PNG 512×512 z tego samego źródła jest ikoną okna i pakietu DEB.
