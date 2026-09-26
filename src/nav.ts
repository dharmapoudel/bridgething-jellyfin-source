// in-app navigation. single full-screen page; views swap, Escape/back pops.
export type LibTab = 'albums' | 'artists' | 'playlists' | 'genres';

export type View =
  | { name: 'home' }
  | { name: 'library'; tab: LibTab }
  | { name: 'playlists' }
  | { name: 'albums' }
  | { name: 'favorites' }
  | { name: 'detail'; kind: 'album' | 'artist' | 'playlist' | 'genre'; id: string; title: string }
  | { name: 'nowplaying' }
  | { name: 'queue' }
  | { name: 'setup' };

export type NavFn = (v: View) => void;

export interface ViewProps {
  jf: import('./jellyfin').JellyfinClient;
  nav: NavFn;
  back: () => void;
  openMenu: (title: string, actions: import('./components').MenuAction[]) => void;
}
