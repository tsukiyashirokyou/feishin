import { create } from 'zustand';

import { DesktopLyricsData } from '/@/shared/types/desktop-lyrics';

const EMPTY_LYRICS: DesktopLyricsData = {
    lyrics: undefined,
    offsetMs: 0,
    pronunciationLyrics: undefined,
    translationLyrics: undefined,
};

// Read-only mirror of the current song's synchronized lyrics, resolved by the
// main window renderer (the only authoritative source) and forwarded here for
// display. Never persisted or treated as a fetch/parse layer.
export const useDesktopLyricsLyricsStore = create<DesktopLyricsData>(() => EMPTY_LYRICS);

// Registered at module load so the listener is guaranteed to be present before
// the main window pushes the first lyrics payload, mirroring the playback-state
// store. This renderer is its own process, so it runs once per window.
window.api.desktopLyricsListener.onLyrics((lyrics) => {
    useDesktopLyricsLyricsStore.setState(lyrics);
});
