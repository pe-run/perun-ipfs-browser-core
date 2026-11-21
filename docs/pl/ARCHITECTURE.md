# Architektura

## Procesy i granice zaufania

Proces główny Electrona zarządza oknem, kartami WebContentsView, SQLite i procesem Kubo. Renderer interfejsu to osobna sesja `persist:interface`, lokalny plik produkcyjny lub serwer Vite w development. Tylko jej główna ramka, o dokładnie sprawdzonym URL, może wywołać mały zestaw komend preload. Argumenty są walidowane. Nawigacja i popupy UI poza jego adresem są blokowane.

Wszystkie odwiedzane strony korzystają z `persist:browsing`. Zapis wymaga natywnego potwierdzenia; zobacz [WEB_IPFS_API.md](../../WEB_IPFS_API.md). nodeIntegration=false, contextIsolation=true, sandbox=true, webSecurity=true. Kamera, mikrofon, geolokalizacja i pozostałe uprawnienia są domyślnie odrzucane. Nie ma wyjątków dla błędnych certyfikatów w aplikacji. Pobranie pliku wymaga natywnego wyboru ścieżki. Popupy poprawnych protokołów tworzą karty, pozostałe są odrzucane. file:// i uprzywilejowany UI są niedostępne dla treści stron.

## Moduły

- `browser/controller.ts`: tworzenie i zamykanie widoków, historia nawigacji Chromium, stan UI, pobieranie, komendy.
- `shared/address.ts`: walidacja i odwracalne mapowanie adresów; CID przez multiformats, bez normalizowania wielkości liter CIDv0 jako hosta HTTP.
- `ipfs/engine.ts`: IPFSEngine i KuboEngine, cykl życia, prywatne RPC, pinowanie i statystyki.
- `ipfs/protocol.ts`: handler zasobów, katalogi/index.html, MIME, strumienie, błędy i Range.
- `storage/store.ts`: SQLite za pomocą oficjalnego modułu `node:sqlite` w Node/Electron; brak natywnego dodatku wymagającego rebuild ABI.
- `security/policy.ts`: ustawienia widoków i polityka sesji.

## Protokoły i originy

HTTP/HTTPS obsługuje wyłącznie Chromium. Originy, cookies, CORS i magazyny zachowują zwykłe reguły sieciowe. Kubo nie pośredniczy w tym ruchu.

`ipfs://CID/path` mapuje się na `p2p://shared/ipfs/CID/path`, a `ipns://NAME/path` na `p2p://shared/ipns/NAME/path`. Schemat rejestrowany jest przed ready: standardowy, bezpieczny, fetch, streaming, CORS; bez bypassCSP i bez Service Workerów. Handler jest rejestrowany na sesji kart. Pasek, przycisk Kopiuj, historia i zakładki używają odwrotnego mapowania.

Sesja kart obsługuje natywne URL-e IPFS/IPNS również dla obrazów, CSS, ramek i Fetch. Żądanie trafia pod ten sam adres wewnętrzny, którego używa nawigacja. Ścieżka od korzenia jest liczona od CID lub nazwy IPNS strony, z wyjątkiem jawnych ścieżek `/ipfs/` i `/ipns/`. Adresy `//host/ścieżka` z zewnętrznym hostem używają HTTPS. Jawne URL-e bram HTTP i HTTPS zachowują swój protokół. Ikony witryn są buforowane według CID lub nazwy IPNS.

Origin wszystkich treści IPFS/IPNS to **p2p://shared**. Treści różnych autorów mogą czytać i modyfikować swoje localStorage, IndexedDB oraz komunikować się BroadcastChannel. Nie są wzajemnie izolowane! UI i dane przeglądarki są poza tym originem. CacheStorage zależy od Chromium; MVP nie zarządza Cache API. Workery są wyłączone CSP `worker-src 'none'`, co wyklucza też kolizje Service Workerów.

Ścieżki względne działają, katalog bez końcowego ukośnika dostaje przekierowanie. Jawne `/ipfs/CID/...` i `/ipns/NAME/...` działają. `/style.css` nie wskazuje konkretnego korzenia i nie jest automatycznie przepisywane. `window.location` wewnątrz strony pokazuje rzeczywisty p2p URL; aplikacja nie fałszuje API DOM. Aplikacje oczekujące własnego originu lub hosta CID mogą wymagać adaptacji. Nie przechwytujemy globalnie treści HTML/JS.

## Pobieranie IPFS

Handler używa Kubo RPC `files/stat`, `cat` oraz `name/resolve`. Nie używa żadnej publicznej ani lokalnej bramki HTTP. `cat` jest strumieniowane przez Node Readable -> Web ReadableStream -> Response z propagacją anulowania żądania. MIME wynika z rozszerzenia; bez rozszerzenia badana jest próbka do 4096 bajtów (file-type oraz rozpoznanie HTML/JSON/tekstu). To heurystyka, nie pełna analiza zawartości. Obsługiwane są HEAD i pojedyncze zakresy bytes (również suffix); wieloczęściowe Range zwracają 416. HTML/CSS/JS, JSON, obrazy i pliki binarne mają zwykłe odpowiedzi. Brak index.html zwraca błąd zamiast listingu katalogu. IPNS rozwiązuje Kubo, łącznie z obsługiwanymi przez niego nazwami PeerID/CID i DNSLink.

## Kubo i retencja

Oficjalny Kubo 0.43.1 jest pobierany wyłącznie przy przygotowaniu zasobów budowania, z przypiętą SHA-256 w `scripts/download-kubo.mjs`. Archiwum w cache jest również weryfikowane. Dystrybucja zawiera binarkę i licencje; uruchomienie nie pobiera Kubo. Aktualnie dostępny target to linux/x64, skrypt jawnie odrzuca pozostałe platformy.

