import { SynchronizedLyrics } from '/@/shared/types/domain-types';
import { PlayerStatus, PlayerType } from '/@/shared/types/types';

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
    open: boolean;
}
