# Oryginalna dokumentacja polska

Zachowany opis wcześniejszej wersji projektu. Aktualna dokumentacja: [README po angielsku](../../README.md).

# Perun IPFS Browser

<img src="../../resources/branding/perun.svg" width="96" height="96" alt="Logo Perun IPFS Browser">

Działająca przeglądarka desktopowa Linux: Electron/Chromium + własny węzeł Kubo. HTTP i HTTPS korzystają ze standardowej sieci Chromium, IPFS i IPNS z lokalnego węzła, bez publicznej bramki.

## Wymagania

Linux x86_64 z bibliotekami wymaganymi przez Electron (m.in. GTK, NSS, libgbm, ALSA), wyświetlacz X11/Wayland lub Xvfb. Do developmentu Node **24 LTS**, npm, tar; do testów również openssl. Do budowania DEB: dpkg, fakeroot. Instalacja zależności i pierwszy download Kubo wymagają internetu. Gotowa aplikacja nie pobiera Kubo przy starcie.

## Instalacja jednym poleceniem z publicznego GitHub

Ubuntu/Debian x86_64. Wymagane narzędzia: `git`, `curl`, `xz-utils`, `dpkg`, `sudo` (można je zainstalować przez `sudo apt install git curl xz-utils dpkg`). Konto GitHub i GitHub CLI nie są wymagane.

**Dla publicznego repozytorium:**

```bash
bash -c 'script=$(curl -fsSL https://raw.githubusercontent.com/pe-run/perun-ipfs-browser-core/main/scripts/install.sh) && bash -c "$script"'
```

Dla **prywatnego repozytorium** użyj GitHub CLI po zalogowaniu przez `gh auth login` na konto z dostępem do repozytorium:

```bash
bash -c 'script=$(gh api repos/pe-run/perun-ipfs-browser-core/contents/scripts/install.sh -H "Accept: application/vnd.github.raw") && bash -c "$script"'
```

Instalator pobiera `main` przez Git HTTPS, używa Node 24 (w razie potrzeby pobiera przypięte wydanie z kontrolą SHA-256), wykonuje `npm ci`, buduje DEB z Kubo i uruchamia `sudo apt-get install`. Budowanie trwa kilka minut i wymaga internetu oraz miejsca na zależności i pakiet. Instalator nie wymaga ręcznej instalacji Node ani Kubo. Hasło sudo podajesz tylko do instalacji pakietu; kod i zależności budowane są jako zwykły użytkownik. Pliki tymczasowe są sprzątane, a profil użytkownika pozostaje bez zmian. Jeśli dostępne jest zalogowane `gh`, może ono opcjonalnie uwierzytelnić klonowanie prywatnego repozytorium; publiczna instalacja działa bez niego.

Uruchomienie po instalacji: `ipfs-browser` lub **Perun IPFS Browser** w menu aplikacji. Ponowne wykonanie polecenia buduje aktualny `main` i instaluje pakiet ponownie. Usunięcie aplikacji: `sudo apt remove ipfs-browser` (profil pozostaje).

Instalacja z lokalnego checkoutu: `bash scripts/install.sh --source .`. Przygotowanie samego pakietu bez sudo: `bash scripts/install.sh --source . --build-only /tmp/perun-packages`. Nie uruchamiaj instalatora przez `sudo bash`.

## Uruchomienie ze źródeł

```bash
git clone https://github.com/pe-run/perun-ipfs-browser-core.git
cd perun-ipfs-browser-core
nvm install
nvm use
npm ci
npm run kubo:download
npm start
```

Pobieranie Kubo weryfikuje przypięty SHA-256; cache archiwum jest ponownie sprawdzany. Używana wersja: 0.43.1. Wersje npm są zapisane w package-lock.json. TypeScript działa w strict. Oficjalny szablon Forge 8 używa plików konfiguracyjnych `.mts`.

## Pakiet Linux

```bash
npm run make
# katalog uruchamialny:
./out/ipfs-browser-linux-x64/ipfs-browser
# instalacja DEB (nazwa pliku zawiera wersję):
sudo apt install ./out/make/deb/x64/perun-ipfs-browser_0.2.0_amd64.deb
```

