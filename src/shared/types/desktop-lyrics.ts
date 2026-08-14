import { SynchronizedLyrics } from '/@/shared/types/domain-types';
import { PlayerStatus, PlayerType } from '/@/shared/types/types';

// Low-frequency configuration pushed by the main window renderer (the settings
// authority) through the main process to the desktop lyrics renderer. Only the
// fields the desktop lyrics feature needs are sent — never the whole settings
// store. `enabled` is the source of truth for open/close; `alwaysOnTop` is
// applied by the main process at window creation and on change; `fontSize` and
// `fontColor` are applied by the desktop lyrics renderer as CSS variables.
export interface DesktopLyricsConfig {
    alwaysOnTop: boolean;
    enabled: boolean;
    fontColor: string;
    fontSize: number;
}

// Control intent sent by the desktop lyrics renderer's control bar. The main
// process relays player controls to the main window's existing
// `renderer-player-*` channels (handled by `useMainPlayerListener`) and handles
// window-level actions (`lock`/`unlock`/`close`) locally. `seek` is
// intentionally absent: click-to-seek is deferred and, when added, must route
// through the main window's `mediaSeekToTimestamp` rather than `mpvPlayer.seekTo`.
export type DesktopLyricsControlAction =
    | { type: 'close' }
    | { type: 'lock' }
    | { type: 'next' }
    | { type: 'previous' }
    | { type: 'toggle-play' }
    | { type: 'unlock' };

// Synchronized lyrics for the current song, resolved and normalized by the main
// window renderer (the only place with server/settings/query context) and
// forwarded to the desktop lyrics renderer. Reuses the existing
// `SynchronizedLyrics` type verbatim — this is a view payload, not a second
// lyrics format. `lyrics` is `undefined` when the current song has no
// synchronized lyrics (the renderer then shows its empty state).
export interface DesktopLyricsData {
    lyrics: SynchronizedLyrics | undefined;
    offsetMs: number;
    pronunciationLyrics: SynchronizedLyrics | undefined;
    translationLyrics: SynchronizedLyrics | undefined;
}

// Minimal subset of `Song` (see domain-types.ts) that the desktop lyrics
// renderer needs to display the current track. Deliberately excludes large or
// irrelevant fields (lyrics, participants, tags, genres, ...) so the IPC
// payload stays small.
export interface DesktopLyricsSong {
    album: null | string;
    artistName: string;
    duration: number;
    imageUrl: null | string;
    name: string;
}

export interface DesktopLyricsState {
    language: string;
    playbackType: PlayerType;
    song: DesktopLyricsSong | undefined;
    status: PlayerStatus;
    timestamp: number;
}

export interface DesktopLyricsWindowState {
    locked: boolean;
    open: boolean;
}
