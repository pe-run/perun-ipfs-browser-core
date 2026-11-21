import type { Bookmark, BookmarkFolder } from './types';

// Search and Community come first, the rest alphabetically; the user can reorder.
const starterFolderList: BookmarkFolder[] = [
  {
    id: 1,
    title: 'Search',
  },
  {
    id: 4,
    title: 'Community',
  },
  {
    id: 2,
    title: 'Knowledge',
  },
  {
    id: 3,
    title: 'Open Source',
  },
  {
    id: 5,
    title: 'IPFS',
  },
  {
    id: 6,
    title: 'Decentralized Web',
  },
  {
    id: 7,
    title: 'Privacy',
  },
  {
    id: 8,
    title: 'News',
  },
  {
    id: 9,
    title: 'Media',
  },
  {
    id: 10,
    title: 'Finance',
  },
];

export const starterFolders: BookmarkFolder[] = [
  ...starterFolderList.filter(({ title }) =>
    ['Search', 'Community'].includes(title),
  ),
  ...starterFolderList
    .filter(({ title }) => !['Search', 'Community'].includes(title))
    .sort((a, b) => a.title.localeCompare(b.title)),
].map((folder, order) => ({ ...folder, order }));

export const starterBookmarks: Bookmark[] = [
  {
    url: 'ipns://k51qzi5uqu5dm5zgn28noh9mj76dmfoa6ikax3sm40byq0cr4yybdp0xw0ko9r/',
    title: 'Perun Catalog',
    folderId: null,
  },
  {
    url: 'https://duckduckgo.com/',
    title: 'DuckDuckGo',
    folderId: null,
  },
  {
    url: 'https://www.mojeek.com/',
    title: 'Mojeek',
    folderId: null,
    shortcutFolderId: 1,
    description: 'Wyszukiwarka z własnym indeksem niezależnym od Google i Bing',
  },
  {
    url: 'https://search.brave.com/',
    title: 'Brave Search',
    folderId: 1,
    description: 'Wyszukiwarka z własnym indeksem',
  },
  {
    url: 'https://www.openstreetmap.org/',
    title: 'OpenStreetMap',
    folderId: 2,
    description: 'Otwarte mapy rozwijane przez społeczność',
  },
  {
    url: 'https://pl.wikipedia.org/',
    title: 'Wikipedia',
    folderId: 2,
    description: 'Wolna encyklopedia tworzona przez społeczność',
  },
  {
    url: 'https://archive.org/',
    title: 'Internet Archive',
    folderId: 2,
    description: 'Biblioteka cyfrowa i archiwum stron internetowych',
  },
  {
    url: 'https://codeberg.org/',
    title: 'Codeberg',
    folderId: 3,
    description: 'Społecznościowy hosting repozytoriów open source',
  },
  {
    url: 'https://join-lemmy.org/',
    title: 'Lemmy',
    folderId: 4,
    description: 'Federacyjna alternatywa dla Reddita',
  },
  {
    url: 'https://joinpeertube.org/',
    title: 'PeerTube',
    folderId: 4,
    description: 'Federacyjna platforma wideo i alternatywa dla YouTube',
  },
  {
    url: 'https://joinmastodon.org/',
    title: 'Mastodon',
    folderId: 4,
    description: 'Federacyjna sieć społecznościowa',
  },
  {
    url: 'https://ecosystem.ipfs.tech/',
    title: 'IPFS Ecosystem',
    folderId: 5,
    description: 'Katalog aplikacji i projektów wykorzystujących IPFS',
  },
  {
    url: 'https://ipfs.tech/',
    title: 'IPFS',
    folderId: 5,
    description: 'Oficjalna strona projektu InterPlanetary File System',
  },
  {
    url: 'https://awesome.ipfs.tech/',
    title: 'Awesome IPFS',
    folderId: 5,
    description: 'Katalog zasobów i aplikacji opartych na IPFS',
  },
  {
    url: 'https://libp2p.io/',
    title: 'libp2p',
    folderId: 6,
    description: 'Otwarty zestaw technologii komunikacji peer-to-peer',
  },
  {
    url: 'https://www.torproject.org/',
    title: 'Tor Project',
    folderId: 7,
    description: 'Narzędzia do anonimowej komunikacji w internecie',
  },
  {
    url: 'https://matrix.org/',
    title: 'Matrix',
    folderId: 6,
    description: 'Otwarty protokół zdecentralizowanej komunikacji',
  },
  {
    url: 'https://f-droid.org/',
    title: 'F-Droid',
    folderId: 3,
    description: 'Katalog otwartego oprogramowania na Androida',
  },
  {
    url: 'https://tuta.com/',
    title: 'Tuta Mail',
    folderId: 7,
    description: 'Usługa pocztowa skupiona na prywatności',
  },
  {
    url: 'https://sepiasearch.org/',
    title: 'Sepia Search',
    folderId: 4,
    description: 'Wyszukiwarka materiałów wideo w sieci PeerTube',
  },
  {
    url: 'ipns://docs.ipfs.tech/',
    title: 'IPFS Documentation',
    folderId: 5,
    description: 'Dokumentacja IPFS dostępna przez DNSLink i IPNS',
  },
  {
    url: 'https://www.reuters.com/',
    title: 'Reuters',
    folderId: 8,
  },
  {
    url: 'https://www.yahoo.com/',
    title: 'Yahoo',
    folderId: 8,
  },
  {
    url: 'https://www.youtube.com/',
    title: 'YouTube',
    folderId: 9,
  },
  {
    url: 'https://www.imdb.com/',
    title: 'IMDb',
    folderId: 9,
  },
  {
    url: 'https://coinmarketcap.com/',
    title: 'CoinMarketCap',
    folderId: 10,
  },
  {
    url: 'https://open.spotify.com/',
    title: 'Spotify',
    folderId: 9,
  },
  {
    url: 'https://github.com/',
    title: 'GitHub',
    folderId: 3,
  },
  {
    url: 'ipfs://bafybeiaysi4s6lnjev27ln5icwm6tueaw2vdykrtjkwiphwekaywqhcjze/wiki/',
    title: 'Wikipedia EN (IPFS)',
    folderId: 2,
  },
];