`npm run package` przygotowuje katalog z aplikacją do uruchomienia i testów. Pełne `npm run make` tworzy DEB, RPM, AppImage, ZIP i archiwum źródeł w `out/make`, a po udanym budowaniu kopiuje je do `/tmp/perun`. Samo archiwum źródeł można przygotować poleceniem `npm run make:source`. Kubo i jego licencje są dołączane jako zasoby poza ASAR.

### Sandbox na Linux

Aplikacja nie używa `--no-sandbox`. Na systemach dopuszczających nieuprzywilejowane przestrzenie nazw uruchamia się ze standardowym sandboxem Chromium. Ubuntu/AppArmor może wymagać poprawnie zainstalowanego helpera SUID. DEB ustawia właściciela/uprawnienia helpera podczas instalacji. Przy ręcznej instalacji ZIP do **zaufanego, zarządzanego przez administratora katalogu** helper `chrome-sandbox` musi należeć do root i mieć tryb 4755. Nie uruchamiaj całej przeglądarki jako root.

W środowisku wykonania tego projektu AppArmor blokuje user namespaces, a sudo wymaga hasła. Testy uruchomiono z istniejącym systemowym helperem `/opt/google/chrome/chrome-sandbox`, podłączonym do kopii testowej oraz lokalnej instalacji developerskiej Electrona. Sandbox pozostał włączony. Dystrybuowane ZIP/DEB zawierają oryginalny helper Electrona. Instalacja DEB na docelowym systemie wymaga uprawnień administratora.

## Obsługa

- Pasek adresu: `https://example.org`, `http://localhost:PORT`, `ipfs://CID/path`, `ipns://NAME/path`.
- `+` / Ctrl+T: karta; `×` / Ctrl+W: zamknięcie; Ctrl+L: adres; Alt+←/→: historia; Ctrl+R: odświeżenie.
- `☆`: zapis zakładki; `Kopiuj`: oryginalny URL.
- `Start`: historia, zakładki, ustawienie przywracania kart, przypinanie/odpinanie aktualnej treści i statystyki IPFS.
- Pobieranie plików: natywne okno zapisu. Wszystkie wrażliwe uprawnienia stron są w MVP odrzucane.

Dla zgodności z wcześniejszą nazwą zachowujemy katalog profilu `IPFS Browser`. Dane aplikacji są w katalogu `userData` Electrona (zwykle `~/.config/IPFS Browser`), a nie `~/.ipfs`. SQLite przechowuje dane przeglądarki, podkatalog `ipfs` bloki i trwały PeerID. Zamknięcie okna zatrzymuje węzeł. Zero połączonych peerów oznacza brak bieżącej łączności P2P; lokalnie zapisane treści nadal mogą działać.

## Dodawanie plików i katalogów do IPFS

Na stronie **Start** wybierz **Dodaj pliki do IPFS** (jeden lub wiele plików) albo **Dodaj katalog do IPFS**. Aplikacja otwiera natywne okno wyboru, strumieniuje zawartość do wbudowanego Kubo, przypina ją i zapisuje adres w zakładkach. Wynik zawiera CID oraz przyciski kopiowania i otwierania. Wybrane pliki trafiają do wspólnego katalogu zachowującego ich nazwy; dostępne są też bezpośrednie adresy każdego pliku. Import katalogu zachowuje jego podkatalogi, również puste. Nazwa wybranego katalogu nie jest dodatkowym poziomem pod CID.

Import katalogu obejmuje także pliki ukryte. Dowiązania symboliczne i pliki specjalne są odrzucane; pliki o jednakowych nazwach z różnych katalogów należy dodać osobno albo wybrać ich wspólny katalog. Duże pliki są przesyłane strumieniowo. Anulowanie okna wyboru niczego nie dodaje. Zamknięcie aplikacji przerywa trwający import; po nieudanym imporcie część bloków może pozostać w cache, bez potwierdzonego adresu wyniku.