Repozytorium znajduje się w `app.getPath('userData')/ipfs`, z uprawnieniami 0700; konfiguracja i tożsamość PeerID są zachowywane. RPC używa unikalnego dla uruchomienia gniazda `rpc-<losowy>.sock` (0600) wewnątrz tego katalogu. Nie ma portu administracyjnego TCP. Gateway jest wyłączony. Porty swarm są przydzielane dynamicznie, aby unikać konfliktów. Kubo nadal uczestniczy w publicznym IPFS: Bitswap i routing pozostają aktywne. Gotowość jest sprawdzana RPC, błędy i awarie są prezentowane w stanie węzła. Przy zamykaniu, SIGINT i SIGTERM aplikacja kończy transfery/widoki i zatrzymuje Kubo; po 8 sekundach używa SIGKILL. Twarde zabicie procesu aplikacji (SIGKILL, awaria systemu) nie daje gwarancji sprzątnięcia procesu potomnego.

`StorageMax=10GB`, watermark 90%, GC co godzinę, daemon --enable-gc. To cel magazynu, **nie ścisły limit 10 GB automatycznego cache**. Kubo GC liczy również zajętość bloków przypiętych; nie usuwa pinów, więc repo może przekroczyć cel. Ręczne piny pozostają chronione niezależnie od zajętości. Nie ma LRU ani oddzielnego licznika nieprzypiętych bloków. SQLite zapisuje ręczne piny po sukcesie Kubo; autorytatywny zestaw pinów jest dostępny ze statystyk Kubo. Awaria pomiędzy operacją RPC i zapisem SQLite może wymagać uzgodnienia metadanych w przyszłej wersji.

## Dane trwałe

`browser.sqlite` przechowuje historię, zakładki, ustawienie przywracania kart, ostatnie adresy kart i rejestr ręcznych pinów. Prepared statements i WAL. Chromium przechowuje dane stron i cookies w trwałej sesji. Magazyn bloków jest osobnym katalogiem. Profil można zmienić przez `IPFS_BROWSER_PROFILE` (testy używają katalogów tymczasowych); `IPFS_BROWSER_OFFLINE=1` uruchamia Kubo offline, bez P2P. Ten tryb służy lokalnym fixture'om. Statystyki transferu są wtedy niedostępne (null).

## Ograniczenia MVP

Brak menedżera haseł, rozszerzeń, wyszukiwarki, logowania, synchronizacji, aktualizatora, publikowania treści ze stron i automatycznej replikacji. Brak odzyskiwania historii sesji Chromium po restarcie (odtwarzane są adresy kart). Brak zaawansowanych pobrań/wznawiania, listingu katalogów i zmiany uprawnień per strona. Nie gwarantujemy dostępności dowolnego publicznego CID ani propagacji IPNS w odłączonej sieci. Dekodery multimedialne/DRM wynikają z dystrybucji Electrona.

## Dokumentacja źródłowa

- [Electron WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view)
- [Electron protocol](https://www.electronjs.org/docs/latest/api/protocol)
- [Forge Vite](https://www.electronforge.io/config/plugins/vite)
- [Konfiguracja Kubo 0.43.1](https://github.com/ipfs/kubo/blob/v0.43.1/docs/config.md)
- [Kubo RPC](https://docs.ipfs.tech/reference/kubo/rpc/)

Nazwa produktu: **Perun IPFS Browser**. Identyfikator pakietu/binarki `ipfs-browser` i domyślny katalog profilu `IPFS Browser` pozostają bez zmian, aby zachować istniejące dane i PeerID.

Instalator `scripts/install.sh` klonuje publiczny Git przez HTTPS bez wymogu konta GitHub (opcjonalnie korzysta z zalogowanego gh w fazie prywatnej), buduje w odizolowanym katalogu tymczasowym jako zwykły użytkownik, a następnie instaluje DEB przez sudo apt-get. W razie braku Node 24 pobiera przypięte oficjalne wydanie z weryfikacją SHA-256. Nie publikuje wydań ani nie pobiera aplikacji z publicznej bramki. Opcja --build-only pozwala sprawdzić cały build bez uprawnień administratora.

## Import z interfejsu przeglądarki (0.2)

Komendy importFiles/importDirectory są dostępne tylko dla sprawdzanej głównej ramki UI. Ścieżki pochodzą z natywnego dialog.showOpenDialog w procesie głównym, nie z IPC renderera. IPFSEngine.importPaths wywołuje helper ipfs/import.ts: strumieniowy multipart przez prywatny socket do RPC add, pin=true, CIDv1, katalog opakowujący przy wyborze plików. Odpowiedź NDJSON jest czytana kolejno; sprawdzamy ostatni CID, katalog końcowy i błędy strumienia. Zawartość plików nie jest buforowana w całości. Nie używamy CLI do importu. Dowiązania i pliki specjalne są odrzucane (otwarcie plików z O_NOFOLLOW, kontrola typu). Stop Kubo anuluje aktywne żądania importu. Kontroler blokuje równoległe importy, rejestruje pomyślny pin w SQLite oraz tworzy zakładkę. UI otrzymuje CID, nazwy i adresy IPFS, bez lokalnych ścieżek. Brak API publikowania dla stron WWW/IPFS i brak publikowania rekordów IPNS. Postęp UI obejmuje stan operacji, bez licznika bajtów i bez wznawiania.

Od wersji 0.15.1 stary, nieaktywny socket nie blokuje startu: aplikacja wybiera nowy adres, bez usuwania plików poprzedniego procesu. Aktywne endpointy są sprawdzane przed zmianą konfiguracji; zajętego repozytorium nie przejmujemy. Adres działającego węzła można odczytać z oficjalnego pliku `ipfs/api`. PeerID, klucze i bloki pozostają zachowane.
