import { create } from 'zustand';

import { DesktopLyricsState } from '/@/shared/types/desktop-lyrics';
import { PlayerStatus, PlayerType } from '/@/shared/types/types';

// Read-only mirror of the main window's playback state. The main window is the
// only authoritative source; this store only exists to drive the desktop lyrics
// renderer's display and is never persisted or treated as a player.
export const useDesktopLyricsStore = create<DesktopLyricsState>(() => ({
    language: 'en',
    playbackType: PlayerType.WEB,
    song: undefined,
    status: PlayerStatus.STOPPED,
    timestamp: 0,
}));

// Registered at module load so it is guaranteed to be listening before the main
// process emits its `did-finish-load` window-state signal and the main window
// pushes the initial snapshot. The desktop lyrics window is its own renderer
// process, so this runs exactly once per window and is torn down with it.
window.api.desktopLyricsListener.onState((state) => {
    useDesktopLyricsStore.setState(state);
});