Dodane dane nie są szyfrowane i mogą być pobierane przez osoby znające CID, gdy węzeł jest dostępny. Pin chroni dane na lokalnym dysku; nie gwarantuje dostępności po zamknięciu przeglądarki, jeśli inny węzeł ich nie przechowuje. Import dostępny jest wyłącznie w interfejsie przeglądarki — odwiedzane strony nie dostają API dodawania plików ani dostępu do lokalnych ścieżek/RPC. Wybór katalogu ze stroną zawierającą index.html pozwala od razu otworzyć ją pod zwróconym adresem.

## Testy

```bash
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run package
xvfb-run -a npm run test:e2e
```

Testy jednostkowe obejmują również instalator: publiczne klonowanie bez uwierzytelnienia, tryb build-only, odrzucenie uszkodzonego Node i przerwanie przed apt po błędzie budowania. Pełny build instalatora można sprawdzić przez `bash scripts/install.sh --source . --build-only /tmp/perun-packages`.

Testy E2E wymagają działającego sandboxa także w developerskiej binarce `node_modules/electron/dist/electron` i zbudowanym pakiecie. Nie dodawaj flag wyłączających sandbox. Testy Playwright używają Electrona z projektu, bez pobierania osobnego Chromium. Test pakietu uruchamia gotową binarkę poza repozytorium. Test HTTPS sprawdza odrzucenie niezaufanego certyfikatu, następnie ufa wyłącznie lokalnemu fixture'owi w harnessie; kod produkcyjny nie zawiera wyjątku TLS.

Integracja uruchamia dwa niezależne Kubo i sprawdza bezpośrednią wymianę bloków P2P, gotowość, repozytorium, IPNS, Range i zachowanie PeerID. Nie używa publicznych bramek. E2E używa lokalnych HTTP/HTTPS i przypiętych fixture'ów IPFS/IPNS. Ślady błędów i zrzut pakietu są w `test-results`.

## Znane ograniczenia

- Wszystkie strony IPFS/IPNS **współdzielą origin i dane stron**. Mogą wzajemnie czytać i modyfikować localStorage/IndexedDB. Nie przechowuj tam sekretów. HTTP/HTTPS i interfejs pozostają oddzielone.
- Względne URL działają; `/style.css` wymaga adaptacji do `/ipfs/CID/style.css`. Nie przepisujemy globalnie adresów ani `window.location`. Service Workery i pozostałe workery są wyłączone dla p2p.
- Cel cache 10 GB jest miękki: Kubo GC nie zapewnia ścisłego limitu, a ręcznych pinów nie usuwa. Duże piny mogą powiększyć repo ponad cel. Brak LRU.
- Pojedynczy HTTP Range jest obsługiwany, wieloczęściowy nie. Katalog wymaga index.html. Rozpoznawanie MIME bez rozszerzenia jest heurystyczne.
- Brak per-site permission UI, menedżera haseł, rozszerzeń, aktualizatora, synchronizacji i DRM. Po restarcie odtwarzane są adresy kart, nie pełny stos wstecz/dalej.
- Publiczna dostępność CID i propagacja IPNS zależą od peerów i sieci. Testy potwierdzają lokalną wymianę P2P, nie dostępność całego publicznego IPFS.

Szczegóły: [ARCHITECTURE.md](ARCHITECTURE.md), stan i dalsze kroki: [ROADMAP.md](ROADMAP.md), zasady zmian: [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Logo

Oryginalne logo znajduje się w `resources/branding/perun.svg`. Interfejs i favicon korzystają bezpośrednio z SVG; ikona okna i menu systemowego Linux używa wariantu `perun.png` (512×512). Oba pliki są dołączone do źródeł. Po zmianie SVG wariant PNG można odświeżyć poleceniem `python3 scripts/render-icon.py` (narzędzia pomocnicze: `python3-gi`, `gir1.2-rsvg-2.0`). Zwykłe budowanie i instalacja nie wymagają tych narzędzi.

## Pliki lokalne

Wpisz w pasku adresu lokalny adres, np. `file:///home/user/Dokumenty/`. W widoku katalogu można otwierać pliki i przechodzić po ich odnośnikach względnych. Strony z sieci nie mogą otwierać plików lokalnych. Lokalne strony działają z zabezpieczeniami Chromium i nie mają dostępu do mostu IPFS Perun.
